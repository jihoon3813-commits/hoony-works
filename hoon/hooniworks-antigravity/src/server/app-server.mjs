import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import {
  DIST_DIR,
  UPLOADS_DIR,
  RENDER_DIR,
  encryptSecret,
  signStatePayload,
  verifyStatePayload,
  getProviderConnectionStatus
} from './config.mjs';
import {
  HttpError,
  makeId,
  sha256Hex,
  requireWorkspaceAccess,
  assertEntityWorkspace,
  validateImageBytes,
  validateSafeExternalUrl
} from './security.mjs';
import { db as defaultDb } from './db.mjs';
import { getAdapter, buildThreeConcepts, PROVIDER_ADAPTERS } from './providers.mjs';
import { buildContentLayers, synthesizeMp4File, renderLayeredCardSvg } from './media-worker.mjs';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.zip': 'application/zip'
};

async function readRequestBody(req, maxBytes = 16 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new HttpError(413, '요청 본문 크기가 제한을 초과했습니다.', 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  if (!raw.length) return {};
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/octet-stream') || ct.includes('image/')) {
    return raw;
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, '유효한 JSON 요청 본문이 아닙니다.', 'INVALID_JSON');
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

export function createRequestHandler(db = defaultDb) {
  return async (req, res) => {
    try {
      const urlObj = new URL(req.url, 'http://127.0.0.1');
      let pathname = decodeURIComponent(urlObj.pathname);

      // Support Vercel rewrite query parameter (__path) if present
      const rewrittenPath = urlObj.searchParams.get('__path');
      if (rewrittenPath !== null && (pathname === '/api' || pathname === '/api/index.mjs' || pathname === '/api/')) {
        pathname = '/api/' + rewrittenPath.replace(/^\/+/, '');
      }

      if (pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, urlObj, pathname, db);
        return;
      }

      // Static file serving from dist/
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end('Method not allowed');
        return;
      }
      const relative = pathname.replace(/^\/+/, '') || 'index.html';
      const target = path.resolve(DIST_DIR, relative);
      if (!target.startsWith(DIST_DIR) || relative.split(/[\\/]/).some(x => x.startsWith('.'))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const info = await stat(target);
      if (!info.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const body = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { ok: false, error: err.message, code: err.code });
        return;
      }
      if (err && err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      sendJson(res, 500, { ok: false, error: err?.message || 'Internal Server Error', code: 'INTERNAL_ERROR' });
    }
  };
}

export function createHooniServer(db = defaultDb) {
  return http.createServer(createRequestHandler(db));
}

async function handleApiRequest(req, res, urlObj, pathname, db) {
  const method = req.method;
  // Resolve current user from header or default to primary admin user-jh
  const userId = req.headers['x-hooni-user'] !== undefined
    ? String(req.headers['x-hooni-user']).trim()
    : 'user-jh';
  const currentUser = db.users.find(u => u.id === userId) || null;

  // 1. Session & Provider Status
  if (method === 'GET' && pathname === '/api/session') {
    if (!currentUser) throw new HttpError(401, '로그인이 필요합니다.', 'UNAUTHORIZED');
    const accessibleIds = new Set(
      db.memberships.filter(m => m.userId === currentUser.id).map(m => m.workspaceId)
    );
    const accessibleWorkspaces = db.workspaces
      .filter(w => accessibleIds.has(w.id))
      .map(w => db.getHydratedWorkspace(w.id));

    sendJson(res, 200, {
      ok: true,
      user: currentUser,
      availableUsers: db.users,
      settings: db.settings,
      providers: getProviderConnectionStatus(),
      adapterCapabilities: Object.fromEntries(
        Object.entries(PROVIDER_ADAPTERS).map(([k, v]) => [k, v.capabilities])
      ),
      workspaces: accessibleWorkspaces
    });
    return;
  }

  // Global settings update (budget / retries)
  if (method === 'PATCH' && pathname === '/api/settings') {
    if (!currentUser) throw new HttpError(401, '로그인이 필요합니다.', 'UNAUTHORIZED');
    const body = await readRequestBody(req);
    if (body.budget !== undefined) {
      const b = Number(body.budget);
      if (!Number.isFinite(b) || b < 1000) {
        throw new HttpError(400, '월 사용 한도는 1,000원 이상이어야 합니다.', 'INVALID_BUDGET');
      }
      db.settings.budget = Math.round(b);
    }
    if (body.retries !== undefined) {
      db.settings.retries = Math.max(1, Math.min(5, Number(body.retries) || 2));
    }
    db.logAudit('global', currentUser.id, 'UPDATE_SETTINGS', 'settings', {
      budget: db.settings.budget,
      retries: db.settings.retries
    });
    db.save();
    sendJson(res, 200, { ok: true, settings: db.settings });
    return;
  }

  // 2. GET/POST /api/workspaces
  if (pathname === '/api/workspaces') {
    if (!currentUser) throw new HttpError(401, '로그인이 필요합니다.', 'UNAUTHORIZED');
    if (method === 'GET') {
      const accessibleIds = new Set(
        db.memberships.filter(m => m.userId === currentUser.id).map(m => m.workspaceId)
      );
      const list = db.workspaces
        .filter(w => accessibleIds.has(w.id))
        .map(w => db.getHydratedWorkspace(w.id));
      sendJson(res, 200, { ok: true, workspaces: list, settings: db.settings });
      return;
    }
    if (method === 'POST') {
      const body = await readRequestBody(req);
      const name = String(body.name || body.brand?.name || '').trim();
      if (!name) throw new HttpError(400, '상품·브랜드 이름을 입력해 주세요.', 'MISSING_NAME');
      const now = new Date().toISOString();
      const wsId = body.id && /^brand-[a-zA-Z0-9_-]+$/.test(body.id) && !db.workspaces.some(w => w.id === body.id)
        ? body.id
        : makeId('brand');

      const newWs = {
        id: wsId,
        accountId: currentUser.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
        brand: {
          name,
          category: String(body.category || body.brand?.category || '기타').trim(),
          color: /^#[0-9a-fA-F]{6}$/.test(body.color || body.brand?.color || '') ? (body.color || body.brand.color) : '#7661dc',
          audience: String(body.audience || body.brand?.audience || '').trim(),
          description: String(body.description || body.brand?.description || '').trim(),
          tone: String(body.tone || body.brand?.tone || '명확하고 친근하게, 확인된 상품 정보 중심으로').trim(),
          cta: String(body.cta || body.brand?.cta || '자세히 알아보기').trim(),
          approvedFacts: Array.isArray(body.approvedFacts) ? body.approvedFacts : [],
          links: { website: '', instagram: '', kakao: '', blog: '', youtube: '' },
          accounts: { instagram: '', kakao: '', blog: '', youtube: '' }
        },
        catalog: []
      };
      db.workspaces.push(newWs);
      db.memberships.push({
        id: makeId('mem'),
        workspaceId: wsId,
        userId: currentUser.id,
        role: 'owner'
      });
      for (const platform of ['instagram', 'youtube', 'blog', 'kakao']) {
        db.channelConnections.push({
          id: makeId('conn'),
          workspaceId: wsId,
          platform,
          externalAccountId: null,
          accountName: '',
          publicUrl: '',
          scopes: [],
          secretRef: null,
          expiresAt: null,
          state: ['blog', 'kakao'].includes(platform) ? 'manual_only' : 'unconnected',
          updatedAt: now
        });
      }
      db.logAudit(wsId, currentUser.id, 'CREATE_WORKSPACE', wsId, { name });
      db.save();
      sendJson(res, 201, { ok: true, workspace: db.getHydratedWorkspace(wsId) });
      return;
    }
  }

  // OAuth callback: GET /api/channels/:provider/callback
  const oauthCallbackMatch = pathname.match(/^\/api\/channels\/([a-z]+)\/callback$/);
  if (method === 'GET' && oauthCallbackMatch) {
    const provider = oauthCallbackMatch[1];
    const stateToken = urlObj.searchParams.get('state');
    const code = urlObj.searchParams.get('code') || 'sandbox-oauth-code';
    const externalAccount = urlObj.searchParams.get('account') || `@${provider}_verified`;
    const payload = verifyStatePayload(stateToken);
    const { workspace } = requireWorkspaceAccess(db, payload.userId, payload.workspaceId, 'editor');

    if (!['instagram', 'youtube'].includes(provider)) {
      throw new HttpError(400, `${provider} 채널은 OAuth 직접 게시 대상이 아닙니다.`, 'UNSUPPORTED_OAUTH_CHANNEL');
    }

    const conn = db.channelConnections.find(
      c => c.workspaceId === workspace.id && c.platform === provider
    );
    if (!conn) throw new HttpError(404, '채널 연결 정보를 찾을 수 없습니다.', 'CONNECTION_NOT_FOUND');

    // Encrypt OAuth access/refresh token in server secret storage only
    const tokenPayload = JSON.stringify({
      accessToken: `tok_${provider}_${makeId('sec')}`,
      refreshToken: `ref_${provider}_${makeId('sec')}`,
      code,
      issuedAt: Date.now()
    });
    conn.secretRef = encryptSecret(tokenPayload);
    conn.externalAccountId = `${provider}-${workspace.id}`;
    conn.accountName = externalAccount || workspace.brand?.accounts?.[provider] || `@${workspace.brand.name}`;
    conn.scopes = provider === 'instagram'
      ? ['instagram_basic', 'instagram_content_publish']
      : ['youtube.upload', 'youtube.readonly'];
    conn.expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
    conn.state = 'connected';
    conn.updatedAt = new Date().toISOString();

    if (workspace.brand?.accounts) {
      workspace.brand.accounts[provider] = conn.accountName;
    }
    db.logAudit(workspace.id, payload.userId, 'OAUTH_CONNECTED', conn.id, {
      platform: provider,
      accountName: conn.accountName,
      scopes: conn.scopes
    });
    db.save();

    if (urlObj.searchParams.get('format') === 'json') {
      sendJson(res, 200, {
        ok: true,
        connection: {
          id: conn.id,
          workspaceId: conn.workspaceId,
          platform: conn.platform,
          accountName: conn.accountName,
          scopes: conn.scopes,
          expiresAt: conn.expiresAt,
          state: conn.state
        }
      });
    } else {
      res.writeHead(302, { Location: `/#brand` });
      res.end();
    }
    return;
  }

  // Workspace-scoped routes: /api/workspaces/:workspaceId...
  const wsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)(\/.*)?$/);
  if (!wsMatch) {
    throw new HttpError(404, '요청한 API 경로를 찾을 수 없습니다.', 'ROUTE_NOT_FOUND');
  }

  const workspaceId = wsMatch[1];
  const subPath = wsMatch[2] || '';

  // GET /api/workspaces/:workspaceId
  if (method === 'GET' && subPath === '') {
    requireWorkspaceAccess(db, userId, workspaceId, 'viewer');
    sendJson(res, 200, { ok: true, workspace: db.getHydratedWorkspace(workspaceId) });
    return;
  }

  // PATCH /api/workspaces/:workspaceId (Brand settings, approved facts, product items, version check)
  if (method === 'PATCH' && subPath === '') {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);

    if (body.expectedVersion !== undefined && Number(body.expectedVersion) !== workspace.version) {
      throw new HttpError(
        409,
        `다른 탭이나 기기에서 먼저 수정되었습니다 (현재 버전 v${workspace.version}). 새로고침 후 다시 시도해 주세요.`,
        'VERSION_CONFLICT'
      );
    }

    if (body.brand) {
      const b = body.brand;
      if (b.name !== undefined) {
        const trimmed = String(b.name).trim();
        if (!trimmed) throw new HttpError(400, '브랜드 이름을 입력해 주세요.', 'INVALID_BRAND_NAME');
        workspace.brand.name = trimmed;
      }
      if (b.category !== undefined) workspace.brand.category = String(b.category).trim() || '기타';
      if (b.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(b.color)) workspace.brand.color = b.color;
      if (b.audience !== undefined) workspace.brand.audience = String(b.audience).trim();
      if (b.tone !== undefined) workspace.brand.tone = String(b.tone).trim();
      if (b.description !== undefined) workspace.brand.description = String(b.description).trim();
      if (b.cta !== undefined) workspace.brand.cta = String(b.cta).trim();
      if (Array.isArray(b.approvedFacts)) {
        workspace.brand.approvedFacts = b.approvedFacts.map((f, i) => ({
          id: f.id || makeId(`fact-${i}`),
          claim: String(f.claim || '').trim(),
          source: String(f.source || '내부 승인 자료').trim(),
          confirmedDate: String(f.confirmedDate || '2026-11-03').trim(),
          version: Number(f.version) || 1
        })).filter(f => f.claim);
      }
      if (b.links) {
        const nextLinks = { ...workspace.brand.links };
        for (const [k, v] of Object.entries(b.links)) {
          nextLinks[k] = validateSafeExternalUrl(v, k);
        }
        workspace.brand.links = nextLinks;
      }
      if (b.accounts) {
        workspace.brand.accounts = { ...workspace.brand.accounts, ...b.accounts };
      }
    }

    if (Array.isArray(body.productItems)) {
      // Update workspace-owned product items
      const others = db.productItems.filter(p => p.workspaceId !== workspaceId);
      const updatedItems = body.productItems.map(item => ({
        id: item.id || makeId('item'),
        workspaceId,
        code: item.code || item.id || makeId('code'),
        name: String(item.name || '').trim(),
        description: String(item.description || '').trim(),
        approvedConditions: String(item.approvedConditions || '').trim(),
        sourceVersion: String(item.sourceVersion || 'v1.0 (2026-11-03)').trim()
      })).filter(item => item.name);
      db.state.productItems = [...others, ...updatedItems];
    }

    workspace.version = (workspace.version || 1) + 1;
    workspace.updatedAt = new Date().toISOString();
    db.logAudit(workspaceId, userId, 'UPDATE_WORKSPACE', workspaceId, { version: workspace.version });
    db.save();
    sendJson(res, 200, { ok: true, workspace: db.getHydratedWorkspace(workspaceId) });
    return;
  }

  // POST /api/workspaces/:workspaceId/import (Browser data import with deduplication & partial failure report)
  if (method === 'POST' && subPath === '/import') {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);
    const campaignsInput = Array.isArray(body.campaigns) ? body.campaigns : [];
    const uploadsInput = Array.isArray(body.uploads) ? body.uploads : [];
    const templatesInput = Array.isArray(body.templates) ? body.templates : [];

    const report = {
      workspaceId,
      importedCampaigns: 0,
      skippedDuplicateCampaigns: 0,
      importedAssets: 0,
      previewOnlyAssets: 0,
      skippedDuplicateAssets: 0,
      importedTemplates: 0,
      failedItems: []
    };

    // 1. Assets import with SHA-256 deduplication and original vs preview-only tracking
    for (const item of uploadsInput) {
      try {
        if (!item || !item.name) {
          report.failedItems.push({ type: 'asset', id: item?.id || 'unknown', reason: '파일 이름 누락' });
          continue;
        }
        if (item.simulateFailure) {
          report.failedItems.push({ type: 'asset', id: item.id, name: item.name, reason: '원본 전송 일시 오류 (재시도 가능)' });
          continue;
        }
        const rawDataUrl = String(item.originalDataUrl || item.img || '');
        const hash = item.sha256 || sha256Hex(`${workspaceId}:${item.id}:${item.name}:${rawDataUrl.slice(0, 256)}`);
        const existing = db.assets.find(
          a => a.workspaceId === workspaceId && (a.sha256 === hash || (item.id && a.legacyUploadId === item.id))
        );
        if (existing) {
          report.skippedDuplicateAssets++;
          continue;
        }
        const hasFullOriginal = Boolean(item.hasOriginalBlob || item.originalDataUrl);
        if (!hasFullOriginal) {
          report.previewOnlyAssets++;
        }
        db.assets.push({
          id: item.id && !db.assets.some(a => a.id === item.id) ? item.id : makeId('asset'),
          workspaceId,
          legacyUploadId: item.id || null,
          productItemId: item.productItemId || null,
          name: String(item.name),
          menu: String(item.menu || ''),
          tags: String(item.tags || ''),
          role: ['product', 'reference', 'logo'].includes(item.role) ? item.role : 'reference',
          type: item.type || '브라우저 가져오기 자료',
          img: item.img || '',
          original: hasFullOriginal,
          previewOnly: !hasFullOriginal,
          sha256: hash,
          provenance: hasFullOriginal ? 'browser_import_original' : 'browser_import_preview_only',
          createdAt: new Date().toISOString()
        });
        report.importedAssets++;
      } catch (err) {
        report.failedItems.push({ type: 'asset', id: item?.id, name: item?.name, reason: err.message });
      }
    }

    // 2. Campaigns import
    for (const c of campaignsInput) {
      try {
        if (!c || !c.name) {
          report.failedItems.push({ type: 'campaign', id: c?.id || 'unknown', reason: '캠페인 이름 누락' });
          continue;
        }
        const dup = db.campaigns.find(
          x => x.workspaceId === workspaceId && (x.id === c.id || (x.name === c.name && x.topic === c.topic))
        );
        if (dup) {
          report.skippedDuplicateCampaigns++;
          continue;
        }
        db.campaigns.push({
          ...c,
          id: c.id && !db.campaigns.some(x => x.id === c.id) ? c.id : makeId('campaign'),
          workspaceId,
          designMode: ['creative', 'reference', 'template'].includes(c.designMode) ? c.designMode : 'creative',
          version: Number(c.version) || 1
        });
        report.importedCampaigns++;
      } catch (err) {
        report.failedItems.push({ type: 'campaign', id: c?.id, name: c?.name, reason: err.message });
      }
    }

    // 3. Templates import
    for (const tpl of templatesInput) {
      if (!tpl || !tpl.name) continue;
      const dup = db.templates.find(t => t.workspaceId === workspaceId && (t.id === tpl.id || t.name === tpl.name));
      if (dup) continue;
      db.templates.push({
        ...tpl,
        id: tpl.id && !db.templates.some(t => t.id === tpl.id) ? tpl.id : makeId('tpl'),
        workspaceId,
        visibility: 'workspace',
        custom: true,
        version: 1
      });
      report.importedTemplates++;
    }

    workspace.updatedAt = new Date().toISOString();
    db.logAudit(workspaceId, userId, 'IMPORT_BROWSER_DATA', workspaceId, report);
    db.save();
    sendJson(res, 200, { ok: true, report, workspace: db.getHydratedWorkspace(workspaceId) });
    return;
  }

  // POST /api/workspaces/:workspaceId/assets/upload-init
  if (method === 'POST' && subPath === '/assets/upload-init') {
    requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);
    const fileName = String(body.fileName || '').trim();
    const mimeType = String(body.mimeType || '').toLowerCase();
    const byteSize = Number(body.byteSize || 0);
    const role = ['product', 'reference', 'logo'].includes(body.role) ? body.role : 'product';

    if (!fileName) throw new HttpError(400, '파일 이름이 필요합니다.', 'MISSING_FILENAME');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
      throw new HttpError(400, 'PNG, JPG, WebP 형식만 업로드할 수 있습니다.', 'INVALID_MIME_TYPE');
    }
    if (byteSize <= 0 || byteSize > 12 * 1024 * 1024) {
      throw new HttpError(413, '파일 크기는 12MB 이하여야 합니다.', 'FILE_TOO_LARGE');
    }

    const session = {
      id: makeId('upsess'),
      workspaceId,
      userId,
      fileName,
      mimeType,
      byteSize,
      role,
      menu: String(body.menu || '').trim(),
      tags: String(body.tags || '').trim(),
      productItemId: body.productItemId || null,
      expiresAt: Date.now() + 15 * 60 * 1000,
      completed: false
    };
    db.uploadSessions.push(session);
    db.save();
    sendJson(res, 200, { ok: true, uploadSession: session });
    return;
  }

  // POST /api/workspaces/:workspaceId/assets/upload-complete
  if (method === 'POST' && subPath === '/assets/upload-complete') {
    requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);
    const session = db.uploadSessions.find(s => s.id === body.uploadSessionId);
    assertEntityWorkspace(db, userId, session, workspaceId, '업로드 세션');
    if (session.completed) {
      throw new HttpError(409, '이미 완료된 업로드 세션입니다.', 'SESSION_ALREADY_COMPLETED');
    }

    let rawBytes;
    if (body.base64Data) {
      const cleaned = String(body.base64Data).replace(/^data:[^;]+;base64,/, '');
      rawBytes = Buffer.from(cleaned, 'base64');
    } else {
      throw new HttpError(400, '파일 바이트 데이터(base64Data)가 필요합니다.', 'MISSING_FILE_DATA');
    }

    const verified = validateImageBytes(rawBytes);
    if (body.expectedSha256 && body.expectedSha256 !== verified.sha256) {
      throw new HttpError(400, '파일 해시(SHA-256)가 일치하지 않습니다.', 'HASH_MISMATCH');
    }

    // Deduplicate within same workspace
    const existing = db.assets.find(a => a.workspaceId === workspaceId && a.sha256 === verified.sha256);
    if (existing) {
      session.completed = true;
      db.save();
      sendJson(res, 200, { ok: true, deduplicated: true, asset: existing });
      return;
    }

    const ext = verified.mimeType === 'image/png' ? '.png' : verified.mimeType === 'image/webp' ? '.webp' : '.jpg';
    const assetId = makeId('asset');
    const storedFileName = `${workspaceId}-${assetId}${ext}`;
    const storedPath = path.join(UPLOADS_DIR, storedFileName);
    fs.writeFileSync(storedPath, rawBytes);

    const roleLabels = { product: '실제 제품·서비스 사진', reference: '디자인 참고', logo: '브랜드 로고' };
    const newAsset = {
      id: assetId,
      workspaceId,
      productItemId: session.productItemId,
      name: session.fileName,
      menu: session.menu,
      tags: session.tags,
      role: session.role,
      type: roleLabels[session.role],
      originalKey: storedFileName,
      previewKey: `/api/workspaces/${workspaceId}/assets/${assetId}/file`,
      img: body.previewDataUrl || `/api/workspaces/${workspaceId}/assets/${assetId}/file`,
      original: true,
      mimeType: verified.mimeType,
      byteSize: verified.byteSize,
      width: verified.width,
      height: verified.height,
      sha256: verified.sha256,
      provenance: 'user_uploaded_original',
      createdAt: new Date().toISOString()
    };

    session.completed = true;
    db.assets.push(newAsset);
    db.logAudit(workspaceId, userId, 'UPLOAD_ASSET', assetId, {
      name: newAsset.name,
      role: newAsset.role,
      byteSize: newAsset.byteSize,
      sha256: newAsset.sha256
    });
    db.save();
    sendJson(res, 201, { ok: true, asset: newAsset });
    return;
  }

  // GET /api/workspaces/:workspaceId/assets/:assetId/file (Private original file access check)
  const assetFileMatch = subPath.match(/^\/assets\/([^/]+)\/file$/);
  if (method === 'GET' && assetFileMatch) {
    requireWorkspaceAccess(db, userId, workspaceId, 'viewer');
    const assetId = assetFileMatch[1];
    const asset = db.assets.find(a => a.id === assetId);
    assertEntityWorkspace(db, userId, asset, workspaceId, '브랜드 자료 파일');

    let targetPath;
    if (asset.originalKey && asset.originalKey.startsWith('dist/')) {
      targetPath = path.join(DIST_DIR, asset.originalKey.replace(/^dist\//, ''));
    } else if (asset.originalKey) {
      targetPath = path.join(UPLOADS_DIR, path.basename(asset.originalKey));
    }
    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new HttpError(404, '원본 파일을 찾을 수 없습니다.', 'ORIGINAL_FILE_NOT_FOUND');
    }
    const bytes = fs.readFileSync(targetPath);
    res.writeHead(200, {
      'Content-Type': asset.mimeType || MIME_TYPES[path.extname(targetPath)] || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(bytes);
    return;
  }

  // POST /api/workspaces/:workspaceId/campaigns (Create or update campaign)
  if (method === 'POST' && subPath === '/campaigns') {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);
    const designMode = ['creative', 'reference', 'template'].includes(body.designMode) ? body.designMode : 'creative';

    // Validate that any referenced productAssetIds or referenceAssetIds belong to this workspace
    const productAssetIds = Array.isArray(body.productAssetIds) ? body.productAssetIds : [];
    const referenceAssetIds = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : [];

    for (const aid of [...productAssetIds, ...referenceAssetIds]) {
      const found = db.assets.find(a => a.id === aid || (a.workspaceId === workspaceId && a.legacyId === aid));
      if (!found) throw new HttpError(404, `지정한 자료(${aid})를 찾을 수 없습니다.`, 'ASSET_NOT_FOUND');
      assertEntityWorkspace(db, userId, found, workspaceId, '캠페인 연결 자료');
    }

    let camp = body.id ? db.campaigns.find(c => c.id === body.id) : null;
    if (camp) {
      assertEntityWorkspace(db, userId, camp, workspaceId, '캠페인');
      Object.assign(camp, {
        name: String(body.name || camp.name).trim(),
        audience: body.audience || camp.audience,
        goal: body.goal || camp.goal,
        topic: body.topic !== undefined ? String(body.topic) : camp.topic,
        channels: Array.isArray(body.channels) && body.channels.length ? body.channels : camp.channels,
        designMode,
        // creative / reference do NOT require templateId!
        templateId: designMode === 'template' ? (body.templateId || body.template || 'yellow') : null,
        template: body.template || camp.template || 'yellow',
        preserveProduct: body.preserveProduct !== false,
        productAssetIds,
        referenceAssetIds,
        version: (camp.version || 1) + 1
      });
    } else {
      const name = String(body.name || '새로운 캠페인').trim();
      camp = {
        id: makeId('campaign'),
        workspaceId,
        name,
        audience: body.audience || 'consumer',
        goal: body.goal || (body.audience === 'business' ? '도입·제휴 상담' : '상품·서비스 소개'),
        topic: String(body.topic || ''),
        product: body.product || (workspace.catalog[0]?.id || 'primary'),
        productAssetIds,
        referenceAssetIds,
        preserveProduct: body.preserveProduct !== false,
        channels: Array.isArray(body.channels) && body.channels.length
          ? body.channels
          : ['instagram', 'kakao', 'blog', 'youtube', 'reels'],
        designMode,
        templateId: designMode === 'template' ? (body.templateId || body.template || 'yellow') : null,
        template: body.template || 'yellow',
        status: '초안',
        titles: body.titles || [
          name,
          '어떤 상품인가요?',
          '주요 특징을 알려주세요.',
          '고객에게 어떤 가치가 있나요?',
          workspace.brand.cta || '자세히 알아보기'
        ],
        caption: body.caption || [body.topic || workspace.brand.description, workspace.brand.name, workspace.brand.cta].filter(Boolean).join('\n\n'),
        scenes: body.scenes || [name, '고객에게 필요한 이유', '핵심 특징과 사용 장면', workspace.brand.cta || '자세히 알아보기'],
        textProvider: body.textProvider || 'OpenAI',
        imageProvider: body.imageProvider || 'OpenAI',
        videoProvider: body.videoProvider || 'Google',
        updated: '내 초안',
        version: 1
      };
      db.campaigns.unshift(camp);
    }

    db.logAudit(workspaceId, userId, 'SAVE_CAMPAIGN', camp.id, { designMode: camp.designMode, version: camp.version });
    db.save();
    sendJson(res, 200, { ok: true, campaign: camp });
    return;
  }

  // POST /api/workspaces/:workspaceId/campaigns/:id/concepts (Plan 3 distinct concepts or refine 1 concept)
  const conceptsMatch = subPath.match(/^\/campaigns\/([^/]+)\/concepts$/);
  if (method === 'POST' && conceptsMatch) {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const campaignId = conceptsMatch[1];
    const camp = db.campaigns.find(c => c.id === campaignId);
    assertEntityWorkspace(db, userId, camp, workspaceId, '캠페인');

    const body = await readRequestBody(req);
    const designMode = body.designMode || camp.designMode || 'creative';
    const providerName = body.provider || camp.textProvider || 'OpenAI';
    const adapter = getAdapter(providerName, 'concept_plan');

    // Validate asset ownership if passed
    const reqProdIds = Array.isArray(body.productAssetIds) ? body.productAssetIds : (camp.productAssetIds || []);
    const reqRefIds = Array.isArray(body.referenceAssetIds) ? body.referenceAssetIds : (camp.referenceAssetIds || []);

    const prodAssets = [];
    for (const id of reqProdIds) {
      const a = db.assets.find(x => x.id === id || (x.workspaceId === workspaceId && x.legacyId === id));
      if (!a) throw new HttpError(404, `제품 자료(${id})를 찾을 수 없습니다.`, 'ASSET_NOT_FOUND');
      assertEntityWorkspace(db, userId, a, workspaceId, '제품 사진');
      if (a.role !== 'product') {
        throw new HttpError(400, `자료(${a.name})는 실제 제품 사진(product) 분류가 아닙니다. 참고 이미지나 로고를 제품 원본 대신 사용할 수 없습니다.`, 'INVALID_ASSET_ROLE');
      }
      prodAssets.push(a);
    }
    if (!prodAssets.length) {
      // Fallback to workspace catalog product assets if available
      prodAssets.push(...db.assets.filter(a => a.workspaceId === workspaceId && a.role === 'product').slice(0, 1));
    }

    const refAssets = [];
    for (const id of reqRefIds) {
      const a = db.assets.find(x => x.id === id || (x.workspaceId === workspaceId && x.legacyId === id));
      if (!a) throw new HttpError(404, `참고 자료(${id})를 찾을 수 없습니다.`, 'ASSET_NOT_FOUND');
      assertEntityWorkspace(db, userId, a, workspaceId, '참고 이미지');
      if (a.role !== 'reference') {
        throw new HttpError(400, `자료(${a.name})는 참고 이미지(reference) 분류가 아닙니다.`, 'INVALID_ASSET_ROLE');
      }
      refAssets.push(a);
    }

    // Idempotency check
    const idempotencyKey = body.idempotencyKey || null;
    if (idempotencyKey) {
      const existingJob = db.generationJobs.find(
        j => j.workspaceId === workspaceId && j.idempotencyKey === idempotencyKey
      );
      if (existingJob) {
        const existingConcepts = db.concepts.filter(c => c.workspaceId === workspaceId && c.campaignId === campaignId);
        sendJson(res, 200, { ok: true, deduplicated: true, job: existingJob, concepts: existingConcepts });
        return;
      }
    }

    const estimate = adapter.estimate('concept_plan', {
      singleConceptId: body.refineConceptId,
      allowLiveExecution: body.allowLiveExecution
    });
    const reserved = db.reserveBudget(estimate.costEstimate);

    const job = {
      id: makeId('job'),
      workspaceId,
      campaignId: camp.id,
      contentVersionId: `camp-${camp.id}-v${camp.version || 1}`,
      jobType: 'concept_plan',
      provider: adapter.name,
      model: estimate.model,
      providerMode: estimate.providerMode,
      state: 'running',
      idempotencyKey,
      upstreamId: null,
      costEstimate: estimate.costEstimate,
      actualUsage: 0,
      reservedBudget: reserved,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.generationJobs.unshift(job);

    try {
      const sub = await adapter.submit('concept_plan', body);
      job.upstreamId = sub.upstreamId;

      const generatedThree = buildThreeConcepts({
        workspace,
        campaign: {
          ...camp,
          audience: body.audience || camp.audience,
          goal: body.goal || camp.goal,
          topic: body.topic || camp.topic
        },
        designMode,
        productAssets: prodAssets,
        referenceAssets: refAssets,
        providerMode: estimate.providerMode,
        variationSeed: body.variationNote || ''
      });

      let resultConcepts;
      if (body.refineConceptId) {
        // Refine only the single targeted concept while keeping the other 2 intact
        const currentList = db.concepts.filter(c => c.workspaceId === workspaceId && c.campaignId === camp.id);
        const targetIdx = currentList.findIndex(c => c.id === body.refineConceptId);
        if (targetIdx < 0) throw new HttpError(404, '수정할 콘셉트를 찾을 수 없습니다.', 'CONCEPT_NOT_FOUND');
        const replacement = {
          ...generatedThree[targetIdx % 3],
          id: currentList[targetIdx].id,
          name: `${generatedThree[targetIdx % 3].name.replace(/ \(.*\)$/, '')} · 수정 v${(currentList[targetIdx].version || 1) + 1}`,
          version: (currentList[targetIdx].version || 1) + 1,
          selected: currentList[targetIdx].selected
        };
        if (body.revisionPrompt) {
          replacement.messageDirection = `[반영: ${body.revisionPrompt}] ${replacement.messageDirection}`;
          replacement.copyPlan.titles[0] = `${body.revisionPrompt}\n${workspace.brand.name}`;
        }
        const idxInGlobal = db.concepts.findIndex(c => c.id === body.refineConceptId);
        db.concepts[idxInGlobal] = replacement;
        resultConcepts = db.concepts.filter(c => c.workspaceId === workspaceId && c.campaignId === camp.id);
      } else {
        // Replace campaign concepts with the new 3 distinct proposals
        db.state.concepts = [
          ...db.concepts.filter(c => !(c.workspaceId === workspaceId && c.campaignId === camp.id)),
          ...generatedThree
        ];
        resultConcepts = generatedThree;
      }

      camp.designMode = designMode;
      if (designMode !== 'template') camp.templateId = null;
      camp.updatedAt = new Date().toISOString();

      job.state = 'succeeded';
      job.actualUsage = estimate.costEstimate;
      job.updatedAt = new Date().toISOString();
      db.commitBudget(reserved, estimate.costEstimate);

      db.logAudit(workspaceId, userId, 'PLAN_CONCEPTS', camp.id, {
        jobId: job.id,
        designMode,
        providerMode: estimate.providerMode,
        conceptCount: resultConcepts.length
      });
      db.save();
      sendJson(res, 200, { ok: true, job, concepts: resultConcepts, settings: db.settings });
    } catch (err) {
      job.state = 'failed';
      job.error = err.message;
      db.releaseBudget(reserved);
      db.save();
      throw err;
    }
    return;
  }

  // POST /api/workspaces/:workspaceId/concepts/:id/select (Select a concept & build layered channel contents)
  const selectConceptMatch = subPath.match(/^\/concepts\/([^/]+)\/select$/);
  if (method === 'POST' && selectConceptMatch) {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const conceptId = selectConceptMatch[1];
    const targetConcept = db.concepts.find(c => c.id === conceptId);
    assertEntityWorkspace(db, userId, targetConcept, workspaceId, '콘셉트');

    const camp = db.campaigns.find(c => c.id === targetConcept.campaignId);
    assertEntityWorkspace(db, userId, camp, workspaceId, '캠페인');

    for (const c of db.concepts.filter(x => x.workspaceId === workspaceId && x.campaignId === camp.id)) {
      c.selected = c.id === conceptId;
    }

    // Apply selected concept's copy & structure to campaign and create/update channel Content records
    camp.selectedConceptId = targetConcept.id;
    camp.selectedConceptVersion = targetConcept.version;
    camp.titles = [...targetConcept.copyPlan.titles];
    camp.caption = targetConcept.copyPlan.caption;
    camp.scenes = [...targetConcept.copyPlan.scenes];
    camp.status = '검토 대기'; // Selecting a new concept resets approval to pending review
    camp.version = (camp.version || 1) + 1;

    const prodAssetId = targetConcept.assetRefs?.productAssetIds?.[0];
    const prodAsset = db.assets.find(a => a.id === prodAssetId) ||
      db.assets.find(a => a.workspaceId === workspaceId && a.role === 'product') || null;
    const logoAsset = db.assets.find(a => a.workspaceId === workspaceId && a.role === 'logo') || null;

    const createdContents = [];
    for (const chId of camp.channels || ['instagram', 'kakao', 'blog', 'youtube', 'reels']) {
      const layers = buildContentLayers({
        workspace,
        campaign: camp,
        concept: targetConcept,
        channelId: chId,
        productAsset: prodAsset,
        logoAsset
      });

      let content = db.contents.find(
        x => x.workspaceId === workspaceId && x.campaignId === camp.id && x.channelId === chId
      );
      if (content) {
        content.conceptId = targetConcept.id;
        content.layers = layers;
        content.titles = [...camp.titles];
        content.caption = camp.caption;
        content.scenes = camp.scenes.map((text, idx) => ({
          sceneNo: idx + 1,
          subtitle: text,
          visualGenerated: false,
          visualSource: 'product_original_composite'
        }));
        content.state = 'draft_ready';
        content.approvedVersion = null;
        content.mp4File = null;
        content.version = (content.version || 1) + 1;
      } else {
        content = {
          id: makeId('content'),
          workspaceId,
          campaignId: camp.id,
          channelId: chId,
          conceptId: targetConcept.id,
          layers,
          titles: [...camp.titles],
          caption: camp.caption,
          scenes: camp.scenes.map((text, idx) => ({
            sceneNo: idx + 1,
            subtitle: text,
            visualGenerated: false,
            visualSource: 'product_original_composite'
          })),
          videoSpec: {
            mode: 'photo_motion',
            durationSec: 20,
            narration: { enabled: true, voice: 'ko-KR-Standard-A', lines: [...camp.scenes] },
            musicPreset: 'upbeat-acoustic',
            logoOverlay: true,
            scenesGenerated: false,
            mp4Rendered: false
          },
          mp4File: null,
          state: 'draft_ready',
          approvedVersion: null,
          version: 1,
          updatedAt: new Date().toISOString()
        };
        db.contents.push(content);
      }
      createdContents.push(content);
    }

    db.logAudit(workspaceId, userId, 'SELECT_CONCEPT', targetConcept.id, {
      campaignId: camp.id,
      conceptVersion: targetConcept.version
    });
    db.save();
    sendJson(res, 200, {
      ok: true,
      concept: targetConcept,
      campaign: camp,
      contents: createdContents
    });
    return;
  }

  // POST /api/workspaces/:workspaceId/contents/:id/generate (Generate background image or video scenes with budget & idempotency)
  const genContentMatch = subPath.match(/^\/contents\/([^/]+)\/generate$/);
  if (method === 'POST' && genContentMatch) {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const contentId = genContentMatch[1];
    const content = db.contents.find(c => c.id === contentId);
    assertEntityWorkspace(db, userId, content, workspaceId, '콘텐츠');

    const camp = db.campaigns.find(c => c.id === content.campaignId);
    assertEntityWorkspace(db, userId, camp, workspaceId, '캠페인');

    const body = await readRequestBody(req);
    const idempotencyKey = body.idempotencyKey || null;
    if (idempotencyKey) {
      const existingJob = db.generationJobs.find(
        j => j.workspaceId === workspaceId && j.idempotencyKey === idempotencyKey
      );
      if (existingJob) {
        sendJson(res, 200, { ok: true, deduplicated: true, job: existingJob, content });
        return;
      }
    }

    const isVideoChannel = ['youtube', 'reels'].includes(content.channelId);
    const jobType = body.jobType || (isVideoChannel ? 'scene_gen' : 'image_gen');
    const providerName = body.provider || (jobType === 'scene_gen' ? (camp.videoProvider || 'Google') : (camp.imageProvider || 'OpenAI'));
    const adapter = getAdapter(providerName, jobType);

    const estimate = adapter.estimate(jobType, {
      cardCount: 1,
      sceneCount: 4,
      allowLiveExecution: body.allowLiveExecution
    });
    const reserved = db.reserveBudget(estimate.costEstimate);

    // Pin target workspace/campaign/content/version at job creation time
    const pinnedVersion = content.version;
    const job = {
      id: makeId('job'),
      workspaceId,
      campaignId: camp.id,
      contentId: content.id,
      contentVersionId: `${content.id}-v${pinnedVersion}`,
      channelId: content.channelId,
      jobType,
      provider: adapter.name,
      model: estimate.model,
      providerMode: estimate.providerMode,
      state: 'running',
      idempotencyKey,
      upstreamId: null,
      costEstimate: estimate.costEstimate,
      actualUsage: 0,
      reservedBudget: reserved,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.generationJobs.unshift(job);

    const sub = await adapter.submit(jobType, body);
    job.upstreamId = sub.upstreamId;

    // Support timeout simulation for reconciliation verification
    if (body.simulateTimeout) {
      job.state = 'reconciling';
      job.updatedAt = new Date().toISOString();
      db.logAudit(workspaceId, userId, 'JOB_TIMEOUT_RECONCILING', job.id, { upstreamId: job.upstreamId });
      db.save();
      sendJson(res, 202, {
        ok: true,
        job,
        content,
        message: '공급자 응답 지연으로 상태 확인(reconciling) 단계로 전환되었습니다. 중복 결제 없이 상태를 조회합니다.'
      });
      return;
    }

    if (jobType === 'scene_gen') {
      content.scenes = (content.scenes || []).map((s, i) => ({
        ...s,
        sceneNo: i + 1,
        visualGenerated: true,
        visualSource: body.videoMode === 'generated' ? 'generated_scene_clip' : 'product_original_motion_scene',
        generatedAt: new Date().toISOString()
      }));
      content.videoSpec ||= {};
      content.videoSpec.scenesGenerated = true;
      content.videoSpec.mp4Rendered = false; // Scene generation is distinct from final MP4 synthesis!
      content.state = 'scenes_ready';
    } else {
      content.layers ||= {};
      content.layers.backgroundLayer ||= {};
      content.layers.backgroundLayer.generatedAt = new Date().toISOString();
      content.layers.backgroundLayer.provenance = estimate.providerMode === 'live' ? 'api_generated_bg' : 'mock_generated_bg';
      content.state = 'generated_ready';
    }

    content.version = pinnedVersion + 1;
    content.approvedVersion = null;
    if (camp.status === '승인 완료') camp.status = '검토 대기';

    job.state = 'succeeded';
    job.actualUsage = estimate.costEstimate;
    job.updatedAt = new Date().toISOString();
    db.commitBudget(reserved, estimate.costEstimate);
    db.logAudit(workspaceId, userId, 'GENERATE_CONTENT', content.id, {
      jobId: job.id,
      jobType,
      providerMode: estimate.providerMode
    });
    db.save();
    sendJson(res, 200, { ok: true, job, content, settings: db.settings });
    return;
  }

  // POST /api/workspaces/:workspaceId/contents/:id/revise
  // Partial revision: text/layer/subtitle edits do NOT call paid image/video generation APIs and invalidate prior approval!
  const reviseContentMatch = subPath.match(/^\/contents\/([^/]+)\/revise$/);
  if (method === 'POST' && reviseContentMatch) {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const contentId = reviseContentMatch[1];
    const content = db.contents.find(c => c.id === contentId);
    assertEntityWorkspace(db, userId, content, workspaceId, '콘텐츠');

    const camp = db.campaigns.find(c => c.id === content.campaignId);
    assertEntityWorkspace(db, userId, camp, workspaceId, '캠페인');

    const body = await readRequestBody(req);
    const revisionType = body.revisionType || 'layer_text_edit'; // 'layer_text_edit' | 'subtitle_edit' | 'video_render' | 'approve'

    if (revisionType === 'approve') {
      content.approvedVersion = content.version;
      content.state = 'approved';
      camp.status = '승인 완료';
      db.logAudit(workspaceId, userId, 'APPROVE_CONTENT_VERSION', content.id, {
        approvedVersion: content.approvedVersion
      });
      db.save();
      sendJson(res, 200, { ok: true, content, campaign: camp, paidApiCalled: false });
      return;
    }

    if (revisionType === 'video_render') {
      // Synthesize MP4 from scenes + subtitles + voice + music + logo (0 paid scene gen cost!)
      const mp4Result = synthesizeMp4File({
        workspaceId,
        campaignId: camp.id,
        contentId: content.id,
        contentVersion: content.version,
        brandName: workspace.brand.name,
        scenes: content.scenes,
        subtitles: body.subtitles || content.scenes.map(s => s.subtitle),
        narration: body.narration || content.videoSpec?.narration || {},
        musicPreset: body.musicPreset || content.videoSpec?.musicPreset || 'upbeat-acoustic',
        logoText: workspace.brand.name,
        durationSec: Number(body.durationSec) || 20
      });
      content.videoSpec ||= {};
      content.videoSpec.mp4Rendered = true;
      content.videoSpec.renderedVersion = content.version;
      content.mp4File = {
        fileName: mp4Result.fileName,
        byteSize: mp4Result.byteSize,
        sha256: mp4Result.sha256,
        durationSec: mp4Result.durationSec,
        resolution: mp4Result.resolution,
        downloadUrl: `/api/workspaces/${workspaceId}/contents/${content.id}/export?format=mp4`
      };
      content.state = 'mp4_ready';
      db.logAudit(workspaceId, userId, 'SYNTHESIZE_MP4', content.id, {
        fileName: mp4Result.fileName,
        byteSize: mp4Result.byteSize
      });
      db.save();
      sendJson(res, 200, { ok: true, content, mp4: content.mp4File, paidApiCalled: false });
      return;
    }

    // Text, layer placement, or subtitle edit — strictly free local compositor operation!
    if (body.titles && Array.isArray(body.titles)) {
      content.titles = [...body.titles];
      if (content.layers?.textLayers) content.layers.textLayers.cardTitles = [...body.titles];
      camp.titles = [...body.titles];
    }
    if (body.caption !== undefined) {
      content.caption = String(body.caption);
      camp.caption = String(body.caption);
    }
    if (body.layers) {
      content.layers = {
        ...content.layers,
        ...body.layers,
        productLayer: {
          ...(content.layers?.productLayer || {}),
          ...(body.layers.productLayer || {}),
          // Always preserve original unless explicitly toggled
          preserveOriginal: body.layers.productLayer?.aiRemixEnabled ? false : true
        }
      };
    }
    if (body.subtitles && Array.isArray(body.subtitles)) {
      content.scenes = (content.scenes || []).map((s, idx) => ({
        ...s,
        subtitle: body.subtitles[idx] !== undefined ? String(body.subtitles[idx]) : s.subtitle
      }));
      camp.scenes = content.scenes.map(s => s.subtitle);
      if (content.videoSpec) {
        content.videoSpec.mp4Rendered = false; // Subtitle edit requires re-running free MP4 compositor, NOT scene generation!
      }
    }

    // Increment version and invalidate any prior approval!
    content.version = (content.version || 1) + 1;
    content.approvedVersion = null;
    if (content.state === 'approved') content.state = 'draft_ready';
    if (camp.status === '승인 완료') camp.status = '검토 대기';
    content.updatedAt = new Date().toISOString();

    db.logAudit(workspaceId, userId, 'REVISE_CONTENT_FREE', content.id, {
      revisionType,
      newVersion: content.version,
      approvalInvalidated: true,
      paidApiCalled: false
    });
    db.save();
    sendJson(res, 200, {
      ok: true,
      content,
      campaign: camp,
      paidApiCalled: false,
      approvalInvalidated: true
    });
    return;
  }

  // GET /api/workspaces/:workspaceId/jobs/:id (Poll & reconcile job without double-billing)
  const jobMatch = subPath.match(/^\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobMatch) {
    requireWorkspaceAccess(db, userId, workspaceId, 'viewer');
    const jobId = jobMatch[1];
    const job = db.generationJobs.find(j => j.id === jobId);
    assertEntityWorkspace(db, userId, job, workspaceId, '생성 작업');

    if (job.state === 'reconciling' && urlObj.searchParams.get('reconcile') === 'true') {
      const adapter = getAdapter(job.provider, job.jobType);
      const polled = await adapter.poll(job.upstreamId, false);
      if (polled.status === 'succeeded') {
        job.state = 'succeeded';
        job.actualUsage = job.costEstimate;
        job.updatedAt = new Date().toISOString();
        db.commitBudget(job.reservedBudget, job.costEstimate);
        job.reservedBudget = 0;
        const content = db.contents.find(c => c.id === job.contentId);
        if (content) {
          content.state = job.jobType === 'scene_gen' ? 'scenes_ready' : 'generated_ready';
          content.version = (content.version || 1) + 1;
        }
        db.logAudit(workspaceId, userId, 'RECONCILE_JOB_SUCCEEDED', job.id, { upstreamId: job.upstreamId });
        db.save();
      }
    }
    sendJson(res, 200, { ok: true, job, settings: db.settings });
    return;
  }

  // GET or POST /api/workspaces/:workspaceId/contents/:id/export
  const exportMatch = subPath.match(/^\/contents\/([^/]+)\/export$/);
  if ((method === 'POST' || method === 'GET') && exportMatch) {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'viewer');
    const contentId = exportMatch[1];
    const content = db.contents.find(c => c.id === contentId);
    assertEntityWorkspace(db, userId, content, workspaceId, '콘텐츠');

    const body = method === 'POST' ? await readRequestBody(req) : {};
    const format = body.format || urlObj.searchParams.get('format') || (['youtube', 'reels'].includes(content.channelId) ? 'mp4' : 'svg');

    if (format === 'mp4') {
      if (!content.mp4File || !content.videoSpec?.mp4Rendered) {
        throw new HttpError(
          400,
          '장면표 상태에서는 MP4를 다운로드할 수 없습니다. 먼저 장면 생성 및 MP4 합성 렌더링을 실행해 주세요.',
          'MP4_NOT_RENDERED'
        );
      }
      const mp4Path = path.join(RENDER_DIR, path.basename(content.mp4File.fileName));
      if (!fs.existsSync(mp4Path)) {
        throw new HttpError(404, '합성된 MP4 파일을 찾을 수 없습니다.', 'MP4_FILE_MISSING');
      }
      if (method === 'GET') {
        const bytes = fs.readFileSync(mp4Path);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${content.mp4File.fileName}"`,
          'Content-Length': bytes.length
        });
        res.end(bytes);
        return;
      }
      sendJson(res, 200, {
        ok: true,
        exportType: 'mp4',
        pinnedWorkspaceId: workspaceId,
        pinnedContentVersion: content.version,
        mp4: content.mp4File
      });
      return;
    }

    const svgCard = renderLayeredCardSvg({
      layers: content.layers,
      brandName: workspace.brand.name,
      cardIndex: Number(body.cardIndex || 0),
      totalCards: 5,
      format: content.channelId
    });
    sendJson(res, 200, {
      ok: true,
      exportType: format,
      pinnedWorkspaceId: workspaceId,
      pinnedContentVersion: content.version,
      svg: svgCard,
      caption: content.caption
    });
    return;
  }

  // GET /api/workspaces/:workspaceId/channels/:provider/connect (Start per-workspace OAuth)
  const channelConnectMatch = subPath.match(/^\/channels\/([a-z]+)\/connect$/);
  if (method === 'GET' && channelConnectMatch) {
    requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const provider = channelConnectMatch[1];
    if (!['instagram', 'youtube'].includes(provider)) {
      throw new HttpError(
        400,
        `${provider} 채널은 공개 API 글쓰기/소식 등록을 지원하지 않아 관리자 직접 게시 방식을 사용합니다.`,
        'MANUAL_ONLY_CHANNEL'
      );
    }
    const stateToken = signStatePayload({
      workspaceId,
      userId,
      provider,
      nonce: makeId('nonce'),
      expiresAt: Date.now() + 10 * 60 * 1000
    });
    const callbackUrl = `/api/channels/${provider}/callback?state=${encodeURIComponent(stateToken)}&format=json`;
    sendJson(res, 200, {
      ok: true,
      provider,
      workspaceId,
      stateToken,
      sandboxAuthorizeUrl: callbackUrl,
      mode: 'oauth_sandbox'
    });
    return;
  }

  // POST /api/workspaces/:workspaceId/publications/prepare (Pre-publish verification)
  if (method === 'POST' && subPath === '/publications/prepare') {
    const { workspace } = requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);
    const content = db.contents.find(c => c.id === body.contentId);
    assertEntityWorkspace(db, userId, content, workspaceId, '게시 대상 콘텐츠');

    const camp = db.campaigns.find(c => c.id === content.campaignId);
    assertEntityWorkspace(db, userId, camp, workspaceId, '게시 대상 캠페인');

    const channelId = body.channelId || content.channelId;
    const platformKey = channelId === 'reels' ? 'instagram' : channelId;
    const conn = db.channelConnections.find(
      c => c.workspaceId === workspaceId && c.platform === platformKey
    );
    assertEntityWorkspace(db, userId, conn, workspaceId, '채널 연결 계정');

    const isDirectApi = ['instagram', 'reels', 'youtube'].includes(channelId);
    const isVideo = ['youtube', 'reels'].includes(channelId);

    // Check 1: Content version approval must match current content.version
    if (content.approvedVersion !== content.version) {
      throw new HttpError(
        409,
        `콘텐츠가 수정되어 이전 승인 상태가 무효화되었습니다 (현재 v${content.version}). 다시 검토 및 디자인 승인 후 게시해 주세요.`,
        'CONTENT_VERSION_UNAPPROVED'
      );
    }

    // Check 2: Video channels require rendered MP4, not storyboard!
    if (isVideo && (!content.videoSpec?.mp4Rendered || !content.mp4File)) {
      throw new HttpError(
        400,
        '장면표만으로는 쇼츠/릴스에 게시할 수 없습니다. 먼저 MP4 영상 합성을 완료해 주세요.',
        'MP4_REQUIRED_FOR_VIDEO_PUBLISH'
      );
    }

    // Check 3: Direct API channels require OAuth connection (URL registration alone is NOT OAuth!)
    if (isDirectApi && body.mode === 'api_publish') {
      if (conn.state !== 'connected' || !conn.secretRef) {
        throw new HttpError(
          400,
          `${platformKey} 채널의 OAuth 게시 권한이 연결되지 않았습니다. 공개 주소 등록만으로는 자동 게시할 수 없습니다.`,
          'OAUTH_NOT_CONNECTED'
        );
      }
    }

    // Check 4: YouTube specific metadata requirements
    if (channelId === 'youtube' && body.mode === 'api_publish') {
      if (!['public', 'unlisted', 'private'].includes(body.youtubePrivacy || 'public')) {
        throw new HttpError(400, 'YouTube 공개 범위 설정이 필요합니다.', 'YOUTUBE_PRIVACY_REQUIRED');
      }
      if (typeof body.madeForKids !== 'boolean') {
        throw new HttpError(400, 'YouTube 아동용 콘텐츠 여부(madeForKids) 확인이 필요합니다.', 'YOUTUBE_KIDS_FLAG_REQUIRED');
      }
    }

    // Check 5: Kakao paid customer message vs general post separation
    if (channelId === 'kakao' && body.kakaoPaidBroadcast) {
      if (!body.explicitUserBroadcastInstruction || !body.recipientScopeConfirmed) {
        throw new HttpError(
          403,
          '카카오톡 유료 고객 메시지 발송은 일반 소식 게시와 구분되며, 구체적인 발송 지시·수신 대상·예산 승인이 필요합니다.',
          'KAKAO_PAID_MESSAGE_RESTRICTED'
        );
      }
    }

    const pub = {
      id: makeId('pub'),
      workspaceId,
      campaignId: camp.id,
      channelId,
      contentId: content.id,
      contentVersionId: `${content.id}-v${content.version}`,
      pinnedContentVersion: content.version,
      connectionId: conn.id,
      accountName: conn.accountName || workspace.brand?.accounts?.[platformKey] || '',
      state: 'prepared',
      idempotencyKey: body.idempotencyKey || null,
      youtubeMeta: channelId === 'youtube' ? {
        privacyStatus: body.youtubePrivacy || 'unlisted',
        madeForKids: Boolean(body.madeForKids)
      } : null,
      remotePostId: null,
      remoteUrl: null,
      manualRecord: null,
      createdAt: new Date().toISOString(),
      publishedAt: null
    };
    db.publications.unshift(pub);
    db.logAudit(workspaceId, userId, 'PREPARE_PUBLICATION', pub.id, {
      channelId,
      contentVersionId: pub.contentVersionId
    });
    db.save();
    sendJson(res, 200, { ok: true, publication: pub });
    return;
  }

  // POST /api/workspaces/:workspaceId/publications (Execute confirmed API publication or record manual URL)
  if (method === 'POST' && subPath === '/publications') {
    requireWorkspaceAccess(db, userId, workspaceId, 'editor');
    const body = await readRequestBody(req);

    // Handle manual URL record separately from API publication
    if (body.manualUrl) {
      const channelId = body.channelId || 'instagram';
      const platformKey = channelId === 'reels' ? 'instagram' : channelId;
      const safeUrl = validateSafeExternalUrl(body.manualUrl, platformKey);
      const manualPub = {
        id: makeId('pub-manual'),
        workspaceId,
        campaignId: body.campaignId,
        channelId,
        contentId: body.contentId || null,
        contentVersionId: body.contentVersionId || null,
        connectionId: null,
        state: 'manual_record',
        idempotencyKey: null,
        remotePostId: null,
        remoteUrl: safeUrl,
        manualRecord: { url: safeUrl, recordedBy: userId, at: new Date().toISOString() },
        createdAt: new Date().toISOString(),
        publishedAt: new Date().toISOString()
      };
      db.publications.unshift(manualPub);
      db.logAudit(workspaceId, userId, 'RECORD_MANUAL_PUBLICATION', manualPub.id, { channelId, url: safeUrl });
      db.save();
      sendJson(res, 201, { ok: true, publication: manualPub });
      return;
    }

    const pub = db.publications.find(p => p.id === body.publicationId);
    assertEntityWorkspace(db, userId, pub, workspaceId, '게시 준비 레코드');

    if (pub.state === 'published') {
      sendJson(res, 200, { ok: true, deduplicated: true, publication: pub });
      return;
    }
    if (pub.state === 'reconciling') {
      throw new HttpError(
        409,
        '이전 게시 요청의 공급자 결과를 확인 중(reconciling)입니다. 중복 게시를 막기 위해 먼저 결과 조회를 수행해 주세요.',
        'PUBLICATION_RECONCILING'
      );
    }

    const content = db.contents.find(c => c.id === pub.contentId);
    assertEntityWorkspace(db, userId, content, workspaceId, '콘텐츠');

    // Verify content was NOT modified after prepare/approval!
    if (content.version !== pub.pinnedContentVersion || content.approvedVersion !== content.version) {
      throw new HttpError(
        409,
        '게시 준비 이후 콘텐츠가 수정되어 이전 승인으로 게시할 수 없습니다. 다시 검토 후 승인해 주세요.',
        'STALE_APPROVAL_REJECTED'
      );
    }

    const platformKey = pub.channelId === 'reels' ? 'instagram' : pub.channelId;
    const conn = db.channelConnections.find(c => c.id === pub.connectionId);
    assertEntityWorkspace(db, userId, conn, workspaceId, '채널 연결');
    if (conn.state !== 'connected' || !conn.secretRef) {
      throw new HttpError(400, '채널 OAuth 게시 인증이 유효하지 않습니다.', 'OAUTH_REQUIRED');
    }

    if (body.simulateTimeout) {
      pub.state = 'reconciling';
      pub.remotePostId = `pending-${platformKey}-${makeId('post')}`;
      db.logAudit(workspaceId, userId, 'PUBLICATION_TIMEOUT_RECONCILING', pub.id, {
        remotePostId: pub.remotePostId
      });
      db.save();
      sendJson(res, 202, {
        ok: true,
        publication: pub,
        message: '게시 타임아웃 발생 — 중복 게시 방지를 위해 공급자 결과 확인(reconciling) 상태로 전환되었습니다.'
      });
      return;
    }

    pub.state = 'published';
    pub.providerMode = body.allowLivePublish ? 'live_api' : 'mock_api';
    pub.remotePostId = `${platformKey}-post-${makeId('id')}`;
    pub.remoteUrl = platformKey === 'instagram'
      ? `https://www.instagram.com/p/${pub.remotePostId}/`
      : `https://www.youtube.com/shorts/${pub.remotePostId}`;
    pub.publishedAt = new Date().toISOString();

    db.logAudit(workspaceId, userId, 'PUBLISH_SUCCEEDED', pub.id, {
      channelId: pub.channelId,
      remotePostId: pub.remotePostId,
      providerMode: pub.providerMode
    });
    db.save();
    sendJson(res, 200, { ok: true, publication: pub });
    return;
  }

  // GET /api/workspaces/:workspaceId/publications/:id (Check upstream result & resolve reconciling state)
  const pubGetMatch = subPath.match(/^\/publications\/([^/]+)$/);
  if (method === 'GET' && pubGetMatch) {
    requireWorkspaceAccess(db, userId, workspaceId, 'viewer');
    const pubId = pubGetMatch[1];
    const pub = db.publications.find(p => p.id === pubId);
    assertEntityWorkspace(db, userId, pub, workspaceId, '게시 기록');

    if (pub.state === 'reconciling') {
      const platformKey = pub.channelId === 'reels' ? 'instagram' : pub.channelId;
      pub.state = 'published';
      pub.providerMode = 'mock_api_reconciled';
      pub.remoteUrl = platformKey === 'instagram'
        ? `https://www.instagram.com/p/${pub.remotePostId}/`
        : `https://www.youtube.com/shorts/${pub.remotePostId}`;
      pub.publishedAt = new Date().toISOString();
      db.logAudit(workspaceId, userId, 'RECONCILE_PUBLICATION_RESOLVED', pub.id, {
        remotePostId: pub.remotePostId
      });
      db.save();
    }
    sendJson(res, 200, { ok: true, publication: pub });
    return;
  }

  throw new HttpError(404, '지원하지 않는 API 경로입니다.', 'UNKNOWN_ENDPOINT');
}

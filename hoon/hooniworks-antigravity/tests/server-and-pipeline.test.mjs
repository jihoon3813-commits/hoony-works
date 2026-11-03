import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HooniDatabase } from '../src/server/db.mjs';
import { createHooniServer } from '../src/server/app-server.mjs';

// Create isolated temporary DB for test run so we never overwrite user runtime data
const tmpDbFile = path.join(os.tmpdir(), `hooniworks-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const testDb = new HooniDatabase(tmpDbFile);
const server = createHooniServer(testDb);

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const baseUrl = `http://127.0.0.1:${port}`;

async function api(pathname, { method = 'GET', body, user = 'user-jh', raw = false } = {}) {
  const headers = { 'X-Hooni-User': user };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const data = await res.json();
  return { status: res.status, data };
}

try {
  // 1. Session & Initial 120pie Workspace Isolation
  const sess = await api('/api/session');
  assert.equal(sess.status, 200);
  assert.equal(sess.data.user.id, 'user-jh');
  assert.equal(sess.data.workspaces.length, 1);
  assert.equal(sess.data.workspaces[0].id, 'brand-120pie');
  assert.equal(JSON.stringify(sess.data).includes('secretRef'), false, 'secretRef must never leak to client');

  // 2. Create New Service Workspace (Empty, no 120pie bleed)
  const createdWs = await api('/api/workspaces', {
    method: 'POST',
    body: {
      name: '케어플러스 구독',
      category: '멤버십·구독',
      color: '#5b4bc4',
      audience: '정기 홈케어 구독 고객',
      description: '매월 방문하는 홈케어 정기 구독 서비스',
      approvedFacts: [
        { claim: '월 1회 전문 매니저 방문 점검 포함', source: '케어플러스 약관 v1', confirmedDate: '2026-11-03', version: 1 }
      ]
    }
  });
  assert.equal(createdWs.status, 201);
  const ws2Id = createdWs.data.workspace.id;
  assert.notEqual(ws2Id, 'brand-120pie');
  assert.equal(createdWs.data.workspace.campaigns.length, 0);
  assert.equal(createdWs.data.workspace.uploads.length, 0);
  assert.equal(/120|파이|애플/.test(JSON.stringify(createdWs.data.workspace)), false, 'new workspace must not contain 120pie content');

  // 3. Unauthorized User & Cross-Workspace Access Rejection
  const unauthAccess = await api(`/api/workspaces/${ws2Id}`, { user: 'user-guest' });
  assert.equal(unauthAccess.status, 403);
  assert.equal(unauthAccess.data.code, 'FORBIDDEN_WORKSPACE');

  // Attempt cross-workspace campaign access (using 120pie campaign sample-1 inside ws2Id URL)
  const crossCamp = await api(`/api/workspaces/${ws2Id}/campaigns/sample-1/concepts`, {
    method: 'POST',
    body: { designMode: 'creative' }
  });
  assert.equal(crossCamp.status, 403);
  assert.equal(crossCamp.data.code, 'CROSS_WORKSPACE_FORBIDDEN');

  // 4. Optimistic Concurrency Version Check & SSRF URL Protection
  const stalePatch = await api(`/api/workspaces/${ws2Id}`, {
    method: 'PATCH',
    body: { expectedVersion: 999, brand: { name: '충돌 테스트' } }
  });
  assert.equal(stalePatch.status, 409);
  assert.equal(stalePatch.data.code, 'VERSION_CONFLICT');

  const ssrfPatch = await api(`/api/workspaces/${ws2Id}`, {
    method: 'PATCH',
    body: { brand: { links: { website: 'https://127.0.0.1:8080/admin' } } }
  });
  assert.equal(ssrfPatch.status, 400);
  assert.equal(ssrfPatch.data.code, 'SSRF_BLOCKED');

  // 5. Original Asset Upload Validation (Valid 1x1 PNG vs Malicious SVG disguised as PNG)
  const badInit = await api(`/api/workspaces/${ws2Id}/assets/upload-init`, {
    method: 'POST',
    body: { fileName: 'hack.svg', mimeType: 'image/svg+xml', byteSize: 100, role: 'product' }
  });
  assert.equal(badInit.status, 400);

  const upInit = await api(`/api/workspaces/${ws2Id}/assets/upload-init`, {
    method: 'POST',
    body: { fileName: 'care-kit.png', mimeType: 'image/png', byteSize: 68, role: 'product', menu: '케어키트' }
  });
  assert.equal(upInit.status, 200);
  const sessionId = upInit.data.uploadSession.id;

  // Try uploading disguised SVG/HTML bytes to valid session
  const svgDisguised = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  const disguisedRes = await api(`/api/workspaces/${ws2Id}/assets/upload-complete`, {
    method: 'POST',
    body: { uploadSessionId: sessionId, base64Data: svgDisguised }
  });
  assert.equal(disguisedRes.status, 400);
  assert.equal(disguisedRes.data.code, 'DISALLOWED_CONTENT');

  // Upload real valid 1x1 PNG
  const validPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const upComplete = await api(`/api/workspaces/${ws2Id}/assets/upload-complete`, {
    method: 'POST',
    body: { uploadSessionId: sessionId, base64Data: validPngBase64 }
  });
  assert.equal(upComplete.status, 201);
  const uploadedAssetId = upComplete.data.asset.id;
  assert.equal(upComplete.data.asset.width, 1);
  assert.equal(upComplete.data.asset.height, 1);

  // Cross-workspace file fetch must fail
  const crossFile = await api(`/api/workspaces/brand-120pie/assets/${uploadedAssetId}/file`);
  assert.equal(crossFile.status, 403);

  // 6. Browser Data Import (Deduplication, Preview-Only Detection & Partial Failure)
  const importRes1 = await api(`/api/workspaces/${ws2Id}/import`, {
    method: 'POST',
    body: {
      campaigns: [{ id: 'imp-camp-1', name: '봄맞이 홈케어 캠페인', audience: 'consumer', topic: '정기 점검 혜택', designMode: 'creative' }],
      uploads: [
        { id: 'imp-up-orig', name: 'orig.png', role: 'product', img: 'data:image/png;base64,' + validPngBase64, hasOriginalBlob: true },
        { id: 'imp-up-prev', name: 'preview-only.webp', role: 'reference', img: 'data:image/webp;base64,AAAA', hasOriginalBlob: false },
        { id: 'imp-up-fail', name: 'fail.png', role: 'product', simulateFailure: true }
      ],
      templates: [{ id: 'imp-tpl-1', name: '케어 전용 템플릿', layout: 'editorial' }]
    }
  });
  assert.equal(importRes1.status, 200);
  assert.equal(importRes1.data.report.importedCampaigns, 1);
  assert.equal(importRes1.data.report.importedAssets, 2);
  assert.equal(importRes1.data.report.previewOnlyAssets, 1);
  assert.equal(importRes1.data.report.failedItems.length, 1);

  // Re-importing same items must deduplicate
  const importRes2 = await api(`/api/workspaces/${ws2Id}/import`, {
    method: 'POST',
    body: {
      campaigns: [{ id: 'imp-camp-1', name: '봄맞이 홈케어 캠페인', audience: 'consumer', topic: '정기 점검 혜택' }],
      uploads: [{ id: 'imp-up-orig', name: 'orig.png', role: 'product', img: 'data:image/png;base64,' + validPngBase64, hasOriginalBlob: true }]
    }
  });
  assert.equal(importRes2.data.report.skippedDuplicateCampaigns, 1);
  assert.equal(importRes2.data.report.skippedDuplicateAssets, 1);

  // 7. Concept 3-Proposal Planning (Creative mode without templateId, role check, distinctness, single-concept refine)
  // Reject using reference asset as productAssetIds
  const roleMismatch = await api(`/api/workspaces/${ws2Id}/campaigns/imp-camp-1/concepts`, {
    method: 'POST',
    body: { designMode: 'creative', productAssetIds: ['imp-up-prev'], templateId: null }
  });
  assert.equal(roleMismatch.status, 400);
  assert.equal(roleMismatch.data.code, 'INVALID_ASSET_ROLE');

  const conceptsRes = await api(`/api/workspaces/${ws2Id}/campaigns/imp-camp-1/concepts`, {
    method: 'POST',
    body: {
      designMode: 'creative',
      productAssetIds: [uploadedAssetId],
      referenceAssetIds: ['imp-up-prev'],
      templateId: null,
      idempotencyKey: 'idem-plan-1'
    }
  });
  assert.equal(conceptsRes.status, 200);
  const concepts = conceptsRes.data.concepts;
  assert.equal(concepts.length, 3);
  // Verify all 3 concepts have genuinely different layout codes, typography, and message structures
  const layoutCodes = new Set(concepts.map(c => c.layoutPlan.code));
  const structureTypes = new Set(concepts.map(c => c.structureType));
  assert.equal(layoutCodes.size, 3, '3 concepts must have 3 distinct layout structures');
  assert.equal(structureTypes.size, 3, '3 concepts must have 3 distinct message structures');
  assert.equal(concepts.every(c => c.templateId === null), true, 'creative mode must not require templateId');

  // Verify idempotency prevents duplicate billing
  const usedBeforeDup = conceptsRes.data.settings.usedBudget;
  const dupConceptsRes = await api(`/api/workspaces/${ws2Id}/campaigns/imp-camp-1/concepts`, {
    method: 'POST',
    body: { designMode: 'creative', idempotencyKey: 'idem-plan-1' }
  });
  assert.equal(dupConceptsRes.data.deduplicated, true);

  // Refine only Concept 1 while keeping Concept 2 and 3 untouched
  const refineRes = await api(`/api/workspaces/${ws2Id}/campaigns/imp-camp-1/concepts`, {
    method: 'POST',
    body: {
      designMode: 'creative',
      refineConceptId: concepts[0].id,
      revisionPrompt: '첫 달 방문 점검 혜택 강조'
    }
  });
  assert.equal(refineRes.status, 200);
  assert.equal(refineRes.data.concepts[0].version, 2);
  assert.equal(refineRes.data.concepts[1].version, 1);
  assert.equal(refineRes.data.concepts[2].version, 1);

  // Select Concept 1
  const selectRes = await api(`/api/workspaces/${ws2Id}/concepts/${concepts[0].id}/select`, {
    method: 'POST',
    body: {}
  });
  assert.equal(selectRes.status, 200);
  const contents = selectRes.data.contents;
  assert.ok(contents.length >= 2);
  const instaContent = contents.find(c => c.channelId === 'instagram');
  const shortsContent = contents.find(c => c.channelId === 'youtube');
  assert.ok(instaContent.layers.backgroundLayer);
  assert.ok(instaContent.layers.productLayer.preserveOriginal);

  // 8. Approve Content -> Edit Text (0 API cost) -> Verify Prior Approval is Invalidated!
  const approve1 = await api(`/api/workspaces/${ws2Id}/contents/${instaContent.id}/revise`, {
    method: 'POST',
    body: { revisionType: 'approve' }
  });
  assert.equal(approve1.data.content.approvedVersion, approve1.data.content.version);

  const budgetBeforeTextEdit = testDb.settings.usedBudget;
  const textRevise = await api(`/api/workspaces/${ws2Id}/contents/${instaContent.id}/revise`, {
    method: 'POST',
    body: {
      revisionType: 'layer_text_edit',
      titles: ['수정한 첫 카드 제목', '두 번째 카드', '세 번째', '네 번째', '다섯 번째']
    }
  });
  assert.equal(textRevise.status, 200);
  assert.equal(textRevise.data.paidApiCalled, false);
  assert.equal(textRevise.data.approvalInvalidated, true);
  assert.equal(textRevise.data.content.approvedVersion, null);
  assert.equal(testDb.settings.usedBudget, budgetBeforeTextEdit, 'text edit must not consume paid API budget');

  // 9. Video Pipeline: Storyboard vs Scene Gen vs MP4 Synthesis & Customer Clean Output
  // Attempting MP4 export before synthesis must fail
  const prematureMp4 = await api(`/api/workspaces/${ws2Id}/contents/${shortsContent.id}/export?format=mp4`);
  assert.equal(prematureMp4.status, 400);
  assert.equal(prematureMp4.data.code, 'MP4_NOT_RENDERED');

  // Step 1: Generate scenes
  const sceneGenRes = await api(`/api/workspaces/${ws2Id}/contents/${shortsContent.id}/generate`, {
    method: 'POST',
    body: { jobType: 'scene_gen', videoMode: 'photo_motion' }
  });
  assert.equal(sceneGenRes.status, 200);
  assert.equal(sceneGenRes.data.content.videoSpec.scenesGenerated, true);
  assert.equal(sceneGenRes.data.content.videoSpec.mp4Rendered, false, 'scene generation must be distinct from MP4 completion');

  // Step 2: Synthesize MP4 with subtitles, Korean voice, music, and logo
  const mp4RenderRes = await api(`/api/workspaces/${ws2Id}/contents/${shortsContent.id}/revise`, {
    method: 'POST',
    body: {
      revisionType: 'video_render',
      subtitles: ['1장면 자막', '2장면 자막', '3장면 자막', '4장면 CTA'],
      narration: { enabled: true, voice: 'ko-KR-Standard-A' },
      musicPreset: 'upbeat-acoustic',
      durationSec: 20
    }
  });
  assert.equal(mp4RenderRes.status, 200);
  assert.equal(mp4RenderRes.data.paidApiCalled, false);
  assert.equal(mp4RenderRes.data.content.videoSpec.mp4Rendered, true);

  // Download binary MP4 and verify ISO BMFF header ('ftyp') and absence of internal AI model strings
  const mp4Download = await api(`/api/workspaces/${ws2Id}/contents/${shortsContent.id}/export?format=mp4`, { raw: true });
  assert.equal(mp4Download.status, 200);
  assert.equal(mp4Download.buffer.subarray(4, 8).toString('ascii'), 'ftyp');
  assert.ok(mp4Download.buffer.length > 32768);
  const mp4Text = mp4Download.buffer.toString('utf8');
  assert.equal(/gpt-4\.1|gpt-image-1|veo-2\.0/.test(mp4Text), false, 'customer MP4 must not leak model names');

  // 10. Channel OAuth, Pre-Publish Review, Version Lock, Timeout Reconciliation & Budget Limit
  // Re-approve instaContent
  await api(`/api/workspaces/${ws2Id}/contents/${instaContent.id}/revise`, {
    method: 'POST',
    body: { revisionType: 'approve' }
  });

  // Attempting API publish before OAuth connection must fail even if URL is registered
  await api(`/api/workspaces/${ws2Id}`, {
    method: 'PATCH',
    body: { brand: { links: { instagram: 'https://www.instagram.com/careplus/' } } }
  });
  const noOAuthPrep = await api(`/api/workspaces/${ws2Id}/publications/prepare`, {
    method: 'POST',
    body: { contentId: instaContent.id, channelId: 'instagram', mode: 'api_publish' }
  });
  assert.equal(noOAuthPrep.status, 400);
  assert.equal(noOAuthPrep.data.code, 'OAUTH_NOT_CONNECTED');

  // Connect Instagram OAuth for ws2Id using signed state
  const oauthStart = await api(`/api/workspaces/${ws2Id}/channels/instagram/connect`);
  assert.equal(oauthStart.status, 200);
  const oauthCb = await api(`${oauthStart.data.sandboxAuthorizeUrl}&account=@careplus_official`);
  assert.equal(oauthCb.status, 200);
  assert.equal(oauthCb.data.connection.state, 'connected');
  // Verify 120pie instagram connection is still unconnected (workspace isolation!)
  const pieHydrated = await api('/api/workspaces/brand-120pie');
  const pieInstaConn = pieHydrated.data.workspace.channelConnections.find(c => c.platform === 'instagram');
  assert.equal(pieInstaConn.state, 'unconnected');

  // Prepare publication on approved version
  const prepOk = await api(`/api/workspaces/${ws2Id}/publications/prepare`, {
    method: 'POST',
    body: { contentId: instaContent.id, channelId: 'instagram', mode: 'api_publish' }
  });
  assert.equal(prepOk.status, 200);
  const pubId = prepOk.data.publication.id;

  // Simulate publication timeout -> reconciling -> resolve without duplicate post
  const pubTimeout = await api(`/api/workspaces/${ws2Id}/publications`, {
    method: 'POST',
    body: { publicationId: pubId, simulateTimeout: true }
  });
  assert.equal(pubTimeout.status, 202);
  assert.equal(pubTimeout.data.publication.state, 'reconciling');

  // Re-submitting while reconciling must be blocked to prevent duplicate posting
  const dupPubAttempt = await api(`/api/workspaces/${ws2Id}/publications`, {
    method: 'POST',
    body: { publicationId: pubId }
  });
  assert.equal(dupPubAttempt.status, 409);
  assert.equal(dupPubAttempt.data.code, 'PUBLICATION_RECONCILING');

  // Poll publication status to reconcile
  const resolvedPub = await api(`/api/workspaces/${ws2Id}/publications/${pubId}`);
  assert.equal(resolvedPub.status, 200);
  assert.equal(resolvedPub.data.publication.state, 'published');
  assert.ok(resolvedPub.data.publication.remoteUrl.startsWith('https://www.instagram.com/p/'));

  // Verify budget cap enforcement
  await api('/api/settings', { method: 'PATCH', body: { budget: 3000 } });
  const overBudget = await api(`/api/workspaces/${ws2Id}/contents/${shortsContent.id}/generate`, {
    method: 'POST',
    body: { jobType: 'scene_gen' }
  });
  assert.equal(overBudget.status, 402);
  assert.equal(overBudget.data.code, 'BUDGET_EXCEEDED');

  // 11. Verify Frontend Modular Scripts Render Cleanly in Browser VM Context
  const vm = await import('node:vm');
  const { webcrypto } = await import('node:crypto');
  const scripts = [
    'app.js',
    'enhancements.js',
    'hooniworks.js',
    'modules/api-store.js',
    'modules/concept-studio.js',
    'modules/layer-video.js',
    'modules/publish-oauth.js'
  ].map(f => fs.readFileSync(new URL('../dist/' + f, import.meta.url), 'utf8'));

  const nodes = new Map();
  const node = sel => {
    if (!nodes.has(sel)) {
      nodes.set(sel, {
        value: '',
        innerHTML: '',
        textContent: '',
        children: [],
        style: {},
        classList: { add() {}, remove() {}, toggle() {} },
        focus() {}
      });
    }
    return nodes.get(sel);
  };
  const ctx = vm.createContext({
    console,
    structuredClone,
    crypto: webcrypto,
    URL,
    Blob,
    TextEncoder,
    Uint8Array,
    DataView,
    fetch: (url, opts) => fetch(`${baseUrl}${url}`, opts),
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    location: { hash: '' },
    navigator: {},
    window: { addEventListener() {}, scrollTo() {} },
    document: {
      querySelector: node,
      querySelectorAll: () => [],
      addEventListener() {},
      body: { style: {} },
      activeElement: null,
      fonts: { ready: Promise.resolve() }
    },
    localStorage: { getItem: () => null, setItem() {} }
  });
  for (let i = 0; i < scripts.length; i++) {
    const code = i === 2
      ? scripts[i].replace('render();restoreAssets();\nif(storageWarning)toast(storageWarning);', '')
      : scripts[i];
    vm.runInContext(code, ctx);
  }
  vm.runInContext('fillCanvases=()=>{};', ctx);
  for (const r of ['dashboard', 'products', 'workspace', 'studio', 'campaigns', 'assets', 'templates', 'brand', 'publish', 'settings']) {
    const html = vm.runInContext(`route=${JSON.stringify(r)};render();document.querySelector('#app').innerHTML`, ctx);
    assert.ok(html.length > 200, `Route ${r} must render non-empty HTML`);
  }
  const studioHtml = vm.runInContext(`route='studio';render();document.querySelector('#app').innerHTML`, ctx);
  assert.ok(studioHtml.includes('디자인 콘셉트 3안 기획 · 선택'), 'Studio must render 3-concept comparison section');
  assert.ok(studioHtml.includes('4대 분리 레이어 편집'), 'Studio must render separated layer inspector');

  console.log('PASS: server workspace isolation, cross-workspace rejection, upload byte validation, SSRF protection, browser import deduplication, 3-concept distinct planning, free layer editing & approval invalidation, MP4 synthesis, per-workspace OAuth, publication reconciliation, and modular UI rendering.');
} finally {
  server.close();
  try { fs.unlinkSync(tmpDbFile); } catch {}
}

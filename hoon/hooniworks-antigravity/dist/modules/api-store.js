/* HooniWorks Module 1: Server Session, Workspace Store Sync, Approved Facts & Browser Data Import */
const hwServer = {
  connected: false,
  currentUser: { id: 'user-jh', name: '김지훈', roleLabel: '워크스페이스 관리자' },
  availableUsers: [],
  providers: {},
  settings: { budget: 50000, usedBudget: 0, reservedBudget: 0, retries: 2 },
  workspacesById: new Map(),
  lastImportReport: null
};

async function hwApi(path, options = {}) {
  const headers = {
    'X-Hooni-User': hwServer.currentUser?.id || 'user-jh',
    ...(options.body && typeof options.body === 'object' && !(options.body instanceof Blob)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers || {})
  };
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body && typeof options.body === 'object' && !(options.body instanceof Blob)
      ? JSON.stringify(options.body)
      : options.body
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = payload && typeof payload === 'object' && payload.error ? payload.error : `요청 실패 (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.code = payload?.code;
    throw err;
  }
  return payload;
}

async function syncFromServer() {
  try {
    const session = await hwApi('/api/session');
    hwServer.connected = true;
    hwServer.currentUser = session.user;
    hwServer.availableUsers = session.availableUsers || [];
    hwServer.providers = session.providers || {};
    hwServer.settings = session.settings || hwServer.settings;
    hwServer.workspacesById.clear();

    if (Array.isArray(session.workspaces)) {
      for (const sw of session.workspaces) {
        hwServer.workspacesById.set(sw.id, sw);
        // Merge server-managed entities (concepts, contents, jobs, channelConnections, approvedFacts, productItems) into local workspace object if present
        const localWs = works.workspaces.find(w => w.id === sw.id);
        if (localWs) {
          localWs.version = sw.version || 1;
          localWs.brand.approvedFacts = sw.brand?.approvedFacts || localWs.brand.approvedFacts || [];
          localWs.productItems = sw.productItems || localWs.productItems || [];
          localWs.concepts = sw.concepts || [];
          localWs.contents = sw.contents || [];
          localWs.jobs = sw.jobs || [];
          localWs.channelConnections = sw.channelConnections || [];
          localWs.publications = sw.publications || [];
        }
      }
    }
    // Ensure active local workspace also exists on server if user is owner
    if (data && !hwServer.workspacesById.has(data.id) && hwServer.currentUser?.id === 'user-jh') {
      await ensureWorkspaceOnServer(data);
    }
    render();
  } catch {
    hwServer.connected = false;
  }
}

async function ensureWorkspaceOnServer(ws) {
  if (!ws || !ws.id) return null;
  try {
    const existing = await hwApi(`/api/workspaces/${encodeURIComponent(ws.id)}`);
    hwServer.workspacesById.set(ws.id, existing.workspace);
    return existing.workspace;
  } catch (err) {
    if (err.status === 404) {
      const created = await hwApi('/api/workspaces', {
        method: 'POST',
        body: {
          id: ws.id,
          name: ws.brand?.name || '새 상품',
          category: ws.brand?.category || '기타',
          color: ws.brand?.color || '#7661dc',
          audience: ws.brand?.audience || '',
          description: ws.brand?.description || '',
          tone: ws.brand?.tone || '',
          cta: ws.brand?.cta || '자세히 알아보기',
          approvedFacts: ws.brand?.approvedFacts || []
        }
      });
      hwServer.workspacesById.set(ws.id, created.workspace);
      return created.workspace;
    }
    throw err;
  }
}

async function ensureCampaignOnServer(camp) {
  if (!camp || !camp.id || !data?.id) return null;
  await ensureWorkspaceOnServer(data);
  const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/campaigns`, {
    method: 'POST',
    body: {
      id: camp.id,
      name: camp.name,
      audience: camp.audience,
      goal: camp.goal,
      topic: camp.topic,
      product: camp.product,
      channels: camp.channels,
      designMode: camp.designMode || 'creative',
      templateId: (camp.designMode || 'creative') === 'template' ? camp.template : null,
      template: camp.template,
      preserveProduct: camp.preserveProduct !== false,
      productAssetIds: camp.assetId ? [camp.assetId] : [],
      referenceAssetIds: camp.referenceAssetId ? [camp.referenceAssetId] : [],
      titles: camp.titles,
      caption: camp.caption,
      scenes: camp.scenes
    }
  });
  return res.campaign;
}

// Inspect IndexedDB '120studio-assets' to check which uploads have original blobs vs preview-only
async function inspectBrowserOriginals(uploads = []) {
  const hasBlobSet = new Set();
  if (typeof indexedDB === 'undefined' || !uploads.length) return hasBlobSet;
  try {
    const db = await dbOpen();
    await Promise.all(
      uploads.map(
        u =>
          new Promise(resolve => {
            try {
              const req = db.transaction('originals').objectStore('originals').get(u.id);
              req.onsuccess = () => {
                if (req.result) hasBlobSet.add(u.id);
                resolve();
              };
              req.onerror = () => resolve();
            } catch {
              resolve();
            }
          })
      )
    );
    db.close();
  } catch {}
  return hasBlobSet;
}

async function openBrowserImportModal() {
  const allWs = works?.workspaces || [];
  const currentUploads = data?.uploads || [];
  const hasBlobSet = await inspectBrowserOriginals(currentUploads);

  const summaryRows = allWs.map(w => {
    const upCount = (w.uploads || []).length;
    const campCount = (w.campaigns || []).length;
    const tplCount = (w.templates || []).length;
    return `<label class="import-ws-row">
      <input type="radio" name="import-source-ws" value="${esc(w.id)}" ${w.id === data.id ? 'checked' : ''}>
      <span class="grow">
        <strong>${esc(w.brand?.name || w.id)}</strong>
        <small>캠페인 ${campCount}개 · 업로드 사진 ${upCount}개 · 내 템플릿 ${tplCount}개</small>
      </span>
      <span class="badge outline">${esc(w.brand?.category || '기타')}</span>
    </label>`;
  }).join('');

  const reportHtml = hwServer.lastImportReport
    ? `<div class="import-report panel" style="margin-top:14px;background:#f8f6fc">
        <strong>최근 가져오기 결과 (${esc(hwServer.lastImportReport.workspaceId)})</strong>
        <p class="small muted" style="margin-top:6px">
          캠페인 성공 <b>${hwServer.lastImportReport.importedCampaigns}</b>건 (중복 제외 ${hwServer.lastImportReport.skippedDuplicateCampaigns}건) ·
          사진 성공 <b>${hwServer.lastImportReport.importedAssets}</b>건 (미리보기만 존재 ${hwServer.lastImportReport.previewOnlyAssets}건 / 중복 제외 ${hwServer.lastImportReport.skippedDuplicateAssets}건) ·
          템플릿 <b>${hwServer.lastImportReport.importedTemplates}</b>건
        </p>
        ${hwServer.lastImportReport.failedItems?.length
          ? `<div class="notice" style="margin-top:8px">실패 항목 ${hwServer.lastImportReport.failedItems.length}건: ${hwServer.lastImportReport.failedItems.map(f => esc(f.name || f.id) + ' (' + esc(f.reason) + ')').join(', ')}</div>`
          : '<span class="badge green" style="margin-top:6px">실패 항목 없음 · 브라우저 원본 데이터 보존됨</span>'}
      </div>`
    : '';

  openModal(
    '브라우저 저장 자료를 서버로 가져오기',
    `<p class="intro">이 브라우저(localStorage 및 IndexedDB)에 저장된 상품별 캠페인·사진·템플릿을 선택한 서버 워크스페이스로 안전하게 가져옵니다.</p>
    <div class="notice">${icon('check')}가져오기 완료 전후에 기존 브라우저 저장 데이터를 삭제하거나 덮어쓰지 않습니다. 해시(SHA-256) 및 ID 기준으로 중복 등록을 방지합니다.</div>
    <div class="field" style="margin-top:16px">
      <label>1. 가져올 브라우저 상품 자료 선택</label>
      <div class="import-ws-list">${summaryRows}</div>
    </div>
    <div class="field">
      <label for="import-target-ws">2. 연결할 서버 상품 워크스페이스</label>
      <select id="import-target-ws">
        ${allWs.map(w => `<option value="${esc(w.id)}" ${w.id === data.id ? 'selected' : ''}>${esc(w.brand?.name)} (${esc(w.id)})</option>`).join('')}
      </select>
      <p class="hint">현재 상품 사진 ${currentUploads.length}개 중 원본 보관 확인: <b>${hasBlobSet.size}</b>개 / 미리보기만 존재: <b>${Math.max(0, currentUploads.length - hasBlobSet.size)}</b>개</p>
    </div>
    ${reportHtml}`,
    `<button class="btn" data-act="close-modal">닫기</button>
     <button class="btn primary" data-act="execute-browser-import">${icon('upload')}선택한 자료 서버로 가져오기</button>`
  );
}

async function executeBrowserImport(btn) {
  const sourceId = document.querySelector('input[name="import-source-ws"]:checked')?.value || data.id;
  const targetId = $('#import-target-ws')?.value || data.id;
  const sourceWs = works.workspaces.find(w => w.id === sourceId);
  if (!sourceWs) {
    toast('가져올 브라우저 상품 자료를 찾을 수 없습니다.');
    return;
  }
  btn.disabled = true;
  btn.textContent = '자료 검증 및 서버 전송 중…';
  try {
    const targetWsObj = works.workspaces.find(w => w.id === targetId) || sourceWs;
    await ensureWorkspaceOnServer(targetWsObj);
    const hasBlobSet = await inspectBrowserOriginals(sourceWs.uploads || []);

    const uploadsPayload = (sourceWs.uploads || []).map(u => ({
      ...u,
      hasOriginalBlob: hasBlobSet.has(u.id)
    }));

    const res = await hwApi(`/api/workspaces/${encodeURIComponent(targetId)}/import`, {
      method: 'POST',
      body: {
        campaigns: sourceWs.campaigns || [],
        uploads: uploadsPayload,
        templates: sourceWs.templates || []
      }
    });
    hwServer.lastImportReport = res.report;
    await syncFromServer();
    toast(`서버 가져오기 완료: 캠페인 ${res.report.importedCampaigns}건, 사진 ${res.report.importedAssets}건`);
    openBrowserImportModal();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

function openAccountSwitcherModal() {
  const users = hwServer.availableUsers.length
    ? hwServer.availableUsers
    : [
        { id: 'user-jh', email: 'jh@hooniworks.local', name: '김지훈', roleLabel: '워크스페이스 관리자 (전체 권한)' },
        { id: 'user-guest', email: 'partner@hooniworks.local', name: '외부 담당자', roleLabel: '권한 분리 테스트용 계정' }
      ];
  openModal(
    '계정 · 워크스페이스 접근 권한 확인',
    `<p class="intro">서버는 모든 요청에서 로그인 사용자와 상품 워크스페이스(workspaceId)의 소속 권한을 검증합니다.</p>
    <div class="workspace-picker">
      ${users.map(u => `<button data-switch-user="${esc(u.id)}" class="${u.id === hwServer.currentUser?.id ? 'selected' : ''}">
        <span class="avatar">${esc(u.name.slice(0, 2))}</span>
        <span class="grow">
          <strong>${esc(u.name)} (${esc(u.email)})</strong>
          <small>${esc(u.roleLabel)}</small>
        </span>
        ${icon(u.id === hwServer.currentUser?.id ? 'check' : 'chevron')}
      </button>`).join('')}
    </div>
    <div class="notice" style="margin-top:16px">
      ${icon('lock')}다른 상품 ID를 대입하거나 권한이 없는 계정으로 API/파일에 접근하면 서버가 403 Forbidden으로 즉시 거절하고 감사 로그에 기록합니다.
    </div>`,
    `<button class="btn" data-act="close-modal">닫기</button>`
  );
}

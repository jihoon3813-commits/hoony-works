/* HooniWorks Module 4: Per-Workspace Channel OAuth, Pre-Publish Review & UI Integration */

function getWorkspaceConnection(platformId) {
  const key = profileKey(platformId);
  const list = data.channelConnections || [];
  return list.find(c => c.platform === key) || {
    platform: key,
    state: ['blog', 'kakao'].includes(key) ? 'manual_only' : 'unconnected',
    scopes: []
  };
}

async function connectWorkspaceChannelOAuth(provider) {
  const key = profileKey(provider);
  if (!['instagram', 'youtube'].includes(key)) {
    authInfo(provider);
    return;
  }
  try {
    await ensureWorkspaceOnServer(data);
    const startRes = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/channels/${encodeURIComponent(key)}/connect`);
    const acctInput = $(`#account-${key}`)?.value?.trim() || data.brand?.accounts?.[key] || `@${data.brand.name}`;
    const cbUrl = `${startRes.sandboxAuthorizeUrl}&account=${encodeURIComponent(acctInput)}`;
    const cbRes = await hwApi(cbUrl);
    if (cbRes.connection) {
      data.channelConnections = [
        ...(data.channelConnections || []).filter(c => c.platform !== key),
        cbRes.connection
      ];
      data.brand.accounts[key] = cbRes.connection.accountName;
      persist();
      render();
      toast(`${key === 'instagram' ? '인스타그램(피드·릴스)' : '유튜브'} OAuth 게시 권한이 현재 상품(${data.brand.name})에 연결되었습니다.`);
    }
  } catch (err) {
    toast(err.message);
  }
}

async function approveCurrentContentOnServer() {
  const c = campaign();
  try {
    const content = await ensureServerContentForChannel(c, channel);
    if (content) {
      const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/contents/${encodeURIComponent(content.id)}/revise`, {
        method: 'POST',
        body: { revisionType: 'approve' }
      });
      if (res.content) {
        data.contents = [
          ...(data.contents || []).filter(x => x.id !== res.content.id),
          res.content
        ];
      }
    }
    c.status = '승인 완료';
    persist();
    render();
    toast('현재 콘텐츠 버전을 승인했습니다. 수정 시 승인이 자동 해제됩니다.');
  } catch (err) {
    toast(err.message);
  }
}

async function executeApiPublication() {
  if (!$('#review-product')?.checked || !$('#review-channel')?.checked) {
    toast('게시 전 제품·문구 및 게시 계정 확인 체크박스를 모두 선택해 주세요.');
    return;
  }
  const c = campaign();
  try {
    const content = await ensureServerContentForChannel(c, channel);
    if (!content) return;

    const youtubePrivacy = $('#yt-privacy-select')?.value || 'unlisted';
    const madeForKids = $('#yt-kids-check') ? Boolean($('#yt-kids-check').checked) : false;

    const prepRes = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/publications/prepare`, {
      method: 'POST',
      body: {
        contentId: content.id,
        channelId: channel,
        mode: 'api_publish',
        youtubePrivacy,
        madeForKids
      }
    });

    const pubRes = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/publications`, {
      method: 'POST',
      body: {
        publicationId: prepRes.publication.id
      }
    });

    if (pubRes.publication) {
      data.publications = [
        pubRes.publication,
        ...(data.publications || []).filter(p => p.id !== pubRes.publication.id)
      ];
      data.posts.push({
        id: pubRes.publication.id,
        campaignId: c.id,
        channel,
        url: pubRes.publication.remoteUrl,
        remotePostId: pubRes.publication.remotePostId,
        status: 'published',
        providerMode: pubRes.publication.providerMode || 'mock_api',
        at: pubRes.publication.publishedAt || new Date().toISOString()
      });
      persist();
      render();
      toast('채널 게시 및 원격 게시물 ID 확인이 완료되었습니다.');
    }
  } catch (err) {
    toast(err.message);
  }
}

function renderApprovedFactsSection() {
  const facts = data.brand?.approvedFacts || [];
  const items = data.productItems || [];
  return `<section class="panel" style="margin-top:24px">
    <div class="flex between" style="flex-wrap:wrap;gap:10px">
      <div>
        <h2>승인된 상품 사실 · 근거 관리 (${esc(data.brand.name)} 전용)</h2>
        <p class="settings-note" style="margin-top:4px">가격·효과·실적·매장 수·상품 조건은 출처와 확인일이 등록된 근거만 기획/카피에 사용합니다. 다른 상품의 사실과 절대 혼합하지 않습니다.</p>
      </div>
      <button class="btn sm" data-act="fact-add">${icon('plus')}승인 근거 추가</button>
    </div>
    <div class="fact-list" style="margin-top:14px;display:grid;gap:8px">
      ${facts.length
        ? facts.map((f, i) => `
          <div class="task-row" style="background:#faf9fd;padding:10px 14px;border-radius:9px">
            <span class="badge green">v${f.version || 1}</span>
            <div class="grow">
              <strong>${esc(f.claim)}</strong>
              <small>출처: ${esc(f.source || '내부 승인 자료')} · 확인일: ${esc(f.confirmedDate || '2026-11-03')}</small>
            </div>
            <button class="btn sm ghost" data-fact-remove="${i}">삭제</button>
          </div>
        `).join('')
        : '<div class="empty">등록된 승인 사실 근거가 없습니다. 확인된 기본 소개만 콘텐츠에 사용합니다.</div>'}
    </div>
    <div class="divider"></div>
    <div class="flex between" style="flex-wrap:wrap;gap:10px">
      <div>
        <h3>워크스페이스 내부 상세 제품·서비스 항목 (ProductItem)</h3>
        <p class="settings-note">상품 워크스페이스(Workspace)와 그 안의 개별 메뉴/서비스 항목(ProductItem)을 구분해 관리합니다.</p>
      </div>
      <button class="btn sm" data-act="product-item-add">${icon('plus')}상세 항목 추가</button>
    </div>
    <div class="fact-list" style="margin-top:10px;display:grid;gap:8px">
      ${items.length
        ? items.map(it => `
          <div class="task-row" style="padding:8px 12px;border:1px solid var(--line);border-radius:8px">
            <span class="badge outline">${esc(it.code || it.id)}</span>
            <div class="grow">
              <strong>${esc(it.name)}</strong>
              <small>${esc(it.description || '상세 설명 없음')} · 조건: ${esc(it.approvedConditions || '기본 원본 보존')}</small>
            </div>
          </div>
        `).join('')
        : '<div class="small muted">기본 카탈로그 항목을 사용 중입니다.</div>'}
    </div>
  </section>`;
}

// Enhance shell, studio, brandPage, publishPage, and settingsPage while preserving all existing DOM IDs and workflows
const baseHwShell = shell;
shell = function(content) {
  let html = baseHwShell(content);
  const s = hwServer.settings || { budget: data.budget || 50000, usedBudget: 0 };
  const statusPill = hwServer.connected
    ? `<button class="badge green" data-act="account-switch" style="border:0;cursor:pointer">${icon('check')}${esc(hwServer.currentUser?.name || '김지훈')} · 예산 ${(s.usedBudget || 0).toLocaleString()}/${(s.budget || 50000).toLocaleString()}원</button>`
    : `<span class="badge outline"><i class="dot"></i>로컬 모드</span>`;
  html = html.replace(
    '<span class="badge outline"><i class="dot"></i>API 미연결</span>',
    `<button class="btn sm ghost" data-act="open-browser-import">${icon('upload')}브라우저 자료 가져오기</button>${statusPill}`
  );
  return html;
};

const baseHwStudio = studio;
studio = function() {
  if (!data) return typeof emptyNoWorkspaceView === 'function' ? emptyNoWorkspaceView('콘텐츠 제작실') : '';
  if (!data.campaigns.length) return emptyCampaignView();
  let html = baseHwStudio();
  // Inject Concept 3-Proposal Comparison Panel above studio-layout and Layer/Video Inspector inside preview-panel
  html = html.replace(
    '<div class="studio-layout">',
    renderConceptComparisonSection() + '<div class="studio-layout">'
  );
  html = html.replace(
    '<div class="caption-box">',
    renderLayerAndVideoInspector() + '<div class="caption-box">'
  );
  return html;
};

const baseHwBrandPage = brandPage;
brandPage = function() {
  if (!data) return typeof emptyNoWorkspaceView === 'function' ? emptyNoWorkspaceView('브랜드 · 채널 설정') : '';
  let html = baseHwBrandPage();
  const connectedCount = ['instagram', 'youtube'].filter(p => getWorkspaceConnection(p).state === 'connected').length;
  html = html.replace('게시 인증 0 / 2', `게시 인증 ${connectedCount} / 2`);

  // Enhance each channel profile card with OAuth connect button for instagram/youtube
  for (const p of ['instagram', 'youtube']) {
    const conn = getWorkspaceConnection(p);
    const isConn = conn.state === 'connected';
    html = html.replace(
      `<button class="btn sm" data-auth-info="${p}">계정 연결 안내 ${icon('chevron')}</button>`,
      `<div class="flex" style="gap:6px">
        <button class="btn sm ${isConn ? 'ghost' : 'primary'}" data-oauth-connect="${p}">
          ${icon('link')}${isConn ? `OAuth 재연결 (${esc(conn.accountName)})` : 'OAuth 게시 권한 연결'}
        </button>
        <button class="btn sm" data-auth-info="${p}">안내</button>
      </div>`
    );
    if (isConn) {
      html = html.replace(
        '<span class="badge outline">게시 권한 미연결</span>',
        '<span class="badge green">OAuth 게시 권한 연결됨</span>'
      );
    }
  }
  return html + renderApprovedFactsSection();
};

const baseHwPublishPage = publishPage;
publishPage = function() {
  if (!data) return typeof emptyNoWorkspaceView === 'function' ? emptyNoWorkspaceView('게시 관리') : '';
  if (!data.campaigns.length) return emptyCampaignView('게시 관리');
  let html = baseHwPublishPage();
  const c = campaign();
  const content = getCurrentChannelContent(c, channel);
  const isVideo = ['youtube', 'reels'].includes(channel);
  const key = profileKey(channel);
  const conn = getWorkspaceConnection(key);
  const isOAuthReady = conn.state === 'connected';
  const isVersionApproved = (content && content.approvedVersion === content.version && c.status === '승인 완료') || c.status === '승인 완료';
  const isMediaReady = !isVideo || Boolean(content?.videoSpec?.mp4Rendered && content?.mp4File);

  if (isVideo && isMediaReady && content?.mp4File) {
    html = html.replace(
      /<div class="video-pending">[\s\S]*?<\/div>/,
      `<div class="video-ready-box" style="padding:24px;text-align:center">
        <span class="badge green">MP4 합성 완료 (v${content.version})</span>
        <h3 style="margin-top:10px">${esc(content.mp4File.fileName)}</h3>
        <p class="small muted" style="margin:6px 0 14px">${esc(content.mp4File.resolution)} · ${content.mp4File.durationSec}초 · ${(content.mp4File.byteSize / 1024).toFixed(1)}KB</p>
        <a class="btn primary sm" href="${esc(content.mp4File.downloadUrl)}" download="${esc(content.mp4File.fileName)}">${icon('download')}완성 MP4 다운로드</a>
      </div>`
    );
    html = html.replace('MP4 미생성 · 장면표 TXT 제공', `합성 완료 MP4 (${content.mp4File.durationSec}초 · 9:16)`);
  }

  const extraControls = `
    <div class="publish-version-box" style="margin:12px 0;padding:12px;border-radius:9px;background:#f7f5fc;font-size:11px">
      <div class="flex between">
        <strong>콘텐츠 버전 · 승인 검증</strong>
        <span class="badge ${isVersionApproved ? 'green' : 'yellow'}">
          v${content?.version || 1} · ${isVersionApproved ? '승인 완료' : '재검토·승인 필요'}
        </span>
      </div>
      <p class="small muted" style="margin-top:4px">
        채널 인증: <b>${isOAuthReady ? `OAuth 연결됨 (${esc(conn.accountName)})` : ['blog', 'kakao'].includes(key) ? '관리자 직접 게시 전용' : 'OAuth 미연결 (주소 등록만으로는 게시 불가)'}</b> ·
        미디어 상태: <b>${isMediaReady ? '준비 완료' : 'MP4 미합성 (장면표 상태)'}</b>
      </p>
      ${channel === 'youtube'
        ? `<div class="brand-form-grid" style="margin-top:10px">
            <div class="field">
              <label for="yt-privacy-select">YouTube 공개 범위</label>
              <select id="yt-privacy-select">
                <option value="unlisted">일부 공개 (unlisted)</option>
                <option value="public">전체 공개 (public)</option>
                <option value="private">비공개 (private)</option>
              </select>
            </div>
            <div class="field">
              <label class="check-line" style="margin-top:24px">
                <input type="checkbox" id="yt-kids-check"> 아동용 콘텐츠(madeForKids) 여부
              </label>
            </div>
          </div>`
        : ''}
    </div>`;

  html = html.replace('<div class="review-list">', extraControls + '<div class="review-list">');

  if (['instagram', 'youtube', 'reels'].includes(channel)) {
    const canPublishNow = isOAuthReady && isVersionApproved && isMediaReady;
    html = html.replace(
      /<button class="btn full" disabled>[\s\S]*?<\/button>/,
      `<button class="btn full ${canPublishNow ? 'dark' : ''}" data-act="execute-api-publish" ${canPublishNow ? '' : 'disabled'}>
        ${icon(canPublishNow ? 'upload' : 'lock')}
        ${canPublishNow ? '사전 검증 완료 · API 게시 실행 (모의/공식)' : !isOAuthReady ? '채널 OAuth 권한 연결 후 게시 가능' : !isMediaReady ? 'MP4 합성 완료 후 게시 가능' : '제작실에서 현재 버전 디자인 승인 후 게시 가능'}
      </button>`
    );
  }
  return html;
};

// Event delegation for all new modular actions
window.addEventListener('click', async e => {
  const el = e.target.closest('button,[data-act],[data-oauth-connect],[data-switch-user],[data-fact-remove]');
  if (!el) return;

  if (el.dataset.switchUser) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const uid = el.dataset.switchUser;
    const found = hwServer.availableUsers.find(u => u.id === uid) || { id: uid, name: uid };
    hwServer.currentUser = found;
    closeModal();
    await syncFromServer();
    toast(`${found.name} 계정으로 전환했습니다.`);
    return;
  }

  if (el.dataset.oauthConnect) {
    e.preventDefault();
    e.stopImmediatePropagation();
    await connectWorkspaceChannelOAuth(el.dataset.oauthConnect);
    return;
  }

  if (el.dataset.factRemove !== undefined) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const idx = Number(el.dataset.factRemove);
    data.brand.approvedFacts = (data.brand.approvedFacts || []).filter((_, i) => i !== idx);
    persist();
    if (hwServer.connected) {
      await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}`, {
        method: 'PATCH',
        body: { brand: { approvedFacts: data.brand.approvedFacts } }
      }).catch(() => {});
    }
    render();
    toast('승인 근거 항목을 삭제했습니다.');
    return;
  }

  const a = el.dataset.act;
  if (!a) return;

  if (a === 'open-browser-import') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await openBrowserImportModal();
  } else if (a === 'execute-browser-import') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await executeBrowserImport(el);
  } else if (a === 'account-switch') {
    e.preventDefault();
    e.stopImmediatePropagation();
    openAccountSwitcherModal();
  } else if (a === 'concept-plan-three' || a === 'concept-replan') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await planThreeConceptsAction({ variationNote: a === 'concept-replan' ? '새로운 시각 제안' : '' });
  } else if (a === 'concept-select') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await selectConceptAction(el.dataset.conceptId);
  } else if (a === 'concept-refine') {
    e.preventDefault();
    e.stopImmediatePropagation();
    openRefineSingleConceptModal(el.dataset.conceptId);
  } else if (a === 'confirm-concept-refine') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const promptVal = $('#concept-revision-input')?.value?.trim() || '핵심 메시지 강화';
    closeModal();
    await planThreeConceptsAction({ refineConceptId: el.dataset.conceptId, revisionPrompt: promptVal });
  } else if (a === 'layer-apply-free') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await applyFreeLayerRevision();
  } else if (a === 'layer-regen-bg') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await triggerContentGenerateAction('image_gen');
  } else if (a === 'video-generate-scenes') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await triggerContentGenerateAction('scene_gen');
  } else if (a === 'video-synthesize-mp4') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await triggerVideoSynthesizeMp4Action();
  } else if (a === 'approve') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await approveCurrentContentOnServer();
  } else if (a === 'execute-api-publish') {
    e.preventDefault();
    e.stopImmediatePropagation();
    await executeApiPublication();
  } else if (a === 'job-reconcile') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const jobId = el.dataset.jobId;
    try {
      const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/jobs/${encodeURIComponent(jobId)}?reconcile=true`);
      if (res.job) {
        data.jobs = (data.jobs || []).map(j => (j.id === jobId ? res.job : j));
      }
      if (res.settings) hwServer.settings = res.settings;
      render();
      toast('공급자 작업 상태를 확인하여 중복 과금 없이 완료 처리했습니다.');
    } catch (err) {
      toast(err.message);
    }
  } else if (a === 'fact-add') {
    e.preventDefault();
    e.stopImmediatePropagation();
    openModal(
      '승인된 상품 사실 · 근거 등록',
      `<p class="intro"><strong>${esc(data.brand.name)}</strong>의 콘텐츠 기획에 사용할 검증된 사실과 출처를 등록합니다.</p>
      <div class="field">
        <label for="new-fact-claim">승인된 사실 · 조건 내용</label>
        <input id="new-fact-claim" type="text" maxlength="140" placeholder="예: 국내산 원재료 100% 사용 / 월 구독료 19,000원 (부가세 포함)">
      </div>
      <div class="field">
        <label for="new-fact-source">근거 자료 · 출처 문서</label>
        <input id="new-fact-source" type="text" maxlength="80" placeholder="예: 2026년 하반기 상품 안내서 v2">
      </div>`,
      `<button class="btn" data-act="close-modal">취소</button>
       <button class="btn primary" data-act="fact-save">근거 저장</button>`
    );
  } else if (a === 'fact-save') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const claim = $('#new-fact-claim')?.value?.trim();
    const source = $('#new-fact-source')?.value?.trim() || '내부 승인 자료';
    if (!claim) {
      toast('승인된 사실 내용을 입력해 주세요.');
      return;
    }
    data.brand.approvedFacts ||= [];
    data.brand.approvedFacts.push({
      id: 'fact-' + localId(),
      claim,
      source,
      confirmedDate: '2026-11-03',
      version: 1
    });
    persist();
    if (hwServer.connected) {
      await ensureWorkspaceOnServer(data);
      await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}`, {
        method: 'PATCH',
        body: { brand: { approvedFacts: data.brand.approvedFacts } }
      }).catch(() => {});
    }
    closeModal();
    render();
    toast('승인된 상품 사실 근거를 등록했습니다.');
  } else if (a === 'product-item-add') {
    e.preventDefault();
    e.stopImmediatePropagation();
    openModal(
      '상세 제품·서비스 항목 (ProductItem) 추가',
      `<p class="intro"><strong>${esc(data.brand.name)}</strong> 워크스페이스 내부의 세부 메뉴·상품·서비스 항목을 등록합니다.</p>
      <div class="field">
        <label for="new-pitem-name">항목 이름</label>
        <input id="new-pitem-name" type="text" maxlength="60" placeholder="예: 프리미엄 케어 플랜 / 시그니처 세트">
      </div>
      <div class="field">
        <label for="new-pitem-desc">항목 설명 및 조건</label>
        <input id="new-pitem-desc" type="text" maxlength="120" placeholder="예: 1:1 전담 매니저 배정 · 제품 실물 사진 보존">
      </div>`,
      `<button class="btn" data-act="close-modal">취소</button>
       <button class="btn primary" data-act="product-item-save">항목 추가</button>`
    );
  } else if (a === 'product-item-save') {
    e.preventDefault();
    e.stopImmediatePropagation();
    const name = $('#new-pitem-name')?.value?.trim();
    const description = $('#new-pitem-desc')?.value?.trim() || '';
    if (!name) {
      toast('항목 이름을 입력해 주세요.');
      return;
    }
    data.productItems ||= [];
    data.productItems.push({
      id: 'item-' + localId(),
      workspaceId: data.id,
      code: 'item-' + (data.productItems.length + 1),
      name,
      description,
      approvedConditions: '승인된 조건 및 원본 보존',
      sourceVersion: 'v1.0 (2026-11-03)'
    });
    persist();
    if (hwServer.connected) {
      await ensureWorkspaceOnServer(data);
      await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}`, {
        method: 'PATCH',
        body: { productItems: data.productItems }
      }).catch(() => {});
    }
    closeModal();
    render();
    toast('상세 제품·서비스 항목을 등록했습니다.');
  }
}, true);

// Kick off initial server sync in browser environment
if (typeof fetch === 'function') {
  syncFromServer();
}

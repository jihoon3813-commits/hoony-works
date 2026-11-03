/* HooniWorks Module 2: 3-Concept Planning & Comparison UI + Job Queue & Atomic Budget Engine */

function getCampaignConcepts(c = campaign()) {
  const list = data.concepts || [];
  return list.filter(x => x.campaignId === c.id);
}

function renderConceptWireframeSvg(layoutCode, accent = '#7460dd') {
  if (layoutCode === 'editorial-split') {
    return `<svg viewBox="0 0 120 150" class="concept-mini-svg" aria-hidden="true">
      <rect width="120" height="150" rx="8" fill="#f6f3ec" stroke="#dcd5c7"/>
      <rect x="10" y="14" width="100" height="58" rx="5" fill="${esc(accent)}" fill-opacity="0.22"/>
      <circle cx="60" cy="43" r="18" fill="${esc(accent)}" fill-opacity="0.45"/>
      <line x1="12" y1="84" x2="94" y2="84" stroke="#2b2833" stroke-width="5" stroke-linecap="round"/>
      <line x1="12" y1="96" x2="78" y2="96" stroke="#2b2833" stroke-width="5" stroke-linecap="round"/>
      <line x1="12" y1="114" x2="104" y2="114" stroke="#7c7585" stroke-width="3" stroke-linecap="round"/>
    </svg>`;
  }
  if (layoutCode === 'story-grid') {
    return `<svg viewBox="0 0 120 150" class="concept-mini-svg" aria-hidden="true">
      <rect width="120" height="150" rx="8" fill="#eef3ef" stroke="#cad8cd"/>
      <line x1="12" y1="22" x2="96" y2="22" stroke="#233329" stroke-width="5" stroke-linecap="round"/>
      <rect x="10" y="42" width="46" height="94" rx="5" fill="#ffffff" stroke="#d3dfd5"/>
      <line x1="16" y1="58" x2="48" y2="58" stroke="#4a6b56" stroke-width="3"/>
      <line x1="16" y1="82" x2="48" y2="82" stroke="#4a6b56" stroke-width="3"/>
      <line x1="16" y1="106" x2="48" y2="106" stroke="#4a6b56" stroke-width="3"/>
      <rect x="62" y="42" width="48" height="94" rx="5" fill="#4a6b56" fill-opacity="0.2"/>
      <circle cx="86" cy="89" r="16" fill="#4a6b56" fill-opacity="0.45"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 120 150" class="concept-mini-svg" aria-hidden="true">
    <rect width="120" height="150" rx="8" fill="#232030" stroke="#3c3654"/>
    <line x1="14" y1="24" x2="92" y2="24" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
    <line x1="14" y1="36" x2="72" y2="36" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
    <circle cx="60" cy="98" r="32" fill="${esc(accent)}" fill-opacity="0.35"/>
    <rect x="38" y="76" width="44" height="44" rx="8" fill="#ffffff" fill-opacity="0.85"/>
  </svg>`;
}

function renderConceptComparisonSection() {
  const c = campaign();
  const mode = c.designMode || 'creative';
  const concepts = getCampaignConcepts(c);
  const jobs = (data.jobs || []).filter(j => j.campaignId === c.id).slice(0, 4);
  const s = hwServer.settings || { budget: data.budget || 50000, usedBudget: 0, reservedBudget: 0 };

  const modeBadgeLabel =
    mode === 'creative'
      ? '새 콘셉트 기획 (템플릿 ID 없이 자유 기획)'
      : mode === 'reference'
      ? '레퍼런스 활용 기획 (참고 분위기 분석 + 제품 원본 보존)'
      : '저장 템플릿 활용 기획';

  const conceptsGridHtml = concepts.length
    ? `<div class="concept-cards-grid">
        ${concepts.map((cp, idx) => `
          <article class="concept-proposal-card ${cp.selected ? 'selected' : ''}" data-concept-card="${esc(cp.id)}">
            <div class="concept-card-top">
              <div class="flex between">
                <span class="badge ${cp.providerMode === 'live' ? 'green' : 'yellow'}">
                  ${cp.providerMode === 'live' ? '실제 API 기획' : '모의 공급자 기획 (Mock)'}
                </span>
                <span class="sample-tag">v${cp.version || 1} ${cp.selected ? '· 선택됨' : ''}</span>
              </div>
              <div class="concept-visual-row">
                ${renderConceptWireframeSvg(cp.layoutPlan?.code, data.brand?.color)}
                <div class="grow">
                  <h4>${esc(cp.name)}</h4>
                  <p class="small muted">${esc(cp.audience === 'business' ? '사업자·파트너' : '일반 소비자')} · ${esc(cp.goal)}</p>
                  <div class="concept-hook-preview">"${esc((cp.copyPlan?.titles?.[0] || '').replace(/\n/g, ' '))}"</div>
                </div>
              </div>
            </div>
            <div class="concept-specs">
              <div><strong>메시지 구조:</strong> ${esc(cp.messageDirection)}</div>
              <div><strong>구도·레이아웃:</strong> ${esc(cp.layoutPlan?.summary)}</div>
              <div><strong>타이포그래피:</strong> ${esc(cp.typographyPlan?.headlineStyle)}</div>
              <div><strong>사진·원본 배치:</strong> ${esc(cp.photoPlacement?.layerSeparation)}</div>
              <div><strong>사용 자료:</strong> 제품 원본(${esc((cp.assetRefs?.productNames || []).join(', ') || '기본 자료')}) ${cp.assetRefs?.referenceNames?.length ? `/ 참고(${esc(cp.assetRefs.referenceNames.join(', '))})` : ''}</div>
              <div class="flex between" style="margin-top:6px">
                <span class="small muted">예상 작업 ${cp.estimatedJobs || 3}건 · 추정 ${Number(cp.estimatedCostKrw || 1200).toLocaleString()}원</span>
                <span class="badge outline">${cp.templateId ? '템플릿: ' + esc(cp.templateId) : '템플릿 미사용'}</span>
              </div>
            </div>
            ${cp.missingWarnings?.length
              ? `<div class="concept-warning">${cp.missingWarnings.map(w => `<div>• ${esc(w)}</div>`).join('')}</div>`
              : ''}
            <div class="concept-actions">
              <button class="btn primary sm full" data-act="concept-select" data-concept-id="${esc(cp.id)}">
                ${icon('check')}${cp.selected ? '현재 적용된 방향 (다시 반영)' : '이 방향으로 제작'}
              </button>
              <div class="two-actions" style="margin-top:6px">
                <button class="btn sm ghost" data-act="concept-refine" data-concept-id="${esc(cp.id)}">
                  ${icon('edit')}이 안만 수정
                </button>
                <button class="btn sm ghost" data-act="concept-replan">
                  ${icon('refresh')}다른 방향 제안
                </button>
              </div>
            </div>
          </article>
        `).join('')}
      </div>`
    : `<div class="concept-empty-box">
        <div>
          <strong>아직 이 캠페인에 생성된 콘셉트 3안이 없습니다.</strong>
          <p class="small muted" style="margin-top:4px">
            현재 화면의 카드는 편집용 기본 미리보기입니다. 아래 버튼을 누르면 구도·타이포·사진 배치·메시지 구조가 서로 다른 3안을 기획하고 비교할 수 있습니다.
          </p>
        </div>
        <button class="btn primary" data-act="concept-plan-three">
          ${icon('spark')}콘셉트 3안 기획 · 비교하기
        </button>
      </div>`;

  const jobsBarHtml = jobs.length
    ? `<div class="job-queue-bar">
        <div class="flex between">
          <strong style="font-size:11px">최근 생성 작업 큐 (${esc(data.brand.name)} 고정)</strong>
          <span class="small muted">월 예산: 사용 ${Number(s.usedBudget || 0).toLocaleString()}원 / 예약 ${Number(s.reservedBudget || 0).toLocaleString()}원 / 한도 ${Number(s.budget || 50000).toLocaleString()}원</span>
        </div>
        <div class="job-pills">
          ${jobs.map(j => `
            <div class="job-pill">
              <span class="badge ${j.state === 'succeeded' ? 'green' : j.state === 'reconciling' ? 'yellow' : ''}">${esc(j.state)}</span>
              <span>${esc(j.jobType)} · ${esc(j.provider)} (${j.providerMode === 'live' ? '실제 API' : '모의 공급자'})</span>
              <small>${Number(j.actualUsage || j.costEstimate || 0).toLocaleString()}원</small>
              ${j.state === 'reconciling'
                ? `<button class="btn sm" data-act="job-reconcile" data-job-id="${esc(j.id)}">공급자 상태 확인</button>`
                : ''}
            </div>
          `).join('')}
        </div>
      </div>`
    : '';

  return `<section class="panel concept-studio-panel" id="concept-studio-section">
    <div class="flex between" style="flex-wrap:wrap;gap:10px">
      <div>
        <div class="eyebrow">CONCEPT PLANNING & COMPARISON</div>
        <h3 style="margin-top:4px">디자인 콘셉트 3안 기획 · 선택</h3>
        <p class="small muted" style="margin-top:3px">${esc(modeBadgeLabel)} · 색상만 바꾼 복제가 아닌 구도·타이포·메시지 구조가 다른 3안을 비교합니다.</p>
      </div>
      <div class="flex">
        ${concepts.length
          ? `<button class="btn sm" data-act="concept-plan-three">${icon('refresh')}3안 전체 다시 기획</button>`
          : ''}
      </div>
    </div>
    ${conceptsGridHtml}
    ${jobsBarHtml}
  </section>`;
}

async function planThreeConceptsAction(options = {}) {
  const c = campaign();
  try {
    await ensureCampaignOnServer(c);
    const prodIds = c.assetId ? [c.assetId] : [];
    const refIds = c.referenceAssetId ? [c.referenceAssetId] : [];
    const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/campaigns/${encodeURIComponent(c.id)}/concepts`, {
      method: 'POST',
      body: {
        workspaceId: data.id,
        campaignId: c.id,
        designMode: c.designMode || 'creative',
        audience: c.audience,
        goal: c.goal || (c.audience === 'business' ? '도입·제휴 상담' : '상품·서비스 소개'),
        topic: c.topic,
        conceptCount: 3,
        preserveProduct: true,
        productAssetIds: prodIds,
        referenceAssetIds: refIds,
        templateId: (c.designMode || 'creative') === 'template' ? c.template : null,
        refineConceptId: options.refineConceptId || null,
        revisionPrompt: options.revisionPrompt || '',
        variationNote: options.variationNote || ''
      }
    });
    data.concepts = [
      ...(data.concepts || []).filter(x => x.campaignId !== c.id),
      ...(res.concepts || [])
    ];
    if (res.job) {
      data.jobs = [res.job, ...(data.jobs || []).filter(j => j.id !== res.job.id)];
    }
    if (res.settings) hwServer.settings = res.settings;
    persist();
    render();
    toast(options.refineConceptId ? '선택한 콘셉트 1안을 수정 기획했습니다.' : '구도·타이포·메시지가 다른 콘셉트 3안을 기획했습니다.');
  } catch (err) {
    toast(err.message);
  }
}

async function selectConceptAction(conceptId) {
  const c = campaign();
  try {
    await ensureCampaignOnServer(c);
    const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/concepts/${encodeURIComponent(conceptId)}/select`, {
      method: 'POST',
      body: { workspaceId: data.id, campaignId: c.id }
    });
    if (res.campaign) {
      c.titles = res.campaign.titles;
      c.caption = res.campaign.caption;
      c.scenes = res.campaign.scenes;
      c.selectedConceptId = conceptId;
      c.status = '검토 대기';
    }
    if (Array.isArray( data.concepts )) {
      data.concepts.forEach(cp => {
        if (cp.campaignId === c.id) cp.selected = cp.id === conceptId;
      });
    }
    if (Array.isArray(res.contents)) {
      data.contents = [
        ...(data.contents || []).filter(x => x.campaignId !== c.id),
        ...res.contents
      ];
    }
    persist();
    render();
    toast('선택한 콘셉트 방향을 채널별 콘텐츠와 레이어에 반영했습니다.');
  } catch (err) {
    toast(err.message);
  }
}

function openRefineSingleConceptModal(conceptId) {
  const cp = (data.concepts || []).find(x => x.id === conceptId);
  if (!cp) return;
  openModal(
    '이 콘셉트 안만 부분 수정',
    `<p class="intro">다른 2개 콘셉트는 그대로 유지하고 <strong>${esc(cp.name)}</strong>만 새로운 요청사항을 반영해 다시 기획합니다.</p>
    <div class="field">
      <label for="concept-revision-input">수정 요청 문구 · 강조할 포인트</label>
      <input id="concept-revision-input" type="text" maxlength="80" placeholder="예: 첫 문장을 더 간결하게, 혜택 근거 강조" value="">
    </div>`,
    `<button class="btn" data-act="close-modal">취소</button>
     <button class="btn primary" data-act="confirm-concept-refine" data-concept-id="${esc(conceptId)}">${icon('spark')}이 안만 다시 기획</button>`
  );
}

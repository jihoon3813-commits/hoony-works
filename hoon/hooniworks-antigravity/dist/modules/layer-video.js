/* HooniWorks Module 3: Separated Layer Editor & Scene-by-Scene MP4 Video Studio */

function getCurrentChannelContent(c = campaign(), ch = channel) {
  const list = data.contents || [];
  return list.find(x => x.campaignId === c.id && x.channelId === ch) || null;
}

// Wrap paintCard so concept layout & separated layer settings (background, product original scale/offset, logo placement) render on canvas
const basePaintCard = paintCard;
paintCard = function(cv, t, title, im, sub, index = 0, total = 5, format = 'instagram') {
  const c = campaign();
  const content = getCurrentChannelContent(c, format);
  const selectedConcept = (data.concepts || []).find(cp => cp.campaignId === c.id && cp.selected);

  // If this is a template demo card in the template gallery, use basePaintCard directly
  if (cv?.dataset?.demo === 'yes') {
    return basePaintCard(cv, t, title, im, sub, index, total, format);
  }

  const layers = content?.layers;
  const effectiveTemplate = { ...t };
  if (layers?.backgroundLayer) {
    effectiveTemplate.bg = layers.backgroundLayer.bgColor || effectiveTemplate.bg;
    effectiveTemplate.ink = layers.backgroundLayer.inkColor || effectiveTemplate.ink;
    effectiveTemplate.accent = layers.backgroundLayer.accentColor || effectiveTemplate.accent;
    const lc = layers.backgroundLayer.layoutCode;
    if (lc === 'hero-spotlight') effectiveTemplate.layout = 'circle';
    else if (lc === 'editorial-split') effectiveTemplate.layout = 'split';
    else if (lc === 'story-grid') effectiveTemplate.layout = 'guide';
  } else if (selectedConcept?.layoutPlan) {
    effectiveTemplate.bg = selectedConcept.layoutPlan.bgStyle || effectiveTemplate.bg;
    effectiveTemplate.ink = selectedConcept.layoutPlan.inkColor || effectiveTemplate.ink;
    effectiveTemplate.accent = selectedConcept.layoutPlan.accentColor || effectiveTemplate.accent;
  }

  const effectiveSub = layers?.textLayers?.subheadline || sub || effectiveTemplate.subtitle;
  basePaintCard(cv, effectiveTemplate, title, im, effectiveSub, index, total, format);

  // Overlay custom logo placement badge or product layer adjustments if configured
  const ctx = cv.getContext('2d');
  if (layers?.logoLayer && layers.logoLayer.visible === false) {
    ctx.fillStyle = effectiveTemplate.bg;
    ctx.fillRect(60, 45, 700, 50);
  }
  if (layers?.productLayer?.aiRemixEnabled) {
    ctx.fillStyle = '#302a48cc';
    ctx.fillRect(70, cv.height - 105, 320, 34);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 17px "Noto Sans KR", sans-serif';
    ctx.fillText('생성 연출 포함 · 실물 증빙 아님', 84, cv.height - 82);
  }
};

function renderLayerAndVideoInspector() {
  const c = campaign();
  const isVideo = ['youtube', 'reels'].includes(channel);
  const content = getCurrentChannelContent(c, channel);
  const ver = content?.version || 1;
  const isApproved = content && content.approvedVersion === content.version && c.status === '승인 완료';

  if (isVideo) {
    const vSpec = content?.videoSpec || {
      mode: 'photo_motion',
      durationSec: 20,
      narration: { enabled: true, voice: 'ko-KR-Standard-A' },
      musicPreset: 'upbeat-acoustic',
      scenesGenerated: false,
      mp4Rendered: false
    };
    const stageBadge = vSpec.mp4Rendered
      ? '<span class="badge green">MP4 합성 완료 · 다운로드 가능</span>'
      : vSpec.scenesGenerated
      ? '<span class="badge yellow">장면 생성 완료 · MP4 합성 대기</span>'
      : '<span class="badge outline">장면표 시안 (MP4 미생성)</span>';

    return `<div class="layer-video-inspector panel" style="margin-top:16px">
      <div class="flex between" style="flex-wrap:wrap;gap:8px">
        <div>
          <span class="eyebrow">VIDEO SCENE & MP4 SYNTHESIS WORKER</span>
          <h4 style="margin-top:3px">장면 생성 · 자막/음성/음악/로고 합성 · MP4 출력 (v${ver})</h4>
        </div>
        ${stageBadge}
      </div>
      <p class="small muted" style="margin-top:6px">
        장면표는 MP4 영상이 아닙니다. 장면 생성과 영상 편집 합성을 분리하여, 자막·음성·음악만 수정할 때는 장면 생성을 다시 과금하지 않고 MP4 합성만 수행합니다.
      </p>
      <div class="brand-form-grid" style="margin-top:12px">
        <div class="field">
          <label for="video-gen-mode">영상 연출 방식</label>
          <select id="video-gen-mode">
            <option value="photo_motion" ${vSpec.mode === 'photo_motion' ? 'selected' : ''}>사진 기반 모션 · 실제 제품 사진 유지</option>
            <option value="hybrid" ${vSpec.mode === 'hybrid' ? 'selected' : ''}>실제 사진 + 생성 배경 혼합</option>
            <option value="generated" ${vSpec.mode === 'generated' ? 'selected' : ''}>생성 중심 연출 (실제 조리·제공 증빙 제외)</option>
          </select>
        </div>
        <div class="field">
          <label for="video-voice-select">한국어 내레이션 음성</label>
          <select id="video-voice-select">
            <option value="ko-KR-Standard-A" ${vSpec.narration?.voice === 'ko-KR-Standard-A' ? 'selected' : ''}>한국어 여성 A (차분하고 명확한 톤)</option>
            <option value="ko-KR-Standard-C" ${vSpec.narration?.voice === 'ko-KR-Standard-C' ? 'selected' : ''}>한국어 남성 C (신뢰감 있는 안내 톤)</option>
            <option value="ko-KR-Wavenet-B" ${vSpec.narration?.voice === 'ko-KR-Wavenet-B' ? 'selected' : ''}>한국어 여성 B (밝은 리듬감)</option>
          </select>
        </div>
        <div class="field">
          <label for="video-music-select">배경 음악 (BGM) 합성</label>
          <select id="video-music-select">
            <option value="upbeat-acoustic" ${vSpec.musicPreset === 'upbeat-acoustic' ? 'selected' : ''}>어쿠스틱 업비트</option>
            <option value="modern-lofi" ${vSpec.musicPreset === 'modern-lofi' ? 'selected' : ''}>모던 로우파이</option>
            <option value="clean-minimal" ${vSpec.musicPreset === 'clean-minimal' ? 'selected' : ''}>클린 미니멀</option>
          </select>
        </div>
        <div class="field">
          <label for="video-duration-select">영상 길이 · 규격</label>
          <select id="video-duration-select">
            <option value="20" ${Number(vSpec.durationSec) === 20 ? 'selected' : ''}>20초 · 9:16 세로형 (1080×1920)</option>
            <option value="15" ${Number(vSpec.durationSec) === 15 ? 'selected' : ''}>15초 · 9:16 세로형 (1080×1920)</option>
            <option value="30" ${Number(vSpec.durationSec) === 30 ? 'selected' : ''}>30초 · 9:16 세로형 (1080×1920)</option>
          </select>
        </div>
      </div>
      <div class="flex" style="flex-wrap:wrap;gap:8px;margin-top:12px">
        <button class="btn sm" data-act="video-generate-scenes">
          ${icon('spark')}1단계: 장면별 영상 생성 (${c.videoProvider || 'Google'} · 모의/API)
        </button>
        <button class="btn primary sm" data-act="video-synthesize-mp4">
          ${icon('video')}2단계: 자막·음성·음악·로고 MP4 합성 (무료 편집 워커)
        </button>
        ${vSpec.mp4Rendered && content?.mp4File
          ? `<a class="btn sm dark" href="${esc(content.mp4File.downloadUrl)}" download="${esc(content.mp4File.fileName)}">
              ${icon('download')}완성 MP4 다운로드 (${Math.round((content.mp4File.byteSize || 65536) / 1024)}KB)
            </a>`
          : ''}
      </div>
    </div>`;
  }

  const bgColor = content?.layers?.backgroundLayer?.bgColor || selectedTemplate().bg;
  const subheadline = content?.layers?.textLayers?.subheadline || selectedTemplate().subtitle;
  const logoVisible = content?.layers?.logoLayer?.visible !== false;
  const aiRemix = Boolean(content?.layers?.productLayer?.aiRemixEnabled);

  return `<div class="layer-video-inspector panel" style="margin-top:16px">
    <div class="flex between" style="flex-wrap:wrap;gap:8px">
      <div>
        <span class="eyebrow">SEPARATED DESIGN LAYERS</span>
        <h4 style="margin-top:3px">원본 보존 · 4대 분리 레이어 편집 (콘텐츠 버전 v${ver})</h4>
      </div>
      <span class="badge ${isApproved ? 'green' : 'yellow'}">
        ${isApproved ? `v${ver} 승인 완료` : `v${ver} 검토 대기 (문구 수정 시 과금 없음)`}
      </span>
    </div>
    <div class="layer-grid" style="margin-top:12px">
      <div class="layer-item">
        <strong>1. 생성 배경 레이어</strong>
        <small>제품 원본과 분리된 배경/조명</small>
        <div class="flex" style="margin-top:8px">
          <input type="color" id="layer-bg-color" value="${esc(bgColor)}" aria-label="배경 레이어 색상" style="width:44px;height:32px;padding:2px">
          <button class="btn sm" data-act="layer-regen-bg">${icon('spark')}배경만 생성</button>
        </div>
      </div>
      <div class="layer-item">
        <strong>2. 제품·서비스 원본 레이어</strong>
        <small>${prod().placeholder ? '제품 사진 미등록 (플레이스홀더)' : esc(prod().name) + ' · 원본 모양 보존'}</small>
        <label class="check-line" style="margin-top:8px;font-size:10px">
          <input type="checkbox" id="layer-ai-remix" ${aiRemix ? 'checked' : ''}>
          생성 연출로 상품 변형 허용 (기본 비활성)
        </label>
      </div>
      <div class="layer-item">
        <strong>3. 브랜드 로고 레이어</strong>
        <small>${esc(data.brand.name)} 상단 시그니처</small>
        <label class="check-line" style="margin-top:8px;font-size:10px">
          <input type="checkbox" id="layer-logo-visible" ${logoVisible ? 'checked' : ''}>
          로고 레이어 표시
        </label>
      </div>
      <div class="layer-item">
        <strong>4. 편집 가능 한글 보조문구 레이어</strong>
        <input type="text" id="layer-subheadline" value="${esc(subheadline)}" maxlength="70" placeholder="보조 설명 문구" style="margin-top:6px;font-size:11px;padding:6px 8px">
      </div>
    </div>
    <div class="flex between" style="margin-top:12px;flex-wrap:wrap;gap:8px">
      <small class="muted">문구·레이어 배치 수정은 유료 이미지 생성 API를 다시 호출하지 않으며, 이전 승인 상태만 재검토로 전환합니다.</small>
      <button class="btn sm" data-act="layer-apply-free">${icon('check')}레이어 변경 무료 반영</button>
    </div>
  </div>`;
}

async function ensureServerContentForChannel(c = campaign(), ch = channel) {
  await ensureCampaignOnServer(c);
  let content = getCurrentChannelContent(c, ch);
  if (!content) {
    // Initialize concepts & select default if none exists yet on server
    const cpList = getCampaignConcepts(c);
    if (!cpList.length) {
      await planThreeConceptsAction();
    }
    const targetCp = getCampaignConcepts(c)[0];
    if (targetCp) {
      await selectConceptAction(targetCp.id);
    }
    content = getCurrentChannelContent(c, ch);
  }
  return content;
}

async function applyFreeLayerRevision(options = {}) {
  const c = campaign();
  try {
    const content = await ensureServerContentForChannel(c, channel);
    if (!content) return;
    const bgColor = $('#layer-bg-color')?.value || content.layers?.backgroundLayer?.bgColor || '#f4cc59';
    const aiRemixEnabled = Boolean($('#layer-ai-remix')?.checked);
    const logoVisible = $('#layer-logo-visible') ? Boolean($('#layer-logo-visible').checked) : true;
    const subheadline = $('#layer-subheadline')?.value ?? content.layers?.textLayers?.subheadline ?? '';

    const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/contents/${encodeURIComponent(content.id)}/revise`, {
      method: 'POST',
      body: {
        revisionType: options.revisionType || 'layer_text_edit',
        titles: c.titles,
        caption: captionFor(channel),
        subtitles: sceneTexts(),
        layers: {
          backgroundLayer: {
            ...(content.layers?.backgroundLayer || {}),
            bgColor
          },
          productLayer: {
            ...(content.layers?.productLayer || {}),
            aiRemixEnabled,
            preserveOriginal: !aiRemixEnabled
          },
          logoLayer: {
            ...(content.layers?.logoLayer || {}),
            visible: logoVisible
          },
          textLayers: {
            ...(content.layers?.textLayers || {}),
            cardTitles: [...c.titles],
            subheadline
          }
        }
      }
    });

    if (res.content) {
      data.contents = [
        ...(data.contents || []).filter(x => x.id !== res.content.id),
        res.content
      ];
    }
    invalidate();
    render();
    toast('유료 API 재호출 없이 레이어·문구 수정을 반영했습니다. (승인 상태 재검토 전환)');
  } catch (err) {
    toast(err.message);
  }
}

async function triggerContentGenerateAction(jobType) {
  const c = campaign();
  try {
    const content = await ensureServerContentForChannel(c, channel);
    if (!content) return;
    const videoMode = $('#video-gen-mode')?.value || 'photo_motion';
    const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/contents/${encodeURIComponent(content.id)}/generate`, {
      method: 'POST',
      body: {
        jobType,
        videoMode,
        provider: jobType === 'scene_gen' ? (c.videoProvider || 'Google') : (c.imageProvider || 'OpenAI')
      }
    });
    if (res.content) {
      data.contents = [
        ...(data.contents || []).filter(x => x.id !== res.content.id),
        res.content
      ];
    }
    if (res.job) {
      data.jobs = [res.job, ...(data.jobs || []).filter(j => j.id !== res.job.id)];
    }
    if (res.settings) hwServer.settings = res.settings;
    invalidate();
    render();
    toast(jobType === 'scene_gen' ? '장면별 영상 생성이 완료되었습니다. 이제 MP4 합성을 실행할 수 있습니다.' : '배경 레이어 생성이 완료되었습니다. 제품 원본은 그대로 보존됩니다.');
  } catch (err) {
    toast(err.message);
  }
}

async function triggerVideoSynthesizeMp4Action() {
  const c = campaign();
  try {
    const content = await ensureServerContentForChannel(c, channel);
    if (!content) return;
    const voice = $('#video-voice-select')?.value || 'ko-KR-Standard-A';
    const musicPreset = $('#video-music-select')?.value || 'upbeat-acoustic';
    const durationSec = Number($('#video-duration-select')?.value || 20);

    const res = await hwApi(`/api/workspaces/${encodeURIComponent(data.id)}/contents/${encodeURIComponent(content.id)}/revise`, {
      method: 'POST',
      body: {
        revisionType: 'video_render',
        subtitles: sceneTexts(),
        narration: { enabled: true, voice, lines: sceneTexts() },
        musicPreset,
        durationSec
      }
    });
    if (res.content) {
      data.contents = [
        ...(data.contents || []).filter(x => x.id !== res.content.id),
        res.content
      ];
    }
    persist();
    render();
    toast('자막·음성·음악·로고를 합성한 MP4 파일이 준비되었습니다!');
  } catch (err) {
    toast(err.message);
  }
}

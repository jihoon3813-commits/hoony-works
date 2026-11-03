import { getProviderConnectionStatus, getApiKey } from './config.mjs';
import { makeId, HttpError } from './security.mjs';

// Real Image Generation Provider Client (OpenAI DALL-E & Google Imagen)
export async function generateLiveImage({
  provider = 'OpenAI',
  prompt = '',
  brandName = '',
  category = '',
  topic = '',
  aspectRatio = '1:1',
  styleVariant = 'hero-spotlight'
}) {
  const openaiKey = getApiKey('OpenAI');
  const googleKey = getApiKey('Google');

  const finalPrompt = prompt || [
    `Professional commercial photography backdrop for brand "${brandName || 'HooniWorks'}" (${category || 'General'}).`,
    `Subject/Theme: ${topic || 'Product marketing and brand story'}.`,
    `Aesthetic: Modern clean high-end commercial advertising style, sophisticated studio lighting, elegant atmosphere.`,
    `Clean empty space in center-bottom suitable for product overlay. No text, no watermark, photorealistic 8k.`
  ].join(' ');

  if (provider === 'OpenAI' || (!googleKey && openaiKey)) {
    if (!openaiKey) {
      throw new HttpError(400, 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다.', 'MISSING_API_KEY');
    }
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: finalPrompt,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json'
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let msg = errText;
      try {
        const j = JSON.parse(errText);
        msg = j.error?.message || errText;
      } catch {}
      throw new HttpError(resp.status === 401 ? 401 : 502, `OpenAI 이미지 생성 오류 (${resp.status}): ${msg}`, 'UPSTREAM_API_ERROR');
    }

    const json = await resp.json();
    const item = json.data?.[0];
    if (item?.b64_json) {
      return {
        imageUrl: `data:image/png;base64,${item.b64_json}`,
        revisedPrompt: item.revised_prompt || finalPrompt,
        model: 'dall-e-3',
        provider: 'OpenAI'
      };
    }
    if (item?.url) {
      return {
        imageUrl: item.url,
        revisedPrompt: item.revised_prompt || finalPrompt,
        model: 'dall-e-3',
        provider: 'OpenAI'
      };
    }
    throw new HttpError(502, 'OpenAI로부터 이미지 데이터를 수신하지 못했습니다.', 'UPSTREAM_NO_IMAGE');
  }

  if (provider === 'Google' || googleKey) {
    if (!googleKey) {
      throw new HttpError(400, 'GOOGLE_API_KEY 환경변수가 설정되지 않았습니다.', 'MISSING_API_KEY');
    }
    return await generateGoogleImagen({ apiKey: googleKey, prompt: finalPrompt, aspectRatio });
  }

  throw new HttpError(400, '등록된 AI 이미지 생성 API 키(OPENAI_API_KEY 또는 GOOGLE_API_KEY)가 없습니다.', 'MISSING_API_KEY');
}

async function generateGoogleImagen({ apiKey, prompt, aspectRatio = '1:1' }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: aspectRatio === '4:5' ? '3:4' : aspectRatio === '9:16' ? '9:16' : '1:1',
        outputMimeType: 'image/png'
      }
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    let msg = errText;
    try {
      const j = JSON.parse(errText);
      msg = j.error?.message || errText;
    } catch {}
    throw new HttpError(resp.status === 401 ? 401 : 502, `Google Imagen 이미지 생성 오류 (${resp.status}): ${msg}`, 'UPSTREAM_API_ERROR');
  }

  const json = await resp.json();
  const bytes = json.predictions?.[0]?.bytesBase64Encoded;
  if (!bytes) {
    throw new HttpError(502, 'Google Imagen으로부터 이미지 데이터를 수신하지 못했습니다.', 'UPSTREAM_NO_IMAGE');
  }

  return {
    imageUrl: `data:image/png;base64,${bytes}`,
    revisedPrompt: prompt,
    model: 'imagen-3.0-generate-002',
    provider: 'Google'
  };
}

// Official Provider Adapter Registry
// Every adapter exposes: capabilities, estimate, submit, poll, normalizeResult
export const PROVIDER_ADAPTERS = {
  OpenAI: {
    name: 'OpenAI',
    capabilities: {
      tasks: ['concept_plan', 'image_gen', 'narration'],
      designModes: ['creative', 'reference', 'template'],
      supportsReferenceImage: true,
      supportsProductPreservation: true,
      supportsLayerMask: true,
      maxConcepts: 3
    },
    estimate(jobType, params = {}) {
      const status = getProviderConnectionStatus().OpenAI;
      const isLive = Boolean(status.configured && params.allowLiveExecution !== false);
      const table = {
        concept_plan: { unitCostKrw: 450, estimatedJobs: params.singleConceptId ? 1 : 3 },
        image_gen: { unitCostKrw: 1200, estimatedJobs: params.cardCount || 1 },
        narration: { unitCostKrw: 300, estimatedJobs: 1 }
      };
      const entry = table[jobType] || { unitCostKrw: 500, estimatedJobs: 1 };
      return {
        provider: 'OpenAI',
        model: jobType === 'image_gen' ? status.imageModel : status.textModel,
        providerMode: isLive ? 'live' : 'mock',
        currency: 'KRW',
        priceCheckedDate: '2026-11-03',
        estimatedJobs: entry.estimatedJobs,
        costEstimate: entry.unitCostKrw * entry.estimatedJobs
      };
    },
    async submit(jobType, payload = {}) {
      const est = this.estimate(jobType, payload);
      let generatedImage = null;
      let revisedPrompt = null;
      let error = null;

      if (est.providerMode === 'live' && jobType === 'image_gen') {
        try {
          const genResult = await generateLiveImage({
            provider: 'OpenAI',
            prompt: payload.prompt,
            brandName: payload.brandName || payload.workspace?.brand?.name,
            category: payload.category || payload.workspace?.brand?.category,
            topic: payload.topic || payload.campaign?.topic,
            aspectRatio: payload.aspectRatio || '1:1',
            styleVariant: payload.styleVariant || 'hero-spotlight'
          });
          generatedImage = genResult.imageUrl;
          revisedPrompt = genResult.revisedPrompt;
        } catch (err) {
          console.error('[OpenAI Image Gen Live Error]', err.message);
          error = err.message;
          // Fallback to high quality styled SVG so workflow is preserved
          generatedImage = buildGeneratedBackdropSvg('hero-spotlight', payload.workspace?.brand?.color || '#7460dd');
        }
      }

      return {
        upstreamId: `openai-${est.providerMode}-${makeId('req')}`,
        providerMode: est.providerMode,
        model: est.model,
        submittedAt: new Date().toISOString(),
        generatedImage,
        revisedPrompt,
        error
      };
    },
    async poll(upstreamId, simulateTimeout = false) {
      if (simulateTimeout) {
        return { status: 'reconciling', upstreamId, reason: '공급자 응답 지연 — 재결제 전 상태 확인 중' };
      }
      return { status: 'succeeded', upstreamId };
    },
    normalizeResult(jobType, rawResult) {
      return { ...rawResult, normalizedAt: new Date().toISOString() };
    }
  },

  Google: {
    name: 'Google',
    capabilities: {
      tasks: ['concept_plan', 'image_gen', 'scene_gen', 'narration'],
      designModes: ['creative', 'reference', 'template'],
      supportsReferenceImage: true,
      supportsProductPreservation: true,
      supportsVideoScenes: true,
      supportedDurationsSec: [15, 20, 30],
      aspectRatios: ['9:16', '1:1', '4:5']
    },
    estimate(jobType, params = {}) {
      const status = getProviderConnectionStatus().Google;
      const isLive = Boolean(status.configured && params.allowLiveExecution !== false);
      const table = {
        concept_plan: { unitCostKrw: 400, estimatedJobs: params.singleConceptId ? 1 : 3 },
        image_gen: { unitCostKrw: 1100, estimatedJobs: params.cardCount || 1 },
        scene_gen: { unitCostKrw: 2200, estimatedJobs: params.sceneCount || 4 },
        narration: { unitCostKrw: 250, estimatedJobs: 1 }
      };
      const entry = table[jobType] || { unitCostKrw: 600, estimatedJobs: 1 };
      return {
        provider: 'Google',
        model: jobType === 'scene_gen' ? status.videoModel : (jobType === 'image_gen' ? 'imagen-3.0-generate-002' : status.voiceModel),
        providerMode: isLive ? 'live' : 'mock',
        currency: 'KRW',
        priceCheckedDate: '2026-11-03',
        estimatedJobs: entry.estimatedJobs,
        costEstimate: entry.unitCostKrw * entry.estimatedJobs
      };
    },
    async submit(jobType, payload = {}) {
      const est = this.estimate(jobType, payload);
      let generatedImage = null;
      let revisedPrompt = null;
      let error = null;

      if (est.providerMode === 'live' && jobType === 'image_gen') {
        try {
          const genResult = await generateLiveImage({
            provider: 'Google',
            prompt: payload.prompt,
            brandName: payload.brandName || payload.workspace?.brand?.name,
            category: payload.category || payload.workspace?.brand?.category,
            topic: payload.topic || payload.campaign?.topic,
            aspectRatio: payload.aspectRatio || '1:1',
            styleVariant: payload.styleVariant || 'hero-spotlight'
          });
          generatedImage = genResult.imageUrl;
          revisedPrompt = genResult.revisedPrompt;
        } catch (err) {
          console.error('[Google Imagen Live Error]', err.message);
          error = err.message;
          generatedImage = buildGeneratedBackdropSvg('hero-spotlight', payload.workspace?.brand?.color || '#7460dd');
        }
      }

      return {
        upstreamId: `google-${est.providerMode}-${makeId('req')}`,
        providerMode: est.providerMode,
        model: est.model,
        submittedAt: new Date().toISOString(),
        generatedImage,
        revisedPrompt,
        error
      };
    },
    async poll(upstreamId, simulateTimeout = false) {
      if (simulateTimeout) {
        return { status: 'reconciling', upstreamId, reason: 'Google 작업 상태 확인 중 — 중복 실행 방지됨' };
      }
      return { status: 'succeeded', upstreamId };
    },
    normalizeResult(jobType, rawResult) {
      return { ...rawResult, normalizedAt: new Date().toISOString() };
    }
  },

  InternalCompositor: {
    name: 'InternalCompositor',
    capabilities: {
      tasks: ['layer_update', 'video_render'],
      paidApiCall: false
    },
    estimate() {
      return {
        provider: 'InternalCompositor',
        model: 'hooniworks-compositor-v1',
        providerMode: 'local_free',
        currency: 'KRW',
        priceCheckedDate: '2026-11-03',
        estimatedJobs: 1,
        costEstimate: 0
      };
    },
    async submit(jobType) {
      return {
        upstreamId: `compositor-${makeId('render')}`,
        providerMode: 'local_free',
        model: 'hooniworks-compositor-v1',
        submittedAt: new Date().toISOString()
      };
    },
    async poll(upstreamId) {
      return { status: 'succeeded', upstreamId };
    },
    normalizeResult(jobType, rawResult) {
      return { ...rawResult, normalizedAt: new Date().toISOString() };
    }
  }
};

export function getAdapter(providerName, jobType) {
  const adapter = PROVIDER_ADAPTERS[providerName];
  if (!adapter) {
    throw new HttpError(400, `지원하지 않는 공급자(${providerName})입니다.`, 'UNSUPPORTED_PROVIDER');
  }
  if (!adapter.capabilities.tasks.includes(jobType)) {
    throw new HttpError(400, `${providerName} 공급자는 ${jobType} 작업을 지원하지 않습니다.`, 'UNSUPPORTED_TASK_COMBINATION');
  }
  return adapter;
}

// Build SVG background data URL for distinct concept visual backdrops (never overwrites product photo)
function buildGeneratedBackdropSvg(styleVariant, brandColor = '#7460dd') {
  const palettes = {
    'hero-spotlight': { bg1: '#1f1d2b', bg2: '#332d4b', accent: brandColor, shape: 'spotlight' },
    'editorial-split': { bg1: '#f6f3ec', bg2: '#ebe4d6', accent: brandColor, shape: 'editorial' },
    'story-grid': { bg1: '#eef3ef', bg2: '#dce7de', accent: '#4a6b56', shape: 'grid' },
    'reference-mood': { bg1: '#f4edf8', bg2: '#e3d5f0', accent: brandColor, shape: 'mood' }
  };
  const p = palettes[styleVariant] || palettes['hero-spotlight'];
  let shapes = '';
  if (p.shape === 'spotlight') {
    shapes = `<circle cx="540" cy="780" r="390" fill="${p.accent}" fill-opacity="0.22"/><circle cx="880" cy="220" r="180" fill="#ffffff" fill-opacity="0.06"/>`;
  } else if (p.shape === 'editorial') {
    shapes = `<rect x="0" y="620" width="1080" height="730" fill="${p.accent}" fill-opacity="0.16"/><line x1="70" y1="150" x2="1010" y2="150" stroke="#2c2836" stroke-width="2" stroke-opacity="0.25"/>`;
  } else if (p.shape === 'grid') {
    shapes = `<rect x="60" y="540" width="440" height="660" rx="28" fill="#ffffff" fill-opacity="0.65"/><rect x="530" y="540" width="490" height="660" rx="28" fill="${p.accent}" fill-opacity="0.14"/>`;
  } else {
    shapes = `<ellipse cx="540" cy="700" rx="460" ry="320" fill="${p.accent}" fill-opacity="0.18"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${p.bg1}"/><stop offset="100%" stop-color="${p.bg2}"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/>${shapes}</svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Generate 3 genuinely distinct concepts (layout, typography, photo placement, message structure)
export function buildThreeConcepts({
  workspace,
  campaign,
  designMode = 'creative',
  productAssets = [],
  referenceAssets = [],
  templateObj = null,
  providerMode = 'mock',
  variationSeed = ''
}) {
  const brandName = workspace.brand?.name || '브랜드';
  const brandColor = workspace.brand?.color || '#7460dd';
  const cta = workspace.brand?.cta || '자세히 알아보기';
  const topic = campaign.topic || workspace.brand?.description || `${brandName} 핵심 매력 소개`;
  const audienceLabel = campaign.audience === 'business' ? '사업자·파트너 고객' : '일반 소비자 고객';
  const goalLabel = campaign.goal || (campaign.audience === 'business' ? '도입·제휴 상담' : '상품·서비스 소개');
  const approvedFacts = Array.isArray(workspace.brand?.approvedFacts) ? workspace.brand.approvedFacts : [];
  const primaryFact = approvedFacts[0]?.claim || workspace.brand?.description || `${brandName}의 확인된 브랜드 소개`;
  const secondaryFact = approvedFacts[1]?.claim || `고객 대상: ${workspace.brand?.audience || audienceLabel}`;

  const hasProductPhoto = productAssets.length > 0;
  const hasRefPhoto = referenceAssets.length > 0;
  const missingWarnings = [];
  if (!hasProductPhoto) {
    missingWarnings.push('등록된 실제 제품·서비스 원본 사진이 없어 기본 플레이스홀더 구도로 기획되었습니다. 자료실에서 실제 사진을 추가하세요.');
  }
  if (!approvedFacts.length) {
    missingWarnings.push('승인된 상품 사실(가격·조건·실적 근거)이 등록되지 않아 확인된 기본 브랜드 소개 문구만 사용합니다.');
  }

  const refExplanation = hasRefPhoto
    ? `참고 자료(${referenceAssets.map(a => a.name).join(', ')})의 조명 대비와 여백 비율을 배경 연출에 반영하고 제품 원본은 보존`
    : '브랜드 포인트 컬러와 여백 대비를 활용한 자체 무드 설계';

  const suffixes = variationSeed ? ` (${variationSeed})` : '';

  const blueprints = [
    {
      index: 0,
      name: `콘셉트 A · 히어로 스포트라이트 & 핵심 질문형${suffixes}`,
      structureType: 'question_hook_spotlight',
      messageDirection: `첫 카드에서 ${audienceLabel}의 핵심 고민/질문을 던지고, ${brandName}의 대표 가치를 직관적인 대비로 제시`,
      layoutPlan: {
        code: 'hero-spotlight',
        summary: '중앙 집중 스포트라이트 구도 · 상단 대형 질문 헤드라인 + 하단 정중앙 제품 클로즈업 배치',
        gridSpec: '1단 수직 집중형 (헤드라인 35% / 제품 스포트라이트 50% / 하단 CTA 15%)',
        aspectRatio: '4:5',
        bgStyle: '#232030',
        inkColor: '#ffffff',
        accentColor: brandColor
      },
      typographyPlan: {
        headlineStyle: '대형 볼드 산세리프 (92pt, 좌측 정렬, 2줄 압축)',
        subheadStyle: '핵심 근거 1줄 요약 캡션 (28pt, 고대비 포인트 컬러)',
        hierarchy: '질문형 후킹 헤드라인 → 승인된 사실 요약 → 하단 브랜드 시그니처'
      },
      photoPlacement: {
        productPosition: 'center-bottom (x:540, y:860, scale:0.86)',
        preserveOriginal: true,
        layerSeparation: '생성 스포트라이트 배경 + 실제 제품 누끼 원본 레이어 + 편집 가능 한글 타이포 레이어',
        referenceUsage: designMode === 'reference' ? refExplanation : '제품 원본 단독 부각'
      },
      copyPlan: {
        titles: [
          `${brandName},\n왜 지금 주목받을까요?`,
          `${primaryFact.slice(0, 28)}`,
          `핵심 포인트만\n선명하게 비교하세요.`,
          `${secondaryFact.slice(0, 28)}`,
          `${cta}`
        ],
        caption: `[${brandName}] ${topic}\n\n• 핵심 확인 사항: ${primaryFact}\n• 안내 대상: ${audienceLabel}\n\n${cta}`,
        scenes: [
          `${brandName}, 왜 지금 필요할까요?`,
          `실제 모습 그대로 확인하는 핵심 특징`,
          `${primaryFact.slice(0, 32)}`,
          `${cta}`
        ]
      }
    },
    {
      index: 1,
      name: `콘셉트 B · 에디토리얼 매거진 분할 & 팩트 스토리형${suffixes}`,
      structureType: 'editorial_fact_story',
      messageDirection: `매거진 아티클처럼 차분한 여백과 상하 분할 프레임으로 ${brandName}의 확인된 특징과 근거를 순서대로 전달`,
      layoutPlan: {
        code: 'editorial-split',
        summary: '상하 비대칭 에디토리얼 프레임 · 상단 와이드 제품/연출 프레임 + 하단 매거진 타이포 블록',
        gridSpec: '상하 55:45 분할형 (상단 컬러 프레임 & 제품 원본 / 하단 에디토리얼 본문 & 인덱스)',
        aspectRatio: '4:5',
        bgStyle: '#f6f3ec',
        inkColor: '#2b2833',
        accentColor: brandColor
      },
      typographyPlan: {
        headlineStyle: '중형 에디토리얼 타이틀 (74pt, 절제된 행간, 상단 보더 라인)',
        subheadStyle: '본문형 설명 캡션 + 번호 인덱스 (26pt, 가독성 중심)',
        hierarchy: '에디토리얼 인덱스 헤더 → 제품 실물 프레임 → 팩트 기반 타이틀 & 본문'
      },
      photoPlacement: {
        productPosition: 'top-frame-center (x:540, y:440, scale:0.78)',
        preserveOriginal: true,
        layerSeparation: '에디토리얼 매트 배경 + 상단 프레임 박스 + 제품 원본 레이어 + 하단 한글 텍스트 레이어',
        referenceUsage: designMode === 'reference' ? refExplanation : '에디토리얼 톤앤매너 적용'
      },
      copyPlan: {
        titles: [
          `자세히 들여다본\n${brandName}의 기준.`,
          `첫 번째 기준,\n확인된 품질과 구성.`,
          `두 번째 기준,\n우리 일상에 맞는 동선.`,
          `과장 없이 전하는\n실제 상품 이야기.`,
          `지금 ${brandName}에서\n직접 확인해 보세요.`
        ],
        caption: `${brandName} 에디토리얼 노트\n\n${topic}\n✔ ${primaryFact}\n✔ ${secondaryFact}\n\n${cta}`,
        scenes: [
          `${brandName}의 기준을 소개합니다`,
          `확인된 사실: ${primaryFact.slice(0, 26)}`,
          `고객에게 전하는 실질적인 가치`,
          `${cta}`
        ]
      }
    },
    {
      index: 2,
      name: `콘셉트 C · 3단 체크 가이드 & 행동 유도 비교형${suffixes}`,
      structureType: 'guide_checklist_action',
      messageDirection: `${audienceLabel}이 결정 전 바로 확인할 수 있는 3가지 체크리스트와 우측 실물 사진을 나란히 배치한 실용 가이드`,
      layoutPlan: {
        code: 'story-grid',
        summary: '좌우 2열 스토리 그리드 구도 · 좌측 01-02-03 체크리스트 블록 + 우측 제품 원본 배치',
        gridSpec: '좌우 비대칭 2열 그리드 (상단 요약 헤드라인 28% / 좌측 3단 포인트 카드 + 우측 제품 실물 72%)',
        aspectRatio: '4:5',
        bgStyle: '#eef3ef',
        inkColor: '#233329',
        accentColor: '#4a6b56'
      },
      typographyPlan: {
        headlineStyle: '컴팩트 가이드 헤드라인 (78pt, 좌측 정렬) + 01/02/03 넘버링 뱃지 (24pt)',
        subheadStyle: '단계별 행동 유도 요약문 (25pt)',
        hierarchy: '핵심 주제 선언 → 01·02·03 체크 포인트 → 우측 실물 대조 → 상담/행동 유도'
      },
      photoPlacement: {
        productPosition: 'right-column (x:730, y:830, scale:0.72)',
        preserveOriginal: true,
        layerSeparation: '2열 그리드 배경 + 체크리스트 장식 레이어 + 우측 제품 원본 레이어 + 한글 가이드 레이어',
        referenceUsage: designMode === 'reference' ? refExplanation : '실용 안내 카드 구도'
      },
      copyPlan: {
        titles: [
          `한눈에 정리한\n${brandName} 핵심 가이드`,
          `01 대상 확인\n${audienceLabel} 맞춤 설계`,
          `02 핵심 특징\n${primaryFact.slice(0, 22)}`,
          `03 진행 방법\n간편한 확인과 문의`,
          `우리에게 맞는지\n${cta}`
        ],
        caption: `한눈에 보는 ${brandName} 체크리스트\n\n01. 대상: ${audienceLabel}\n02. 특징: ${primaryFact}\n03. 목적: ${goalLabel}\n\n${cta}`,
        scenes: [
          `한눈에 보는 ${brandName} 3가지 포인트`,
          `Point 1 · ${primaryFact.slice(0, 24)}`,
          `Point 2 · ${secondaryFact.slice(0, 24)}`,
          `Point 3 · ${cta}`
        ]
      }
    }
  ];

  return blueprints.map(bp => ({
    id: makeId('concept'),
    workspaceId: workspace.id,
    campaignId: campaign.id,
    designMode,
    templateId: designMode === 'template' ? (templateObj?.id || campaign.template || 'yellow') : null,
    name: bp.name,
    audience: campaign.audience,
    goal: goalLabel,
    structureType: bp.structureType,
    messageDirection: bp.messageDirection,
    layoutPlan: bp.layoutPlan,
    typographyPlan: bp.typographyPlan,
    photoPlacement: bp.photoPlacement,
    copyPlan: bp.copyPlan,
    backdropDataUrl: buildGeneratedBackdropSvg(bp.layoutPlan.code, brandColor),
    assetRefs: {
      productAssetIds: productAssets.map(a => a.id),
      productNames: productAssets.map(a => a.name),
      referenceAssetIds: referenceAssets.map(a => a.id),
      referenceNames: referenceAssets.map(a => a.name),
      preserveProduct: true
    },
    approvedFactsUsed: approvedFacts.map(f => ({ id: f.id, claim: f.claim, source: f.source, version: f.version })),
    missingWarnings,
    estimatedJobs: campaign.channels?.length || 3,
    estimatedCostKrw: 1200,
    providerMode,
    selected: false,
    version: 1,
    createdAt: new Date().toISOString()
  }));
}

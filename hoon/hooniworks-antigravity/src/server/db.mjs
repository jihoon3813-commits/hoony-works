import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, UPLOADS_DIR } from './config.mjs';
import { makeId, sha256Hex, HttpError } from './security.mjs';

const DB_FILE = path.join(DATA_DIR, 'hooniworks-db.json');

const DEFAULT_PIE_CAMPAIGNS = [
  {
    id: 'sample-1',
    workspaceId: 'brand-120pie',
    name: '우리 카페에 디저트를 더한다면',
    product: 'apple',
    productItemId: 'item-120-apple',
    productAssetIds: ['asset-120-apple'],
    referenceAssetIds: [],
    audience: 'business',
    status: '검토 대기',
    designMode: 'template',
    template: 'yellow',
    templateId: 'yellow',
    preserveProduct: true,
    channels: ['instagram', 'kakao', 'blog', 'youtube', 'reels'],
    goal: '샵인샵 도입 상담',
    topic: '우리 카페에 맞는 디저트 메뉴 추가',
    titles: [
      '우리 카페에\n디저트를 더한다면?',
      '고객이 찾는\n메뉴부터.',
      '우리 매장에 맞는\n공간과 동선.',
      '커피 옆에,\n바삭한 한 조각.',
      '우리 매장에 맞는지\n함께 확인해요.'
    ],
    caption: '우리 카페에 새로운 디저트를 더하고 싶다면?\n고객 취향, 매장 동선, 도입 조건부터 살펴보세요.\n120pie&coffee 샵인샵이 우리 매장에 맞는지 상담으로 확인해 보세요.\n\n#120pieandcoffee #120겹파이 #카페디저트 #샵인샵',
    scenes: [
      '우리 카페에\n디저트를 더한다면?',
      '고객이 찾는\n메뉴부터.',
      '공간과 준비 동선까지\n함께 확인해요.',
      '우리 매장에 맞는지\n상담해 보세요.'
    ],
    textProvider: 'OpenAI',
    imageProvider: 'OpenAI',
    videoProvider: 'Google',
    updated: '샘플 캠페인',
    version: 1
  },
  {
    id: 'sample-2',
    workspaceId: 'brand-120pie',
    name: '커피와 함께하는 바삭한 오후',
    product: 'pepperoni',
    productItemId: 'item-120-pepperoni',
    productAssetIds: ['asset-120-pepperoni'],
    referenceAssetIds: [],
    audience: 'consumer',
    status: '초안',
    designMode: 'template',
    template: 'yellow',
    templateId: 'yellow',
    preserveProduct: true,
    channels: ['instagram', 'kakao', 'blog', 'youtube', 'reels'],
    goal: '제품·매장 홍보',
    topic: '우리 카페에 맞는 디저트 메뉴 추가',
    titles: [
      '커피 옆에,\n바삭한 한 조각.',
      '오늘의 취향을\n채워보세요.',
      '나를 위한\n달콤한 시간.',
      '당신의 오후에,\n파이와 커피.',
      '120pie&coffee와\n함께하는 오늘.'
    ],
    caption: '커피 한 잔에 바삭한 파이 한 조각.\n오늘의 오후를 120pie&coffee와 함께해 보세요.\n\n#120pieandcoffee #120겹파이 #파이와커피',
    scenes: [
      '커피 옆에,\n바삭한 한 조각.',
      '오늘의 취향을\n채워보세요.',
      '나를 위한\n달콤한 시간.',
      '120pie&coffee와\n함께하는 오늘.'
    ],
    textProvider: 'OpenAI',
    imageProvider: 'OpenAI',
    videoProvider: 'Google',
    updated: '샘플 캠페인',
    version: 1
  },
  {
    id: 'sample-3',
    workspaceId: 'brand-120pie',
    name: '취향을 채우는 파이 한 조각',
    product: 'apple',
    productItemId: 'item-120-apple',
    productAssetIds: ['asset-120-apple'],
    referenceAssetIds: ['asset-120-lifestyle'],
    audience: 'consumer',
    status: '검토 대기',
    designMode: 'template',
    template: 'yellow',
    templateId: 'yellow',
    preserveProduct: true,
    channels: ['instagram', 'kakao', 'blog', 'youtube', 'reels'],
    goal: '제품·매장 홍보',
    topic: '우리 카페에 맞는 디저트 메뉴 추가',
    titles: [
      '커피 옆에,\n바삭한 한 조각.',
      '오늘의 취향을\n채워보세요.',
      '나를 위한\n달콤한 시간.',
      '당신의 오후에,\n파이와 커피.',
      '120pie&coffee와\n함께하는 오늘.'
    ],
    caption: '커피 한 잔에 바삭한 파이 한 조각.\n오늘의 오후를 120pie&coffee와 함께해 보세요.\n\n#120pieandcoffee #120겹파이 #파이와커피',
    scenes: [
      '커피 옆에,\n바삭한 한 조각.',
      '오늘의 취향을\n채워보세요.',
      '나를 위한\n달콤한 시간.',
      '120pie&coffee와\n함께하는 오늘.'
    ],
    textProvider: 'OpenAI',
    imageProvider: 'OpenAI',
    videoProvider: 'Google',
    updated: '샘플 캠페인',
    version: 1
  }
];

function createSeedDatabase() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    settings: {
      budget: 50000,
      usedBudget: 0,
      reservedBudget: 0,
      currency: 'KRW',
      priceCheckedDate: '2026-11-03',
      retries: 2
    },
    users: [
      { id: 'user-jh', email: 'jh@hooniworks.local', name: '김지훈', roleLabel: '워크스페이스 관리자' },
      { id: 'user-guest', email: 'partner@hooniworks.local', name: '외부 담당자', roleLabel: '제한된 계정 (권한 검증용)' }
    ],
    workspaces: [
      {
        id: 'brand-120pie',
        accountId: 'user-jh',
        createdAt: now,
        updatedAt: now,
        version: 1,
        brand: {
          name: '120pie&coffee',
          category: '식음료·카페',
          color: '#efc34b',
          audience: '카페 운영자와 디저트를 즐기는 고객',
          tone: '밝고 명확하게, 제품 사진 중심으로',
          description: '120겹 파이와 커피를 소개하는 디저트 브랜드',
          cta: '우리 매장 도입 조건 상담하기',
          approvedFacts: [
            {
              id: 'fact-120-1',
              claim: '120겹 페이스트리 결을 살린 수제 파이 디저트 라인업(애플·페페로니·블루베리)',
              source: '120pie&coffee 브랜드 기본 소개서 v1',
              confirmedDate: '2026-11-03',
              version: 1
            },
            {
              id: 'fact-120-2',
              claim: '기존 카페 공간·동선에 맞춘 샵인샵 도입 상담 제공 (구체 조건은 매장별 상담 확인)',
              source: '120pie&coffee 파트너 안내 기준 v1',
              confirmedDate: '2026-11-03',
              version: 1
            }
          ],
          links: {
            website: 'https://120piecoffee.com',
            instagram: 'https://www.instagram.com/120piecoffee/',
            kakao: '',
            blog: '',
            youtube: ''
          },
          accounts: {
            instagram: '@120piecoffee',
            kakao: '',
            blog: '',
            youtube: ''
          }
        },
        catalog: [
          { id: 'apple', name: '애플파이', img: 'assets/apple.webp' },
          { id: 'pepperoni', name: '페페로니 피자파이', img: 'assets/pepperoni.webp' },
          { id: 'blueberry', name: '블루베리파이', img: 'assets/blueberry.webp' }
        ]
      }
    ],
    memberships: [
      { id: 'mem-1', workspaceId: 'brand-120pie', userId: 'user-jh', role: 'owner' }
    ],
    productItems: [
      {
        id: 'item-120-apple',
        workspaceId: 'brand-120pie',
        code: 'apple',
        name: '애플파이',
        description: '사과 필링과 120겹 페이스트리가 어우러진 시그니처 파이',
        approvedConditions: '제품 실제 단면 및 모양 보존 필수',
        sourceVersion: 'v1.0 (2026-11-03)'
      },
      {
        id: 'item-120-pepperoni',
        workspaceId: 'brand-120pie',
        code: 'pepperoni',
        name: '페페로니 피자파이',
        description: '짭짤한 페페로니 토핑과 바삭한 파이 크러스트',
        approvedConditions: '제품 실제 토핑 및 형태 보존 필수',
        sourceVersion: 'v1.0 (2026-11-03)'
      },
      {
        id: 'item-120-blueberry',
        workspaceId: 'brand-120pie',
        code: 'blueberry',
        name: '블루베리파이',
        description: '상큼한 블루베리 필링을 담은 디저트 파이',
        approvedConditions: '제품 실제 필링 색상 및 모양 보존 필수',
        sourceVersion: 'v1.0 (2026-11-03)'
      }
    ],
    assets: [
      {
        id: 'asset-120-apple',
        workspaceId: 'brand-120pie',
        productItemId: 'item-120-apple',
        legacyId: 'apple',
        name: '애플파이',
        menu: '애플파이',
        role: 'product',
        type: '실제 제품·서비스 사진',
        tags: '실제 제품, 누끼',
        img: 'assets/apple.webp',
        originalKey: 'dist/assets/apple.webp',
        previewKey: 'assets/apple.webp',
        sha256: 'b9def1e32c70eed146d62174b5ef963ef0ae472dfafe700407c421a3f53bc563',
        provenance: 'catalog_original',
        createdAt: now
      },
      {
        id: 'asset-120-pepperoni',
        workspaceId: 'brand-120pie',
        productItemId: 'item-120-pepperoni',
        legacyId: 'pepperoni',
        name: '페페로니 피자파이',
        menu: '페페로니 피자파이',
        role: 'product',
        type: '실제 제품·서비스 사진',
        tags: '실제 제품, 누끼',
        img: 'assets/pepperoni.webp',
        originalKey: 'dist/assets/pepperoni.webp',
        previewKey: 'assets/pepperoni.webp',
        sha256: '29cce53d3449806804fcabb545c317674f5dee5fe22a9703e9f1b55676450e4b',
        provenance: 'catalog_original',
        createdAt: now
      },
      {
        id: 'asset-120-blueberry',
        workspaceId: 'brand-120pie',
        productItemId: 'item-120-blueberry',
        legacyId: 'blueberry',
        name: '블루베리파이',
        menu: '블루베리파이',
        role: 'product',
        type: '실제 제품·서비스 사진',
        tags: '실제 제품, 누끼',
        img: 'assets/blueberry.webp',
        originalKey: 'dist/assets/blueberry.webp',
        previewKey: 'assets/blueberry.webp',
        sha256: '21be4cc1b5c24b6f3cf8151e50aec342643490e6296c9657b4f65697a41a6143',
        provenance: 'catalog_original',
        createdAt: now
      },
      {
        id: 'asset-120-lifestyle',
        workspaceId: 'brand-120pie',
        productItemId: null,
        legacyId: 'lifestyle',
        name: '애플파이와 라떼',
        menu: '',
        role: 'reference',
        type: '생성 연출 이미지',
        tags: '분위기 참고',
        img: 'assets/lifestyle.webp',
        originalKey: 'dist/assets/lifestyle.webp',
        previewKey: 'assets/lifestyle.webp',
        sha256: '6c7772590432b0a8af80e2c52b939b6081af46efd740177d2cfa6375d66b87c8',
        provenance: 'generated_reference_not_store_proof',
        createdAt: now
      }
    ],
    campaigns: structuredClone(DEFAULT_PIE_CAMPAIGNS),
    concepts: [],
    templates: [],
    contents: [],
    generationJobs: [],
    channelConnections: [
      {
        id: 'conn-120-instagram',
        workspaceId: 'brand-120pie',
        platform: 'instagram',
        externalAccountId: null,
        accountName: '@120piecoffee',
        publicUrl: 'https://www.instagram.com/120piecoffee/',
        scopes: [],
        secretRef: null,
        expiresAt: null,
        state: 'unconnected',
        updatedAt: now
      },
      {
        id: 'conn-120-youtube',
        workspaceId: 'brand-120pie',
        platform: 'youtube',
        externalAccountId: null,
        accountName: '',
        publicUrl: '',
        scopes: [],
        secretRef: null,
        expiresAt: null,
        state: 'unconnected',
        updatedAt: now
      },
      {
        id: 'conn-120-blog',
        workspaceId: 'brand-120pie',
        platform: 'blog',
        externalAccountId: null,
        accountName: '',
        publicUrl: '',
        scopes: [],
        secretRef: null,
        expiresAt: null,
        state: 'manual_only',
        updatedAt: now
      },
      {
        id: 'conn-120-kakao',
        workspaceId: 'brand-120pie',
        platform: 'kakao',
        externalAccountId: null,
        accountName: '',
        publicUrl: '',
        scopes: [],
        secretRef: null,
        expiresAt: null,
        state: 'manual_only',
        updatedAt: now
      }
    ],
    publications: [],
    auditLogs: [],
    uploadSessions: []
  };
}

export class HooniDatabase {
  constructor(filePath = DB_FILE) {
    this.filePath = filePath;
    this.state = null;
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.workspaces)) {
          this.state = parsed;
          return;
        }
      } catch (err) {
        // Preserve corrupt file as backup without overwriting silently
        const backupPath = `${this.filePath}.corrupt-${Date.now()}.bak`;
        try {
          fs.copyFileSync(this.filePath, backupPath);
        } catch {}
      }
    }
    this.state = createSeedDatabase();
    this.save();
  }

  save() {
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  get users() { return this.state.users; }
  get workspaces() { return this.state.workspaces; }
  get memberships() { return this.state.memberships; }
  get productItems() { return this.state.productItems; }
  get assets() { return this.state.assets; }
  get campaigns() { return this.state.campaigns; }
  get concepts() { return this.state.concepts; }
  get templates() { return this.state.templates; }
  get contents() { return this.state.contents; }
  get generationJobs() { return this.state.generationJobs; }
  get channelConnections() { return this.state.channelConnections; }
  get publications() { return this.state.publications; }
  get auditLogs() { return this.state.auditLogs; }
  get uploadSessions() { return this.state.uploadSessions; }
  get settings() { return this.state.settings; }

  logAudit(workspaceId, actorId, action, entityId, detail = {}) {
    // Strip any accidental secret fields
    const sanitizedDetail = {};
    for (const [k, v] of Object.entries(detail || {})) {
      if (/secret|token|key|password/i.test(k)) continue;
      sanitizedDetail[k] = v;
    }
    this.state.auditLogs.unshift({
      id: makeId('audit'),
      workspaceId: workspaceId || 'global',
      actorId: actorId || 'anonymous',
      action,
      entityId: String(entityId || ''),
      at: new Date().toISOString(),
      sanitizedDetail
    });
    if (this.state.auditLogs.length > 500) {
      this.state.auditLogs.length = 500;
    }
    this.save();
  }

  // Atomic budget reservation before queuing/running generation jobs
  reserveBudget(amountKrw) {
    const cost = Math.max(0, Math.round(Number(amountKrw) || 0));
    if (cost === 0) return 0;
    const s = this.state.settings;
    const totalCommitted = (s.usedBudget || 0) + (s.reservedBudget || 0);
    if (totalCommitted + cost > s.budget) {
      throw new HttpError(
        402,
        `월 사용 한도(${s.budget.toLocaleString()}원)를 초과하여 작업을 시작할 수 없습니다. (현재 사용/예약: ${totalCommitted.toLocaleString()}원, 요청: ${cost.toLocaleString()}원)`,
        'BUDGET_EXCEEDED'
      );
    }
    s.reservedBudget = (s.reservedBudget || 0) + cost;
    this.save();
    return cost;
  }

  commitBudget(reservedAmount, actualAmount) {
    const s = this.state.settings;
    s.reservedBudget = Math.max(0, (s.reservedBudget || 0) - (reservedAmount || 0));
    s.usedBudget = (s.usedBudget || 0) + Math.max(0, Math.round(Number(actualAmount) || 0));
    this.save();
  }

  releaseBudget(reservedAmount) {
    const s = this.state.settings;
    s.reservedBudget = Math.max(0, (s.reservedBudget || 0) - (reservedAmount || 0));
    this.save();
  }

  // Assemble full workspace view for authorized user
  getHydratedWorkspace(workspaceId) {
    const ws = this.workspaces.find(w => w.id === workspaceId);
    if (!ws) return null;
    const wsAssets = this.assets.filter(a => a.workspaceId === workspaceId && !a.legacyId);
    const wsCampaigns = this.campaigns.filter(c => c.workspaceId === workspaceId);
    const wsConcepts = this.concepts.filter(c => c.workspaceId === workspaceId);
    const wsTemplates = this.templates.filter(t => t.workspaceId === workspaceId || t.visibility === 'shared');
    const wsContents = this.contents.filter(c => c.workspaceId === workspaceId);
    const wsJobs = this.generationJobs.filter(j => j.workspaceId === workspaceId);
    const wsConnections = this.channelConnections.filter(c => c.workspaceId === workspaceId).map(c => ({
      id: c.id,
      workspaceId: c.workspaceId,
      platform: c.platform,
      externalAccountId: c.externalAccountId,
      accountName: c.accountName,
      publicUrl: c.publicUrl,
      scopes: c.scopes,
      expiresAt: c.expiresAt,
      state: c.state,
      updatedAt: c.updatedAt
      // Never include secretRef!
    }));
    const wsPublications = this.publications.filter(p => p.workspaceId === workspaceId);
    const wsProductItems = this.productItems.filter(p => p.workspaceId === workspaceId);

    return {
      ...ws,
      productItems: wsProductItems,
      uploads: wsAssets,
      campaigns: wsCampaigns,
      concepts: wsConcepts,
      templates: wsTemplates,
      contents: wsContents,
      jobs: wsJobs,
      channelConnections: wsConnections,
      posts: wsPublications.map(p => ({
        id: p.id,
        workspaceId: p.workspaceId,
        campaignId: p.campaignId,
        channel: p.channelId,
        contentId: p.contentId,
        contentVersionId: p.contentVersionId,
        status: p.state === 'manual_record' ? 'manual' : p.state,
        state: p.state,
        url: p.remoteUrl || (p.manualRecord ? p.manualRecord.url : ''),
        remotePostId: p.remotePostId,
        providerMode: p.providerMode || 'mock',
        at: p.publishedAt || p.createdAt
      })),
      publications: wsPublications
    };
  }
}

export const db = new HooniDatabase();

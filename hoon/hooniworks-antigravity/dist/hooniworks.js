/* HooniWorks: multiple product workspaces with a backward-compatible local migration.
 * Workspace IDs are ownership boundaries for local records, not server authorization.
 * Real generation, OAuth, server persistence and automatic publishing are not connected. */
const WORKS_KEY = 'hooniworks-workspaces-v1';
const PIE_ID = 'brand-120pie';
const pieCatalog = structuredClone(products);
const emptyLinks = () => ({website:'',instagram:'',kakao:'',blog:'',youtube:''});
const emptyAccounts = () => ({instagram:'',kakao:'',blog:'',youtube:''});
const isPie = () => data.id === PIE_ID;
const exportPrefix = () => (data.brand.name.replace(/[^a-zA-Z0-9가-힣_-]/g,'-').slice(0,50) || 'hooniworks');
const initialMark = name => Array.from(name || 'HW').slice(0,2).join('').toUpperCase();
const validColor = c => /^#[a-f\d]{6}$/i.test(c || '') ? c : '#7661dc';
function placeholderImage(color='#7661dc') {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect x="190" y="110" width="420" height="340" rx="35" fill="${validColor(color)}" fill-opacity=".1" stroke="${validColor(color)}" stroke-width="3" stroke-dasharray="12 10"/><path d="m250 360 100-110 80 90 55-60 65 80" fill="none" stroke="${validColor(color)}" stroke-width="8" stroke-linejoin="round"/><circle cx="490" cy="210" r="25" fill="${validColor(color)}"/><text x="400" y="510" text-anchor="middle" font-size="25" fill="#6c697a" font-family="sans-serif">제품·서비스 사진을 추가하세요</text></svg>`);
}
function normalizeWorkspace(w) {
  w.brand ||= {}; w.brand.links = {...emptyLinks(),...w.brand.links}; w.brand.accounts = {...emptyAccounts(),...w.brand.accounts};
  w.brand.color = validColor(w.brand.color || (w.id === PIE_ID ? '#efc34b' : '#7661dc'));
  w.brand.category ||= w.id === PIE_ID ? '식음료·카페' : '기타';
  w.brand.audience ||= w.id === PIE_ID ? '카페 운영자와 디저트를 즐기는 고객' : '';
  for (const k of ['campaigns','uploads','templates','posts']) if (!Array.isArray(w[k])) w[k] = [];
  w.catalog ||= w.id === PIE_ID ? structuredClone(pieCatalog) : [];
  w.templates.forEach(t=>{if(t.category==='메뉴 소개')t.category='상품 소개';});
  w.campaigns.forEach(c => {c.workspaceId=w.id;c.designMode ||= 'template';});
  return w;
}
let works, storageWarning='';
try {
  const saved = localStorage.getItem(WORKS_KEY);
  if (saved) {
    works = JSON.parse(saved);
    if (works.version !== 1 || !Array.isArray(works.workspaces) || !works.workspaces.length || works.workspaces.some(w=>!w.id||!w.brand?.name)) throw Error('Invalid workspace file');
  }
} catch {
  storageWarning='저장된 후니웍스 데이터를 읽지 못했습니다. 원본은 보존하고 120pie 화면을 열었습니다.';
}
if (!works || storageWarning) works = {version:1,activeId:PIE_ID,settings:{budget:data.budget||50000,retries:data.retries??2},workspaces:[{...data,id:PIE_ID,createdAt:new Date().toISOString(),catalog:structuredClone(pieCatalog)}]};
works.workspaces.forEach(normalizeWorkspace);
works.settings ||= {budget:50000,retries:2};
works.activeId = works.workspaces.some(w=>w.id===works.activeId) ? works.activeId : works.workspaces[0].id;
data = works.workspaces.find(w=>w.id===works.activeId);
function activateCatalog() {
  const list=data.catalog.length?data.catalog:[{id:'primary',name:data.brand.name,img:placeholderImage(data.brand.color),placeholder:true}];
  products.splice(0,products.length,...list);
  data.budget=works.settings.budget;data.retries=works.settings.retries;
}
activateCatalog();
current=data.campaigns[0]?.id||null;
function draftFallback() {
  return {id:'',name:'새로운 캠페인',product:products[0].id,audience:'consumer',status:'초안',channels:channels.map(c=>c.id),titles:['새로운 가능성,\n우리의 이야기.','고객의 일상에\n더하는 가치.','상품의 특징을\n명확하게.','나에게 맞는\n선택을 찾아요.',data.brand.name+'\n지금 만나보세요.'],caption:'',template:'yellow',designMode:'creative',textProvider:'OpenAI',imageProvider:'OpenAI',videoProvider:'Google'};
}
campaign=()=>data.campaigns.find(c=>c.id===current)||data.campaigns[0]||draftFallback();
prod=()=>{
  const c=campaign(),a=[...products,...data.uploads].find(p=>p.id===(c.assetId||c.product))||products[0];
  return {...a,img:assetSource(a)};
};
persist=function() {
  if(storageWarning){toast('기존 저장 데이터를 보호하기 위해 저장을 중단했습니다. 브라우저 저장 데이터를 확인해 주세요.');return false;}
  try {
    works.settings={...works.settings,budget:data.budget,retries:data.retries};
    const i=works.workspaces.findIndex(w=>w.id===data.id); if(i>=0)works.workspaces[i]=data;
    localStorage.setItem(WORKS_KEY,JSON.stringify(works));return true;
  }catch{toast('브라우저 저장 공간이 부족합니다. 변경 내용을 저장하지 못했습니다.');return false;}
};
if(!storageWarning)persist();
const genericNames=['브랜드 시그니처','내추럴 세이지','클린 아이보리','볼드 타이포','상품 포커스','브랜드 포스트카드','소프트 컬렉션','시즌 스포트라이트','서비스 가이드'];
allTemplates=()=>[...baseTemplates.map((t,i)=>isPie()?t:({...t,name:genericNames[i],subtitle:i===3?data.brand.cta||'지금, 자세히 알아보세요.':'우리 브랜드의 가치를 전합니다.',...(i===0?{bg:data.brand.color,ink:'#262438',accent:'#ffffff'}:{})})),...data.templates];
allAssets=()=>[
  ...data.catalog.filter(p=>!p.placeholder).map(p=>({...p,role:'product',menu:p.name,tags:'실제 제품 사진',type:'제품 원본'})),
  ...(isPie()?[{id:'lifestyle',name:'애플파이와 라떼',img:'assets/lifestyle.webp',role:'reference',type:'생성 연출 이미지',tags:'분위기 참고'}]:[]),
  ...data.uploads.map(a=>({...a,role:a.role||'reference'}))
];
function switchWorkspace(id,next='workspace') {
  const target=works.workspaces.find(w=>w.id===id); if(!target)return;
  if(!persist())return;
  stopVideo();closeModal();data=target;works.activeId=id;activateCatalog();
  current=data.campaigns[0]?.id||null;channel='instagram';cardIndex=sceneIndex=playTime=0;
  filter='all';templateFilter='전체';templateSearch='';assetFilter='all';templateDraft=null;
  persist();navigate(next);restoreAssets();
}
const workspaceNav=[['workspace','grid','상품 대시보드'],['studio','spark','콘텐츠 제작'],['campaigns','folder','캠페인'],['assets','image','브랜드 자료실'],['templates','layers','디자인 템플릿'],['publish','upload','게시 관리'],['brand','leaf','브랜드 · 채널 설정']];
shell=function(content) {
  const global=['dashboard','products','settings'].includes(route), title=({dashboard:'전체 대시보드',products:'상품 · 브랜드',settings:'API 및 사용 설정'}[route])||workspaceNav.find(n=>n[0]===route)?.[2]||'후니웍스';
  return `<div class="mobile-overlay ${mobileOpen?'show':''}" data-act="menu-close"></div><aside class="sidebar ${mobileOpen?'open':''}"><a href="#dashboard" class="brandmark hw-brandmark"><span class="hw-logo">h<span>w</span><i></i></span><div><div class="studio">hooniworks<span class="brand-period">.</span></div><div class="byline">후니웍스 · CONTENT SUITE</div></div></a><div class="nav-label hw-first-label">HOONIWORKS</div><nav class="nav">${[['dashboard','grid','전체 대시보드'],['products','layers','상품 · 브랜드']].map(([r,i,n])=>`<button data-route="${r}" class="${route===r?'active':''}">${icon(i)}${n}${r==='products'?`<span class="nav-count">${works.workspaces.length}</span>`:''}</button>`).join('')}</nav><div class="divider"></div><div class="nav-label">CURRENT WORKSPACE</div><button class="brand-selector" data-act="brand-switch" aria-label="상품 워크스페이스 전환"><span class="brand-avatar" style="background:${data.brand.color}22;color:#37333f">${isPie()?'120':esc(initialMark(data.brand.name))}</span><span class="grow"><strong>${esc(data.brand.name)}</strong><small>${esc(data.brand.category)}</small></span>${icon('down')}</button><nav class="nav workspace-nav">${workspaceNav.map(([r,i,n])=>`<button data-route="${r}" class="${route===r?'active':''}">${icon(i)}${n}${r==='campaigns'?`<span class="nav-count">${data.campaigns.length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button data-route="settings" class="${route==='settings'?'active':''}">${icon('settings')}API 및 사용 설정</button></nav><div class="profile"><span class="avatar">JH</span><div class="grow"><strong>후니의 워크스페이스</strong><small>브라우저에 작업 저장</small></div><button class="icon-btn" data-act="help" aria-label="후니웍스 사용 안내">${icon('help')}</button></div></div></aside><main class="main"><header class="topbar"><div class="flex crumb"><button class="icon-btn mobile-menu" data-act="menu" aria-label="메뉴 열기">${icon('menu')}</button><span>${global?'후니웍스':esc(data.brand.name)}</span>${icon('chevron')}<strong>${title}</strong></div><div class="flex top-actions"><span class="preview">${global?'멀티 브랜드 콘텐츠 작업실':'현재 상품에만 저장'}</span><span class="badge outline"><i class="dot"></i>API 미연결</span><button class="icon-btn" data-act="help" aria-label="도움말">${icon('help')}</button></div></header><div class="page">${!global?`<div class="workspace-context"><span class="context-dot" style="background:${data.brand.color}"></span><strong>${esc(data.brand.name)}</strong><span>상품 워크스페이스</span><button data-act="brand-switch">상품 전환 ${icon('down')}</button></div>`:''}${storageWarning?`<div class="notice">${esc(storageWarning)}</div>`:''}${content}<footer class="footnote"><span>HOONIWORKS · IDEAS INTO CONTENT</span><span>브라우저 저장 · 생성 API / 자동 게시 미연결</span></footer></div></main>`;
};
function statsHTML(items) {return `<div class="stats hw-stats">${items.map(([n,label,sub,ic])=>`<div class="stat"><div><div class="stat-label">${label}</div><div class="stat-value">${n}</div><p class="stat-detail">${sub}</p></div><span class="stat-icon">${icon(ic)}</span></div>`).join('')}</div>`;}
function productTile(w) {
  const isFirst=w.id===PIE_ID, review=w.campaigns.filter(c=>c.status==='검토 대기').length;
  return `<article class="product-tile" style="--product-color:${w.brand.color}"><div class="product-tile-visual ${isFirst?'pie-tile':''}"><div class="product-tile-top"><span class="badge">${esc(w.brand.category)}</span><span class="tile-number">${String(works.workspaces.indexOf(w)+1).padStart(2,'0')}</span></div><strong class="product-tile-name">${esc(w.brand.name)}</strong><span class="product-visual-caption">${isFirst?'120겹의 이야기, 더 많은 채널로.':'새로운 상품, 새로운 이야기.'}</span>${isFirst?'<img src="assets/apple.webp" alt="120pie 애플파이">':`<span class="abstract-initial" aria-hidden="true">${esc(initialMark(w.brand.name))}</span>`}</div><div class="product-tile-body"><p>${esc(w.brand.description||'브랜드 기준과 자료를 등록하고 첫 콘텐츠를 준비하세요.')}</p><div class="product-tile-counts"><span>캠페인 <b>${w.campaigns.length}</b></span><span>검토 대기 <b>${review}</b></span><span>채널 주소 <b>${Object.entries(w.brand.links).filter(([k,v])=>k!=='website'&&v).length}</b></span></div><button class="btn full" data-workspace="${w.id}">워크스페이스 열기 ${icon('arrow')}</button></div></article>`;
}
function addTile() {return `<button class="add-product-tile" data-act="product-new"><span class="add-orb">${icon('plus')}</span><strong>다음 상품을 시작하세요</strong><p>식품, 서비스, 멤버십까지.<br>상품마다 독립된 작업 공간을 만드세요.</p><span class="add-link">새 상품 · 브랜드 추가 ${icon('arrow')}</span></button>`;}
dashboard=function() {
  const all=works.workspaces.flatMap(w=>w.campaigns.map(c=>({c,w}))),pending=all.filter(({c})=>c.status==='검토 대기').length;
  return `${pageHead('아이디어는 자유롭게. 마케팅은 한곳에서.','여러 상품의 이야기를 만들고, 각각의 채널로 연결하세요.',`<button class="btn primary" data-act="product-new">${icon('plus')}상품 추가</button>`,'YOUR MARKETING CONTENT SUITE')}<section class="hw-hero"><div><span class="eyebrow">MANY BRANDS. ONE WORKSPACE.</span><h2>상품은 늘어나도,<br>콘텐츠의 시작은 <em>후니웍스.</em></h2><p>브랜드를 이해하는 기획부터 이미지와 영상,<br>채널별 게시 준비까지 이어지는 마케팅 작업실.</p><button class="btn dark" data-workspace="${data.id}" data-next="studio">${esc(data.brand.name)} 콘텐츠 만들기 ${icon('arrow')}</button><span class="hero-detail">현재 선택한 상품으로 시작</span></div><div class="hw-hero-art" aria-hidden="true"><span class="art-orbit orbit-one"></span><span class="art-orbit orbit-two"></span><div class="suite-center">h<span>w</span><i></i></div><span class="floating-service service-plan">${icon('spark')}기획 & 카피</span><span class="floating-service service-image">${icon('image')}이미지 디자인</span><span class="floating-service service-video">${icon('video')}숏폼 스토리</span><span class="floating-service service-publish">${icon('upload')}채널별 게시</span><span class="art-caption">YOUR NEXT GOOD IDEA STARTS HERE</span></div></section>${statsHTML([[works.workspaces.length,'운영 상품·브랜드','상품별 독립 워크스페이스','layers'],[all.length,'전체 캠페인','샘플 · 내 초안 포함','folder'],[pending,'검토 대기','문구와 디자인 확인','clock'],[works.workspaces.reduce((n,w)=>n+w.posts.length,0),'게시 준비·기록','수동 기록 포함 · 외부 자동 전송 없음','upload']])}<div class="section-title"><div><h2>우리의 상품, 각자의 이야기</h2><p>브랜드 설정부터 자료와 콘텐츠까지, 상품별로 이어서 작업하세요.</p></div><button class="btn ghost sm" data-route="products">전체 상품 ${icon('arrow')}</button></div><div class="product-grid">${works.workspaces.slice(0,3).map(productTile).join('')}${addTile()}</div><section class="hw-process"><div><span class="eyebrow">FROM IDEA TO CHANNEL</span><h2>하나의 흐름으로 완성하는 콘텐츠</h2></div><div class="process-steps">${[['01','브랜드 이해','상품 정보 · 실제 사진'],['02','콘텐츠 기획','고객 · 목적 · 콘셉트'],['03','콘텐츠 제작','이미지 · 카피 · 장면표'],['04','게시 준비','채널별 검토 · 내보내기']].map(([n,t,s])=>`<div><span>${n}</span><strong>${t}</strong><small>${s}</small></div>`).join('')}</div></section>${all.length?`<div class="section-title"><div><h2>이어서 작업하기</h2><p>상품을 확인하고 캠페인을 열어보세요.</p></div><span class="badge outline">샘플 포함</span></div><div class="recent-work-list">${all.slice(0,5).map(({c,w})=>`<button data-workspace="${w.id}" data-campaign-id="${c.id}" class="recent-work"><span class="recent-work-icon" style="background:${w.brand.color}22">${icon('folder')}</span><span class="grow"><small>${esc(w.brand.name)}</small><strong>${esc(c.name)}</strong></span><span class="badge ${c.status==='검토 대기'?'yellow':''}">${esc(c.status)}</span>${icon('chevron')}</button>`).join('')}</div>`:''}`;
};
function productsPage() {
  return `${pageHead('상품 · 브랜드','상품마다 다른 고객, 다른 이야기. 독립된 작업 공간에서 관리하세요.',`<button class="btn primary" data-act="product-new">${icon('plus')}상품 추가</button>`,'BRAND PORTFOLIO')}<div class="portfolio-toolbar"><span><b>${works.workspaces.length}</b>개의 상품 워크스페이스</span><div class="search-box">${icon('search')}<input id="workspace-search" type="search" aria-label="상품·브랜드 검색" placeholder="상품·브랜드 이름 검색"></div></div><div class="product-grid" id="product-results">${works.workspaces.map(productTile).join('')}${addTile()}</div><div class="notice" style="margin-top:24px">${icon('layers')}캠페인, 이미지, 내 템플릿, 채널 계정과 게시 기록은 각 상품에 따로 저장됩니다. 생성 엔진과 사용 한도는 후니웍스 공통 설정에서 관리합니다.</div>`;
}
function emptyCampaignView(title='콘텐츠 제작실') {
  return `${pageHead(title,esc(data.brand.name)+'의 첫 이야기를 시작해 보세요.')}<section class="hw-empty panel"><span class="empty-orb">${icon('spark')}</span><span class="eyebrow">A FRESH START</span><h2>이 상품의 첫 캠페인을 만들어보세요.</h2><p>누구에게, 무엇을 전할지 정하면<br>상품별로 이미지·게시글·숏폼 장면표를 준비할 수 있어요.</p><button class="btn primary" data-act="new">${icon('plus')}첫 캠페인 만들기</button><button class="btn ghost" data-route="assets">제품 사진 먼저 추가하기 ${icon('arrow')}</button></section>`;
}
function workspacePage() {
  return `${pageHead(esc(data.brand.name),esc(data.brand.description||'브랜드의 첫 콘텐츠를 준비하세요.'),`<button class="btn primary" data-act="new">${icon('plus')}새 캠페인</button>`,esc(data.brand.category)+' WORKSPACE')}<section class="workspace-welcome" style="--product-color:${data.brand.color}"><div><span class="eyebrow">YOUR BRAND. YOUR STORY.</span><h2>이 상품만의 이야기를<br>다양한 콘텐츠로 만들어보세요.</h2><p>${esc(data.brand.audience||'브랜드 설정에서 주요 고객을 정해보세요.')}</p><div class="flex"><button class="btn dark" data-act="new">콘텐츠 기획 시작 ${icon('arrow')}</button><button class="btn" data-route="brand">브랜드 설정</button></div></div>${isPie()?'<img src="assets/apple.webp" alt="애플파이 제품 원본">':`<span class="workspace-monogram" aria-hidden="true">${esc(initialMark(data.brand.name))}</span>`}</section>${statsHTML([[data.campaigns.length,'캠페인','샘플 · 내 초안 포함','folder'],[allAssets().length,'브랜드 자료','제품 · 참고 · 로고','image'],[data.campaigns.filter(c=>c.status==='검토 대기').length,'검토 대기','제품과 문구 확인','clock'],[data.posts.length,'게시 준비·기록','현재 상품 기준','upload']])}<div class="section-title"><div><h2>작업 중인 캠페인</h2><p>현재 상품의 콘텐츠만 표시합니다.</p></div><button class="btn ghost sm" data-route="campaigns">전체 보기 ${icon('arrow')}</button></div>${data.campaigns.length?`<div class="campaign-grid">${data.campaigns.slice(0,3).map(campaignCard).join('')}</div>`:'<div class="empty panel">아직 캠페인이 없어요. 새 캠페인으로 첫 콘텐츠를 준비하세요.</div>'}<div class="workspace-shortcuts">${[['assets','image','브랜드 자료실','실제 사진·참고 이미지 등록'],['brand','leaf','브랜드 · 채널','브랜드 기준과 채널 주소 설정'],['templates','layers','디자인 컬렉션','새 콘셉트와 함께 활용할 디자인']].map(([r,i,t,s])=>`<button class="panel" data-route="${r}">${icon(i)}<strong>${t}</strong><small>${s}</small>${icon('arrow')}</button>`).join('')}</div>`;
}
campaignCard=function(c,i) {
  const a=allAssets().find(p=>p.id===(c.assetId||c.product))||products.find(p=>p.id===c.product)||products[0];
  return `<button class="campaign-card" data-open="${c.id}"><div class="campaign-cover ${i%3===1?'mint':i%3===2?'cream':''}"><span class="cover-brand">${esc(data.brand.name)}</span><h3>${esc(c.titles[0]).replace(/\n/g,'<br>')}</h3><img src="${assetSource(a)}" alt="${esc(a.name)}"><span class="cover-caption">${esc(c.goal||'상품·브랜드 소개')}</span></div><div class="campaign-meta"><div class="flex between"><span class="badge ${c.status==='검토 대기'?'yellow':c.status==='승인 완료'?'green':''}">${esc(c.status)}</span><span class="sample-tag">${c.updated==='샘플 캠페인'?'SAMPLE':'내 초안'}</span></div><h3>${esc(c.name)}</h3><div class="details"><span>${c.audience==='business'?'사업자·파트너':'일반 고객'} · ${c.channels.length}개 채널</span>${channelDots(c.channels)}</div></div></button>`;
};
function openWorkspacePicker() {
  openModal('상품 워크스페이스 전환',`<p class="intro">선택한 상품의 자료와 캠페인으로 이동합니다.</p><div class="workspace-picker">${works.workspaces.map(w=>`<button data-workspace="${w.id}" class="${w.id===data.id?'selected':''}"><span class="brand-avatar" style="background:${w.brand.color}33">${w.id===PIE_ID?'120':esc(initialMark(w.brand.name))}</span><span class="grow"><strong>${esc(w.brand.name)}</strong><small>${esc(w.brand.category)} · 캠페인 ${w.campaigns.length}개</small></span>${icon(w.id===data.id?'check':'chevron')}</button>`).join('')}</div>`,`<button class="btn ghost" data-route="products">모든 상품 보기</button><button class="btn primary" data-act="product-new">${icon('plus')}상품 추가</button>`);
}
function openNewProduct() {
  openModal('새 상품 · 브랜드 추가',`<p class="intro">상품을 하나 추가하면 전용 콘텐츠 작업실이 만들어집니다.<br>브랜드 자료와 채널 계정을 따로 관리할 수 있어요.</p><div class="field"><label for="workspace-name">상품·브랜드 이름 <span class="required">*</span></label><input type="text" id="workspace-name" maxlength="60" placeholder="예: 새 브랜드 또는 서비스 이름"></div><div class="brand-form-grid"><div class="field"><label for="workspace-category">상품 분류</label><select id="workspace-category">${['식음료·카페','생활·가전','케어·건강','멤버십·구독','교육·콘텐츠','기타'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field"><label for="workspace-color">브랜드 포인트 색상</label><input type="color" id="workspace-color" value="#7661dc"></div></div><div class="field"><label for="workspace-audience">주요 고객</label><input type="text" id="workspace-audience" maxlength="120" placeholder="어떤 고객에게 소개할 상품인가요?"></div><div class="field"><label for="workspace-description">상품 한 줄 소개</label><textarea id="workspace-description" maxlength="300" placeholder="어떤 가치를 제공하는 상품인지 적어주세요."></textarea></div><p class="hint">입력한 정보는 브랜드 설정에서 언제든 수정할 수 있어요.</p>`,`<button class="btn" data-act="close-modal">취소</button><button class="btn primary" data-act="product-create">워크스페이스 만들기 ${icon('arrow')}</button>`);
}
function createProduct() {
  const name=$('#workspace-name').value.trim();if(!name){toast('상품·브랜드 이름을 입력해 주세요.');$('#workspace-name').focus();return;}
  if(works.workspaces.some(w=>w.brand.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('같은 이름의 상품이 이미 있습니다. 구분할 수 있는 이름을 입력해 주세요.');return;}
  const w=normalizeWorkspace({id:'brand-'+localId(),createdAt:new Date().toISOString(),brand:{name,category:$('#workspace-category').value,color:$('#workspace-color').value,audience:$('#workspace-audience').value.trim(),description:$('#workspace-description').value.trim(),tone:'명확하고 친근하게, 확인된 상품 정보 중심으로',cta:'자세히 알아보기'},budget:works.settings.budget,retries:works.settings.retries});
  works.workspaces.push(w);if(!persist()){works.workspaces.pop();return;}
  switchWorkspace(w.id);toast(name+' 워크스페이스를 만들었어요.');
}
newWizard=function() {wizardStep=1;wizardDraft={name:'',audience:'consumer',topic:'',channels:channels.map(c=>c.id),designMode:'creative'};drawWizard();};
drawWizard=function() {
  const step=`<div class="steps"><span class="${wizardStep===1?'active':''}"><b>1</b>캠페인 기획</span><i></i><span class="${wizardStep===2?'active':''}"><b>2</b>채널 · 디자인</span></div><div class="wizard-workspace">${icon('layers')}${esc(data.brand.name)}에 저장됩니다.</div>`;
  const body=wizardStep===1?`${step}<div class="field"><label for="new-name">캠페인 이름</label><input id="new-name" type="text" maxlength="60" placeholder="예: 대표 상품의 새로운 매력 소개" value="${esc(wizardDraft.name)}"></div><div class="field"><label for="new-audience">주요 고객</label><select id="new-audience"><option value="consumer" ${wizardDraft.audience==='consumer'?'selected':''}>일반 고객 · 상품과 서비스 소개</option><option value="business" ${wizardDraft.audience==='business'?'selected':''}>사업자·파트너 · 도입 및 제휴 상담</option></select><p class="hint">브랜드 주요 고객: ${esc(data.brand.audience||'아직 등록하지 않았어요.')}</p></div><div class="field"><label for="new-topic">콘텐츠 주제 · 전달할 메시지</label><textarea id="new-topic" maxlength="600" placeholder="고객에게 전할 상품의 특징과 핵심 메시지">${esc(wizardDraft.topic)}</textarea></div>`:`${step}<div class="field"><label>제작할 채널</label><div class="channel-checks">${channels.map(c=>`<button class="${wizardDraft.channels.includes(c.id)?'active':''}" data-wizard-channel="${c.id}">${icon(c.icon)}${c.name}</button>`).join('')}</div></div><div class="field"><label for="new-design-mode">디자인 출발점</label><select id="new-design-mode"><option value="creative">새 콘셉트 기획 · 템플릿 선택 없이 시작</option><option value="reference">레퍼런스 활용 · 분위기를 참고해 기획</option><option value="template">저장된 템플릿 활용 · 일관된 디자인</option></select></div><div class="field"><label for="new-product">소개할 제품·서비스</label><select id="new-product">${products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div class="notice">${icon('spark')}지금은 브리프 저장과 편집 미리보기를 제공합니다. 새 콘셉트의 자동 디자인 생성은 생성 API 연결 후 사용할 수 있어요.</div>`;
  openModal('새 캠페인 만들기',body,`<button class="btn ghost" data-act="${wizardStep===1?'close-modal':'wizard-back'}">${wizardStep===1?'취소':'이전'}</button><button class="btn primary" data-act="${wizardStep===1?'wizard-next':'works-campaign-create'}">${wizardStep===1?'다음 단계':'캠페인 만들기'} ${icon('arrow')}</button>`);
};
function createCampaign() {
  if(!wizardDraft.channels.length){toast('최소 한 개의 채널을 선택해 주세요.');return;}
  const c={...draftFallback(),id:'campaign-'+localId(),workspaceId:data.id,name:wizardDraft.name,audience:wizardDraft.audience,topic:wizardDraft.topic,product:$('#new-product').value,channels:[...wizardDraft.channels],designMode:$('#new-design-mode').value,updated:'내 초안',goal:wizardDraft.audience==='business'?'도입·제휴 상담':'상품·서비스 홍보'};
  c.titles=[wizardDraft.name,'어떤 상품인가요?','주요 특징을 알려주세요.','고객에게 어떤 가치가 있나요?',data.brand.cta||'자세히 알아보기'];
  c.caption=[wizardDraft.topic||data.brand.description,data.brand.name,data.brand.cta].filter(Boolean).join('\n\n');
  c.scenes=[wizardDraft.name,'고객에게 필요한 이유','핵심 특징과 사용 장면',data.brand.cta||'자세히 알아보기'];
  data.campaigns.unshift(c);if(!persist()){data.campaigns.shift();return;}
  current=c.id;channel=c.channels[0];cardIndex=0;navigate('studio');toast('기획 브리프를 저장했어요. 문구와 자료를 채워보세요.');
}
const workingStudio=studio;
studio=function() {
  if(!data.campaigns.length)return emptyCampaignView();
  let html=workingStudio(),c=campaign();
  const mode=c.designMode||'template';
  const modes=`<div class="field design-mode-field"><label for="design-mode">디자인 출발점</label><select id="design-mode"><option value="creative" ${mode==='creative'?'selected':''}>새 콘셉트 기획</option><option value="reference" ${mode==='reference'?'selected':''}>레퍼런스 활용</option><option value="template" ${mode==='template'?'selected':''}>저장된 템플릿 활용</option></select><p class="hint">${mode==='template'?'저장한 레이아웃으로 편집합니다.':'템플릿에 제한받지 않는 기획 방향입니다. 현재 화면은 편집용 구성 예시이며, 자동 디자인 생성은 API 연결 후 제공됩니다.'}</p></div>`;
  html=html.replace('<div class="field"><label for="creation-template">디자인 스타일</label>',modes+'<div class="field"><label for="creation-template">'+(mode==='template'?'디자인 템플릿':'편집 미리보기 레이아웃')+'</label>');
  html=html.replace('미리보기 생성</button>',(mode==='template'?'편집 미리보기 확인':'기획 브리프 저장')+'</button>');
  html=html.replace('<div class="product-picks">',`<input type="text" aria-label="소개할 제품·서비스 이름" data-field="productName" placeholder="제품·서비스 이름" value="${esc(c.productName||products.find(p=>p.id===c.product)?.name||data.brand.name)}"><div class="product-picks" style="margin-top:10px">`);
  html=html.replace('제품 원본 사용</span>',`${prod().placeholder?'제품 사진 미등록':'제품 원본 사용'}</span>`);
  return html;
};
sceneTexts=()=>campaign().scenes||[campaign().titles[0],campaign().titles[1],campaign().titles[2],campaign().titles[4]];
videoPreview=function() {
  return `<div class="video-wrap"><div class="phone ${playTimer?'playing':''}"><img id="video-image" src="${prod().img}" style="object-fit:contain" alt="선택한 상품 이미지로 보는 장면표"><span class="phone-logo">${esc(data.brand.name)}</span><button class="play-btn" data-act="play" aria-label="${playTimer?'미리보기 일시정지':'장면표 미리보기 재생'}">${icon(playTimer?'pause':'play')}</button><div class="phone-caption">${esc(sceneTexts()[sceneIndex])}</div><div class="video-time"><span id="video-time">00:${String(playTime).padStart(2,'0')}</span><div class="progress-track"><div class="progress-fill" style="width:${playTime*5}%"></div></div><span>00:20</span></div></div><div class="scene-list">${['관심을 끄는 시작','상품·서비스 소개','주요 특징과 가치','행동으로 연결'].map((t,i)=>`<button class="scene ${sceneIndex===i?'active':''}" data-scene="${i}"><span class="scene-no">0${i+1}</span><div><strong>${t}</strong><small>${['0–3초','3–8초','8–15초','15–20초'][i]}</small></div></button>`).join('')}</div></div>`;
};
blogPreview=function(){return `<article class="blog-preview"><span class="blog-name">${esc(data.brand.name)} · 브랜드 이야기</span><h2 id="blog-heading">${esc(campaign().name)}</h2><img src="${prod().img}" alt="${esc(prod().name)}"><p id="blog-text">${esc(captionFor('blog')).replace(/\n/g,'<br>')}</p></article>`;};
const baseBrandPage=brandPage;
brandPage=function(){return baseBrandPage().replace('<div class="brand-form-grid">',`<div class="brand-form-grid"><div class="field"><label for="brand-category">상품 분류</label><input id="brand-category" type="text" maxlength="40" value="${esc(data.brand.category)}"></div><div class="field"><label for="brand-color">브랜드 포인트 색상</label><input id="brand-color" type="color" value="${data.brand.color}"></div><div class="field wide"><label for="brand-audience">주요 고객</label><input id="brand-audience" type="text" maxlength="120" value="${esc(data.brand.audience)}"></div>`);};
saveBrandAll=function(){
  const name=$('#brand-name').value.trim();
  if(!name){toast('브랜드 이름을 입력해 주세요.');return;}
  if(works.workspaces.some(w=>w.id!==data.id&&w.brand.name.toLocaleLowerCase()===name.toLocaleLowerCase())){toast('다른 상품과 구분할 수 있는 이름을 입력해 주세요.');return;}
  try {
    const links={website:linkSafe($('#brand-website').value)},accounts={};
    for(const c of profileChannels){links[c.id]=linkSafe($('#link-'+c.id).value,c.id);accounts[c.id]=$('#account-'+c.id).value.trim();}
    const previous=data.brand;
    data.brand={...data.brand,name,category:$('#brand-category').value.trim()||'기타',color:validColor($('#brand-color').value),audience:$('#brand-audience').value.trim(),tone:$('#brand-tone').value,description:$('#brand-description').value,cta:$('#brand-cta').value,links,accounts};
    if(!persist()){data.brand=previous;return;}
    activateCatalog();render();toast('이 상품의 브랜드와 채널 주소를 저장했어요.');
  }catch(err){toast(err.message);}
};
const baseSettingsPage=settingsPage;
settingsPage=function(){return baseSettingsPage().replace('API 및 사용량','API 및 사용 설정').replace('제작에 필요한 엔진과 사용 한도를 관리하세요.','모든 상품에서 공통으로 사용할 제작 엔진과 사용 한도를 관리하세요.').replace('시연 데이터 초기화','현재 상품 초기화').replace('브라우저 시연 데이터','현재 상품 작업 데이터').replace('샘플 캠페인, 수정한 문구, 업로드한 이미지와 설정을 관리합니다.',esc(data.brand.name)+'의 캠페인·자료·내 템플릿·게시 기록을 관리합니다. 브랜드 설정과 다른 상품은 유지됩니다.');};
const baseTemplatesPage=templatesPage;
templatesPage=function(){return baseTemplatesPage().replace('좋은 디자인은 쌓아두고, 새로운 이야기에 다시 꺼내 쓰세요.','템플릿은 제작 방식 중 하나예요. 새 콘셉트 기획과 레퍼런스 활용도 선택할 수 있어요.').replace('매번 새롭게, 언제나 우리답게.','템플릿은 출발점. 가능성은 더 넓게.');};
const basePublishPage=publishPage;
publishPage=function(){return data.campaigns.length?basePublishPage():emptyCampaignView('게시 관리');};
generatePreview=function(){persist();fillCanvases();toast(campaign().designMode==='template'?'편집 미리보기를 확인해 주세요.':'기획 브리프를 저장했어요. 새 디자인 자동 생성은 API 연결 후 가능합니다.');};
render=function(){
  const pages={dashboard,products:productsPage,workspace:workspacePage,studio,campaigns:campaignsPage,assets:assetsPage,templates:templatesPage,settings:settingsPage,brand:brandPage,publish:publishPage};
  if(!pages[route])route='dashboard';
  $('#app').innerHTML=shell(pages[route]());fillCanvases();
};
function resetCurrentWorkspace() {
  const old=data, fresh=normalizeWorkspace({id:data.id,createdAt:data.createdAt,brand:structuredClone(data.brand),catalog:structuredClone(data.catalog),budget:data.budget,retries:data.retries});
  data=fresh;if(!persist()){data=old;return;}current=null;navigate('workspace');toast('현재 상품의 작업 데이터를 초기화했어요. 브랜드 설정은 유지됩니다.');
}
// Window capture owns workspace actions before the retained editor handlers run.
window.addEventListener('click',e=>{
  const el=e.target.closest('button,[data-act]');if(!el)return;let handled=true,a=el.dataset.act;
  if(el.dataset.workspace){switchWorkspace(el.dataset.workspace,el.dataset.next||'workspace');if(el.dataset.campaignId){current=el.dataset.campaignId;channel=campaign().channels[0]||'instagram';navigate('studio');}}
  else if(a==='brand-switch')openWorkspacePicker();
  else if(a==='product-new')openNewProduct();
  else if(a==='product-create')createProduct();
  else if(a==='works-campaign-create')createCampaign();
  else if(!data.campaigns.length&&(el.dataset.useTemplate||el.dataset.assetUse)){newWizard();toast('먼저 이 상품의 캠페인을 만들어 주세요.');}
  else if(el.dataset.useTemplate){campaign().designMode='template';handled=false;}
  else if(a==='shorten'){
    const c=campaign(),shorten=t=>{const line=t.split('\n')[0];return line.length>22?line.slice(0,22)+'…':line;};
    if(['youtube','reels'].includes(channel)){c.scenes=[...sceneTexts()];c.scenes[sceneIndex]=shorten(c.scenes[sceneIndex]);}else if(channel==='blog')c.name=shorten(c.name);else c.titles[cardIndex]=shorten(c.titles[cardIndex]);invalidate();render();toast('현재 문구를 짧게 정리했어요. 의미가 유지됐는지 확인해 주세요.');
  }
  else if(a==='reset')openModal('현재 상품의 작업을 초기화할까요?',`<p class="intro"><strong>${esc(data.brand.name)}</strong>의 캠페인, 업로드 자료 목록, 내 템플릿과 게시 기록을 지웁니다. 브랜드·채널 설정, 기본 자료와 다른 상품은 유지됩니다.</p>`,`<button class="btn" data-act="close-modal">취소</button><button class="btn primary" data-act="works-confirm-reset">현재 상품 초기화</button>`);
  else if(a==='works-confirm-reset')resetCurrentWorkspace();
  else if(a==='help')openModal('후니웍스 사용 안내',`<p class="intro">여러 상품의 마케팅 콘텐츠를 한곳에서 관리하세요.</p>${[['01','상품 추가','상품·브랜드마다 독립된 작업실을 만듭니다.'],['02','브랜드 준비','제품 사진, 브랜드 기준과 채널 주소를 등록합니다.'],['03','콘텐츠 제작','새 콘셉트 · 레퍼런스 · 템플릿 중 출발점을 선택합니다.'],['04','게시 준비','채널별 문구를 검토하고 이미지·본문을 내보냅니다.']].map(([n,t,s])=>`<div class="task-row"><span class="badge">${n}</span><div><strong>${t}</strong><small>${s}</small></div></div>`).join('')}<div class="notice" style="margin-top:20px">현재는 이 브라우저에 작업을 저장합니다. 실제 자동 생성, MP4 제작, 계정 인증과 자동 게시는 아직 연결되지 않았습니다.</div>`);
  else handled=false;
  if(handled){e.preventDefault();e.stopImmediatePropagation();}
},true);
document.addEventListener('input',e=>{if(e.target.id==='workspace-search'){const q=e.target.value.toLocaleLowerCase();$('#product-results').innerHTML=works.workspaces.filter(w=>(w.brand.name+' '+w.brand.category).toLocaleLowerCase().includes(q)).map(productTile).join('')||'<div class="empty panel">검색한 상품이 없습니다.</div>';}});
document.addEventListener('change',e=>{if(e.target.id==='design-mode'){campaign().designMode=e.target.value;invalidate();render();}});
render();restoreAssets();
if(storageWarning)toast(storageWarning);

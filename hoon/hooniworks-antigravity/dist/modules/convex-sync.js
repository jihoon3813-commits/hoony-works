/* HooniWorks Module: Convex Cloud Dual Deployment Sync Bridge
 * - Development (311): zealous-ferret-311 (https://zealous-ferret-311.convex.cloud)
 * - Production (248):  bold-labrador-248  (https://bold-labrador-248.convex.cloud)
 * Strictly isolates development test data to dev (311) and production live data to prod (248).
 */

const CONVEX_DEPLOYMENTS = {
  dev: {
    id: "zealous-ferret-311",
    name: "개발 서버 (zealous-ferret-311)",
    shortName: "개발(311)",
    url: "https://zealous-ferret-311.convex.cloud",
    dashboardUrl: "https://dashboard.convex.dev/t/jihoon3813/37-hoony-works/zealous-ferret-311",
    description: "로컬 개발(localhost/127.0.0.1) 및 Vercel 프리뷰 테스트 전용"
  },
  prod: {
    id: "bold-labrador-248",
    name: "운영 서버 (bold-labrador-248)",
    shortName: "운영(248)",
    url: "https://bold-labrador-248.convex.cloud",
    dashboardUrl: "https://dashboard.convex.dev/t/jihoon3813/37-hoony-works/bold-labrador-248",
    description: "공식 운영 배포(hoony-works.vercel.app) 실서비스 전용"
  }
};

function detectCurrentSiteEnv() {
  if (typeof window === "undefined" || !window.location) return "dev";
  const host = (window.location.hostname || window.location.host || "localhost").toLowerCase();
  // 1. Production domain: exact match for official production URL
  if (host === "hoony-works.vercel.app") {
    return "prod";
  }
  // 2. Development: localhost, 127.0.0.1, or Vercel preview/branch deployments
  return "dev";
}

const hwConvex = {
  modeKey: "hooniworks-convex-mode", // 'auto' | 'dev' | 'prod' | 'custom'
  customUrlKey: "hooniworks-convex-custom-url",

  getMode() {
    return localStorage.getItem(this.modeKey) || "auto";
  },

  setMode(mode, customUrl = "") {
    localStorage.setItem(this.modeKey, mode);
    if (customUrl) {
      localStorage.setItem(this.customUrlKey, customUrl.trim().replace(/\/$/, ""));
    }
  },

  getDetectedEnv() {
    return detectCurrentSiteEnv();
  },

  getTargetEnv() {
    const mode = this.getMode();
    if (mode === "dev") return "dev";
    if (mode === "prod") return "prod";
    if (mode === "custom") return "custom";
    return this.getDetectedEnv(); // 'auto' resolves to detected
  },

  getUrl() {
    const target = this.getTargetEnv();
    if (target === "custom") {
      return localStorage.getItem(this.customUrlKey) || "";
    }
    return CONVEX_DEPLOYMENTS[target]?.url || CONVEX_DEPLOYMENTS.dev.url;
  },

  getActiveDeployment() {
    const target = this.getTargetEnv();
    if (target === "custom") {
      return {
        id: "custom",
        name: "커스텀 서버",
        shortName: "사용자지정",
        url: this.getUrl(),
        description: "사용자가 직접 입력한 배포 URL"
      };
    }
    return CONVEX_DEPLOYMENTS[target];
  },

  isConfigured() {
    return Boolean(this.getUrl());
  },

  async call(type, functionName, args = {}) {
    const convexUrl = this.getUrl();
    if (!convexUrl) {
      throw new Error("Convex URL이 설정되지 않았습니다.");
    }
    const endpoint = `${convexUrl}/api/${type}`;
    const targetEnv = this.getTargetEnv();
    const clientHost = typeof window !== "undefined" ? window.location.host : "server";

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: functionName,
        args: {
          ...args,
          _meta: { targetEnv, clientHost }
        },
        format: "json",
      }),
    });
    const payload = await res.json();
    if (!res.ok || payload.status === "error") {
      throw new Error(payload.errorMessage || payload.error || `Convex 요청 실패 (${res.status})`);
    }
    return payload.value !== undefined ? payload.value : payload;
  },

  async syncAllToCloud(force = false) {
    const detected = this.getDetectedEnv();
    const target = this.getTargetEnv();

    // Guard: Prevent accidental push from development environment to Production (248) without explicit confirmation
    if (target === "prod" && detected === "dev" && !force) {
      const ok = confirm(
        "⚠️ [경고: 운영 서버 동기화]\n\n현재 접속 중인 환경은 '개발 사이트(localhost/프리뷰)'입니다.\n이 데이터를 '운영 서버 (bold-labrador-248)'로 백업하면 운영 데이터가 덮어써질 수 있습니다.\n\n정말 운영 서버(248)에 동기화하시겠습니까?"
      );
      if (!ok) {
        throw new Error("사용자에 의해 운영 서버 동기화가 취소되었습니다.");
      }
    }

    const allWs = works?.workspaces || [];
    const settings = hwServer?.settings || { budget: data.budget || 50000 };
    return await this.call("mutation", "workspaces:bulkSyncFromClient", {
      workspaces: allWs,
      settings,
    });
  },

  async pullWorkspaceFromCloud(workspaceId) {
    return await this.call("query", "workspaces:getFullWorkspace", { workspaceId });
  },
};

// UI Modal for Convex Dual Deployment Connection & Verification
function openConvexConfigModal() {
  const mode = hwConvex.getMode();
  const detected = hwConvex.getDetectedEnv();
  const active = hwConvex.getActiveDeployment();
  const isAuto = mode === "auto";

  const hostName = typeof window !== "undefined" ? window.location.host : "localhost";
  const detectedLabel = detected === "prod"
    ? `<span class="badge" style="background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5">공식 운영 사이트 (${esc(hostName)})</span>`
    : `<span class="badge green">개발 사이트 (${esc(hostName)})</span>`;

  openModal(
    "Convex 클라우드 배포 분리 설정",
    `<p class="intro">개발 사이트 데이터는 <strong>개발 서버(311)</strong>에, 운영 사이트 데이터는 <strong>운영 서버(248)</strong>에 분리되어 독립적으로 보관됩니다.</p>
    
    <div class="task-row" style="margin-bottom:14px;background:#faf9fd;padding:12px 14px;border-radius:10px">
      <span class="task-dot">${icon("link")}</span>
      <div class="grow">
        <strong>현재 접속 환경: ${detectedLabel}</strong>
        <small style="margin-top:3px;display:block">현재 연결된 Convex: <b>${esc(active.name)}</b> (${esc(active.url)})</small>
      </div>
      <span class="badge ${active.id === 'bold-labrador-248' ? '' : 'green'}" style="${active.id === 'bold-labrador-248' ? 'background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5' : ''}">
        ${esc(active.shortName)}
      </span>
    </div>

    <div class="field">
      <label>Convex 연결 대상 선택</label>
      <div style="display:grid;gap:8px;margin-top:8px">
        <label class="import-ws-row" style="cursor:pointer">
          <input type="radio" name="convex-mode" value="auto" ${isAuto ? "checked" : ""}>
          <div class="grow">
            <strong>자동 분기 (권장)</strong>
            <small>개발 사이트는 개발(311), 운영 사이트(hoony-works.vercel.app)는 운영(248)에 자동 연결</small>
          </div>
          <span class="badge outline">자동</span>
        </label>

        <label class="import-ws-row" style="cursor:pointer">
          <input type="radio" name="convex-mode" value="dev" ${mode === "dev" ? "checked" : ""}>
          <div class="grow">
            <strong>개발 서버 고정 (zealous-ferret-311)</strong>
            <small>${CONVEX_DEPLOYMENTS.dev.url}</small>
          </div>
          <span class="badge green">개발(311)</span>
        </label>

        <label class="import-ws-row" style="cursor:pointer">
          <input type="radio" name="convex-mode" value="prod" ${mode === "prod" ? "checked" : ""}>
          <div class="grow">
            <strong>운영 서버 고정 (bold-labrador-248)</strong>
            <small>${CONVEX_DEPLOYMENTS.prod.url}</small>
          </div>
          <span class="badge" style="background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5">운영(248)</span>
        </label>
      </div>
    </div>

    <div class="notice" style="margin-top:14px">
      ${icon("check")}개발 환경에서 운영 서버로 잘못 동기화되는 것을 방지하는 안전 가드가 적용되어 있습니다.
    </div>`,
    `<button class="btn" data-act="close-modal">닫기</button>
     <button class="btn ghost" data-act="convex-sync-push">${icon("upload")}현재 대상(${esc(active.shortName)})에 백업</button>
     <button class="btn primary" data-act="convex-save-mode">설정 저장</button>`
  );
}

// Enhance Settings Page with Convex Cloud section & Live Provider Status
if (typeof settingsPage === "function") {
  const baseSettingsForConvex = settingsPage;
  settingsPage = function () {
    let html = baseSettingsForConvex();
    const active = hwConvex.getActiveDeployment();
    const detected = hwConvex.getDetectedEnv();
    const mode = hwConvex.getMode();

    const openai = hwServer?.providers?.OpenAI || { configured: false };
    const google = hwServer?.providers?.Google || { configured: false };

    // Dynamically reflect Vercel Environment Variable connection status for OpenAI & Google
    if (openai.configured) {
      html = html.replace(
        '<h3>OpenAI</h3><p>GPT · 기획 / 글 / 이미지</p></div><span class="badge">미연결</span></div><div class="flex between" style="margin-top:17px"><span class="small muted" style="font-size:10px">등록된 API 키 없음</span>',
        `<h3>OpenAI</h3><p>GPT · 기획 / 글 / 이미지</p></div><span class="badge green">Vercel 보안 연결됨</span></div><div class="flex between" style="margin-top:17px"><span class="small muted" style="font-size:10px;color:#2ea043">Vercel 환경변수(OPENAI_API_KEY) 활성화됨</span>`
      );
    }
    if (google.configured) {
      html = html.replace(
        '<h3>Google</h3><p>Gemini · 이미지 / 영상</p></div><span class="badge">미연결</span></div><div class="flex between" style="margin-top:17px"><span class="small muted" style="font-size:10px">등록된 API 키 없음</span>',
        `<h3>Google</h3><p>Gemini · 이미지 / 영상</p></div><span class="badge green">Vercel 보안 연결됨</span></div><div class="flex between" style="margin-top:17px"><span class="small muted" style="font-size:10px;color:#2ea043">Vercel 환경변수(GOOGLE_API_KEY) 활성화됨</span>`
      );
    }

    const convexCard = `
      <section class="panel" style="margin-top:20px">
        <div class="flex between" style="flex-wrap:wrap;gap:10px">
          <div>
            <h3>Convex 클라우드 동기화 (개발 311 vs 운영 248 분리)</h3>
            <p class="settings-note" style="margin-top:4px">
              개발 환경(localhost/프리뷰)은 <b>zealous-ferret-311</b>에, 운영 사이트는 <b>bold-labrador-248</b>에 엄격히 분리되어 관리됩니다.
            </p>
          </div>
          <span class="badge ${active.id === 'bold-labrador-248' ? '' : 'green'}" style="${active.id === 'bold-labrador-248' ? 'background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5' : ''}">
            현재 대상: ${esc(active.shortName)} (${mode === 'auto' ? '자동 분기' : '수동 고정'})
          </span>
        </div>

        <div class="brand-form-grid" style="margin-top:14px">
          <div class="task-row" style="background:#f4fbf6;padding:12px 14px;border-radius:10px;border:1px solid #c9ebd4">
            <span class="badge green">개발(311)</span>
            <div class="grow">
              <strong>${esc(CONVEX_DEPLOYMENTS.dev.name)}</strong>
              <small>${esc(CONVEX_DEPLOYMENTS.dev.url)}</small>
            </div>
            ${active.id === 'zealous-ferret-311' ? '<span class="badge green">현재 활성</span>' : ''}
          </div>

          <div class="task-row" style="background:#faf8fe;padding:12px 14px;border-radius:10px;border:1px solid #e1d6f5">
            <span class="badge" style="background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5">운영(248)</span>
            <div class="grow">
              <strong>${esc(CONVEX_DEPLOYMENTS.prod.name)}</strong>
              <small>${esc(CONVEX_DEPLOYMENTS.prod.url)}</small>
            </div>
            ${active.id === 'bold-labrador-248' ? '<span class="badge" style="background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5">현재 활성</span>' : ''}
          </div>
        </div>

        <div class="flex between" style="margin-top:16px;flex-wrap:wrap;gap:10px">
          <div class="flex" style="gap:8px">
            <button class="btn sm" data-act="open-convex-modal">${icon("settings")}배포 분기 설정</button>
            <button class="btn sm ghost" data-act="convex-reset-cloud" style="color:#c53030">${icon("trash")}${esc(active.shortName)} 데이터 초기화</button>
          </div>
          <button class="btn sm primary" data-act="convex-sync-push">${icon("upload")}${esc(active.shortName)}에 지금 백업</button>
        </div>
      </section>
    `;
    if (html.includes('<div class="spacer"></div><section class="panel"><div class="flex between"><div><h3>')) {
      return html.replace(
        '<div class="spacer"></div><section class="panel"><div class="flex between"><div><h3>',
        convexCard + '<div class="spacer"></div><section class="panel"><div class="flex between"><div><h3>'
      );
    }
    return html + convexCard;
  };
}

// Enhance Shell to show active Convex deployment in topbar
if (typeof shell === "function") {
  const baseShellForConvex = shell;
  shell = function (content) {
    let html = baseShellForConvex(content);
    const active = hwConvex.getActiveDeployment();
    const isProd = active.id === "bold-labrador-248";
    const convexPill = isProd
      ? `<button class="badge" style="background:#efe9fb;color:#6e58cd;border:1px solid #d4c8f5;cursor:pointer" data-act="open-convex-modal" title="Convex 운영 서버 (bold-labrador-248) 연결됨">${icon("check")}Convex 운영(248)</button>`
      : `<button class="badge green" style="cursor:pointer" data-act="open-convex-modal" title="Convex 개발 서버 (zealous-ferret-311) 연결됨">${icon("check")}Convex 개발(311)</button>`;

    if (html.includes('<button class="btn sm ghost" data-act="open-browser-import">')) {
      return html.replace(
        '<button class="btn sm ghost" data-act="open-browser-import">',
        convexPill + '<button class="btn sm ghost" data-act="open-browser-import">'
      );
    }
    return html;
  };
}

// Event Delegation for Convex Actions
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button,[data-act]");
  if (!el) return;
  const a = el.dataset.act;

  if (a === "open-convex-modal") {
    e.preventDefault();
    e.stopImmediatePropagation();
    openConvexConfigModal();
  } else if (el.dataset.connect) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const provider = el.dataset.connect;
    const envKey = provider === "OpenAI" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY";
    const status = hwServer?.providers?.[provider] || { configured: false };
    openModal(
      `${provider} API 키 Vercel 등록 안내`,
      `<div class="notice">
        ${icon("lock")}API 키는 브라우저에 직접 입력하지 않고, Vercel 서버의 비밀 환경변수(Environment Variables)에서 안전하게 보관합니다.
      </div>
      <div class="task-row" style="margin-top:14px;background:#faf9fd;padding:12px 14px;border-radius:10px">
        <span class="task-dot">${icon(status.configured ? "check" : "link")}</span>
        <div class="grow">
          <strong>현재 연결 상태</strong>
          <small>${status.configured ? "Vercel 환경변수로 안전하게 연결됨" : "아직 등록된 API 키가 없습니다 (모의 공급자 모드)"}</small>
        </div>
        <span class="badge ${status.configured ? "green" : "outline"}">${status.configured ? "연결됨" : "미연결"}</span>
      </div>
      <div style="margin-top:16px;font-size:11px;line-height:1.8;color:#554d63">
        <strong>등록 방법 (Vercel 대시보드):</strong>
        <ol style="margin:6px 0 0 16px;padding:0">
          <li><b>Vercel 대시보드</b> 접속 → <code>hoony-works</code> 프로젝트 선택</li>
          <li>상단 <b>Settings</b> → 좌측 <b>Environment Variables</b> 메뉴 클릭</li>
          <li><b>Key</b>에 <code>${envKey}</code> 입력</li>
          <li><b>Value</b>에 발급받은 API 키 붙여넣기 후 <b>Save</b></li>
          <li>상단 <b>Deployments</b>에서 최신 배포 <b>Redeploy</b> 클릭 시 즉시 활성화됩니다.</li>
        </ol>
      </div>`,
      `<button class="btn primary" data-act="close-modal">확인</button>`
    );
  } else if (a === "convex-save-mode") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const selectedMode = document.querySelector('input[name="convex-mode"]:checked')?.value || "auto";
    hwConvex.setMode(selectedMode);
    closeModal();
    render();
    const active = hwConvex.getActiveDeployment();
    toast(`Convex 대상이 [${active.name}]으로 설정되었습니다.`);
  } else if (a === "convex-sync-push") {
    e.preventDefault();
    e.stopImmediatePropagation();
    el.disabled = true;
    const oldText = el.textContent;
    el.textContent = "동기화 중…";
    try {
      const active = hwConvex.getActiveDeployment();
      const res = await hwConvex.syncAllToCloud();
      toast(`[${active.shortName}] 동기화 완료: 상품 ${res.syncedWorkspaces}개, 캠페인 ${res.syncedCampaigns}개`);
      if ($("#modal-root")?.children.length) closeModal();
      render();
    } catch (err) {
      toast("동기화 안내: " + err.message);
    } finally {
      el.disabled = false;
      el.textContent = oldText;
    }
  } else if (a === "convex-reset-cloud") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const active = hwConvex.getActiveDeployment();
    openModal(
      `${active.shortName} 데이터 초기화 확인`,
      `<div class="notice">
        ${icon("alert")}<strong>주의:</strong> ${esc(active.name)}의 모든 클라우드 작업 데이터(상품, 캠페인, 콘셉트, 콘텐츠, 자산)를 완전히 초기화합니다.
      </div>
      <p class="intro" style="margin-top:12px">초기화 후 새롭게 등록한 브랜드 및 실제 AI 생성 이미지를 깨끗한 상태에서 시작할 수 있습니다.</p>`,
      `<button class="btn" data-act="close-modal">취소</button>
       <button class="btn primary" data-act="convex-confirm-reset-cloud" style="background:#d93025;border-color:#d93025">초기화 실행</button>`
    );
  } else if (a === "convex-confirm-reset-cloud") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const active = hwConvex.getActiveDeployment();
    try {
      // 1. Clear Convex cloud
      await hwConvex.call("mutation", "workspaces:clearAllData", {});

      // 2. Clear Vercel server API
      if (typeof hwApi === "function") {
        try {
          await hwApi("/api/workspaces/clear-all", { method: "POST" });
        } catch (serverErr) {
          console.warn("Server reset warning:", serverErr);
        }
      }

      // 3. Clear local storage & memory state
      if (typeof works === "object") {
        works.workspaces = [];
        works.activeId = null;
        data = null;
        localStorage.removeItem("hooniworks-workspaces-v1");
        localStorage.removeItem("120studio-design-v1");
      }

      closeModal();
      if (typeof navigate === "function") navigate("dashboard");
      toast(`[${active.shortName}] 및 운영 서버 데이터가 모두 초기화되었습니다.`);
      if (typeof render === "function") render();
    } catch (err) {
      toast("초기화 실패: " + err.message);
    }
  }
});

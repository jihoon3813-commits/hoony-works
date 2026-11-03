/* HooniWorks Module: Convex Cloud Real-time & Multi-device Sync Bridge */

const hwConvex = {
  urlKey: "hooniworks-convex-url",
  getUrl() {
    return localStorage.getItem(this.urlKey) || (typeof window !== "undefined" && window.__CONVEX_URL__) || "";
  },
  setUrl(url) {
    const clean = String(url || "").trim().replace(/\/$/, "");
    if (clean) {
      localStorage.setItem(this.urlKey, clean);
    } else {
      localStorage.removeItem(this.urlKey);
    }
  },
  isConfigured() {
    return Boolean(this.getUrl());
  },

  async call(type, functionName, args = {}) {
    const convexUrl = this.getUrl();
    if (!convexUrl) {
      throw new Error("Convex URL이 설정되지 않았습니다. [API 및 사용 설정]에서 Convex 배포 URL을 입력해 주세요.");
    }
    const endpoint = `${convexUrl}/api/${type}`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: functionName,
        args,
        format: "json",
      }),
    });
    const payload = await res.json();
    if (!res.ok || payload.status === "error") {
      throw new Error(payload.errorMessage || payload.error || `Convex 요청 실패 (${res.status})`);
    }
    return payload.value !== undefined ? payload.value : payload;
  },

  async syncAllToCloud() {
    if (!this.isConfigured()) return null;
    const allWs = works?.workspaces || [];
    const settings = hwServer?.settings || { budget: data.budget || 50000 };
    return await this.call("mutation", "workspaces:bulkSyncFromClient", {
      workspaces: allWs,
      settings,
    });
  },

  async pullWorkspaceFromCloud(workspaceId) {
    if (!this.isConfigured()) return null;
    return await this.call("query", "workspaces:getFullWorkspace", { workspaceId });
  },
};

// UI Modal for Convex Connection
function openConvexConfigModal() {
  const currentUrl = hwConvex.getUrl();
  const statusBadge = hwConvex.isConfigured()
    ? `<span class="badge green">연결 설정됨</span>`
    : `<span class="badge outline">미연결</span>`;

  openModal(
    "Convex 클라우드 동기화 설정",
    `<p class="intro">Convex를 연결하면 여러 PC, 노트북, 모바일 등 다양한 환경에서 작업 내용이 실시간으로 동기화됩니다.</p>
    <div class="task-row" style="margin-bottom:16px">
      <span class="task-dot">${icon("link")}</span>
      <div class="grow">
        <strong>Convex 클라우드 상태</strong>
        <small>${currentUrl ? esc(currentUrl) : "아직 등록된 Convex URL이 없습니다."}</small>
      </div>
      ${statusBadge}
    </div>
    <div class="field">
      <label for="convex-deployment-url">Convex 배포 URL (Deployment URL)</label>
      <input type="url" id="convex-deployment-url" placeholder="https://happy-otter-123.convex.cloud" value="${esc(currentUrl)}">
      <p class="hint">Convex 대시보드(convex.dev) 프로젝트의 <b>Deployment URL</b>을 복사하여 붙여넣으세요.</p>
    </div>
    <div class="notice">
      ${icon("check")}연결 후 [클라우드로 전체 백업/동기화]를 누르면 현재 브라우저의 모든 상품, 캠페인, 템플릿, 자료가 Convex에 안전하게 저장됩니다.
    </div>`,
    `<button class="btn" data-act="close-modal">닫기</button>
     ${hwConvex.isConfigured() ? `<button class="btn ghost" data-act="convex-sync-push">${icon("upload")}지금 클라우드에 백업</button>` : ""}
     <button class="btn primary" data-act="convex-save-url">저장 및 연결</button>`
  );
}

// Enhance Settings Page with Convex Cloud section
if (typeof settingsPage === "function") {
  const baseSettingsForConvex = settingsPage;
  settingsPage = function () {
    let html = baseSettingsForConvex();
    const convexUrl = hwConvex.getUrl();
    const isConn = hwConvex.isConfigured();
    const convexCard = `
      <section class="panel" style="margin-top:20px">
        <div class="flex between">
          <div>
            <h3>Convex 클라우드 동기화 (다양한 환경 지원)</h3>
            <p class="settings-note" style="margin-top:4px">여러 PC, 스마트폰, 팀원 간에 상품·캠페인·자료를 실시간으로 동기화합니다.</p>
          </div>
          <span class="badge ${isConn ? "green" : "outline"}">${isConn ? "클라우드 연결됨" : "미연결"}</span>
        </div>
        <div class="task-row" style="margin-top:14px;background:#faf9fd;padding:12px 14px;border-radius:10px">
          <span class="task-dot">${icon("link")}</span>
          <div class="grow">
            <strong>${isConn ? "Convex 배포 엔드포인트" : "등록된 Convex URL 없음"}</strong>
            <small>${isConn ? esc(convexUrl) : "Convex Deployment URL을 연결하면 클라우드 동기화가 활성화됩니다."}</small>
          </div>
          <button class="btn sm ${isConn ? "ghost" : "primary"}" data-act="open-convex-modal">
            ${isConn ? "설정 변경" : "Convex 연결하기"}
          </button>
        </div>
        ${isConn ? `
          <div class="flex between" style="margin-top:14px">
            <span class="small muted">현재 작업 상태를 Convex 클라우드에 안전하게 백업합니다.</span>
            <button class="btn sm" data-act="convex-sync-push">${icon("upload")}지금 클라우드에 백업</button>
          </div>
        ` : ""}
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

// Enhance Shell to show Convex sync button in topbar
if (typeof shell === "function") {
  const baseShellForConvex = shell;
  shell = function (content) {
    let html = baseShellForConvex(content);
    const isConn = hwConvex.isConfigured();
    const convexPill = isConn
      ? `<button class="badge green" data-act="open-convex-modal" style="border:0;cursor:pointer" title="Convex 클라우드 연결됨">${icon("check")}Convex 동기화</button>`
      : `<button class="btn sm ghost" data-act="open-convex-modal" style="padding:4px 8px;font-size:10px">${icon("link")}Convex 연결</button>`;

    if (html.includes('<button class="btn sm ghost" data-act="open-browser-import">')) {
      return html.replace(
        '<button class="btn sm ghost" data-act="open-browser-import">',
        convexPill + '<button class="btn sm ghost" data-act="open-browser-import">'
      );
    }
    return html;
  };
}

// Attach event handlers
document.addEventListener("click", async (e) => {
  const el = e.target.closest("button,[data-act]");
  if (!el) return;
  const a = el.dataset.act;

  if (a === "open-convex-modal") {
    e.preventDefault();
    e.stopImmediatePropagation();
    openConvexConfigModal();
  } else if (a === "convex-save-url") {
    e.preventDefault();
    e.stopImmediatePropagation();
    const val = $("#convex-deployment-url")?.value?.trim();
    hwConvex.setUrl(val);
    closeModal();
    render();
    if (val) {
      toast("Convex 배포 URL을 저장했습니다. 클라우드 동기화를 시작합니다.");
      try {
        const res = await hwConvex.syncAllToCloud();
        if (res) {
          toast(`Convex 동기화 완료: 상품 ${res.syncedWorkspaces}개, 캠페인 ${res.syncedCampaigns}개`);
        }
      } catch (err) {
        toast("동기화 안내: " + err.message);
      }
    } else {
      toast("Convex 연결이 해제되었습니다.");
    }
  } else if (a === "convex-sync-push") {
    e.preventDefault();
    e.stopImmediatePropagation();
    el.disabled = true;
    el.textContent = "동기화 중…";
    try {
      const res = await hwConvex.syncAllToCloud();
      toast(`Convex 클라우드 동기화 완료 (상품 ${res.syncedWorkspaces}개, 캠페인 ${res.syncedCampaigns}개)`);
      if ($("#modal-root")?.children.length) closeModal();
      render();
    } catch (err) {
      toast("동기화 실패: " + err.message);
    } finally {
      el.disabled = false;
      el.textContent = "지금 클라우드에 백업";
    }
  }
});

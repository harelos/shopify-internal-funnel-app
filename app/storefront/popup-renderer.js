(() => {
  "use strict";

  const VERSION = 1;
  const DEFAULT_ENDPOINT_BASE = "/popup-runtime";
  const STORAGE_KEY = "_tiger_popup_renderer_state_v1";
  const DAY_MS = 86_400_000;

  let started = false;
  let endpointBase = DEFAULT_ENDPOINT_BASE;
  let decisionIntervalMs = 5000;
  let minimumDecisionGapMs = 2500;
  let sessionStartedAt = Date.now();
  let lastInteractionAt = Date.now();
  let exitIntent = false;
  let manualTrigger = false;
  let deciding = false;
  let lastDecisionAt = 0;
  let decisionTimer = null;
  let maxOpenTimer = null;
  let modalState = null;
  let listeners = [];
  let cartSnapshot = { subtotal: null, itemCount: 0, at: 0 };
  const sessionImpressions = Object.create(null);

  function safeStorage(storage) {
    return {
      get(key) { try { return storage.getItem(key); } catch (_) { return null; } },
      set(key, value) { try { storage.setItem(key, value); return true; } catch (_) { return false; } },
    };
  }

  const local = safeStorage(window.localStorage);

  function parseJson(value, fallback) {
    try {
      const parsed = JSON.parse(value || "null");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function rendererState() {
    const raw = parseJson(local.get(STORAGE_KEY), {});
    const campaigns = raw.campaigns && typeof raw.campaigns === "object" ? raw.campaigns : {};
    return {
      v: VERSION,
      lastAnyPopupAtMs: Number(raw.lastAnyPopupAtMs) || null,
      campaigns,
    };
  }

  function saveRendererState(state) {
    local.set(STORAGE_KEY, JSON.stringify({
      v: VERSION,
      lastAnyPopupAtMs: Number(state.lastAnyPopupAtMs) || null,
      campaigns: state.campaigns || {},
    }));
  }

  function campaignState(key) {
    const state = rendererState();
    const row = state.campaigns[key] && typeof state.campaigns[key] === "object" ? state.campaigns[key] : {};
    const today = new Date().toISOString().slice(0, 10);
    return {
      previousCloseAtMs: Number(row.previousCloseAtMs) || null,
      previousSubmitAtMs: Number(row.previousSubmitAtMs) || null,
      visitorDayImpressions: row.day === today ? Math.max(0, Number(row.visitorDayImpressions) || 0) : 0,
      sessionImpressions: Math.max(0, Number(sessionImpressions[key]) || 0),
    };
  }

  function allCampaignStates() {
    const state = rendererState();
    const keys = new Set(Object.keys(state.campaigns || {}));
    Object.keys(sessionImpressions).forEach(key => keys.add(key));
    const output = {};
    keys.forEach(key => { output[key] = campaignState(key); });
    return output;
  }

  function recordImpression(key) {
    const state = rendererState();
    const today = new Date().toISOString().slice(0, 10);
    const row = state.campaigns[key] && typeof state.campaigns[key] === "object" ? state.campaigns[key] : {};
    const currentDayCount = row.day === today ? Math.max(0, Number(row.visitorDayImpressions) || 0) : 0;
    row.day = today;
    row.visitorDayImpressions = currentDayCount + 1;
    state.campaigns[key] = row;
    state.lastAnyPopupAtMs = Date.now();
    sessionImpressions[key] = (sessionImpressions[key] || 0) + 1;
    saveRendererState(state);
  }

  function recordClose(key) {
    const state = rendererState();
    const row = state.campaigns[key] && typeof state.campaigns[key] === "object" ? state.campaigns[key] : {};
    row.previousCloseAtMs = Date.now();
    state.campaigns[key] = row;
    saveRendererState(state);
  }

  function recordSubmit(key) {
    const state = rendererState();
    const row = state.campaigns[key] && typeof state.campaigns[key] === "object" ? state.campaigns[key] : {};
    row.previousSubmitAtMs = Date.now();
    state.campaigns[key] = row;
    saveRendererState(state);
  }

  function addListener(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    listeners.push(() => {
      try { target.removeEventListener(name, handler, options); } catch (_) {}
    });
  }

  function observeInteraction() {
    lastInteractionAt = Date.now();
    exitIntent = false;
  }

  function observeExit(event) {
    if (event && event.clientY <= 0 && !event.relatedTarget) exitIntent = true;
  }

  function blockingOverlayOpen() {
    const nodes = document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]');
    for (const node of nodes) {
      if (!node.closest || !node.closest("[data-tiger-popup-root]")) return true;
    }
    return false;
  }

  function currentPageRole() {
    const ctx = window.TigerPopupSessionContext;
    try {
      const localContext = ctx && typeof ctx.snapshot === "function" ? ctx.snapshot() : null;
      return localContext && localContext.pageRole ? localContext.pageRole : "unknown";
    } catch (_) {
      return "unknown";
    }
  }

  async function refreshCart() {
    if (Date.now() - cartSnapshot.at < 5000) return cartSnapshot;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timeout = window.setTimeout(() => { try { controller && controller.abort(); } catch (_) {} }, 900);
    try {
      const response = await fetch("/cart.js", {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller ? controller.signal : undefined,
      });
      if (!response.ok) throw new Error("cart unavailable");
      const cart = await response.json();
      cartSnapshot = {
        subtotal: Number.isFinite(Number(cart.items_subtotal_price)) ? Number(cart.items_subtotal_price) / 100 : null,
        itemCount: Math.max(0, Number(cart.item_count) || 0),
        at: Date.now(),
      };
    } catch (_) {
      cartSnapshot.at = Date.now();
    } finally {
      window.clearTimeout(timeout);
    }
    return cartSnapshot;
  }

  function dispatch(name, detail) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) {}
  }

  function closeModal(reason, options = {}) {
    if (!modalState) return;
    const current = modalState;
    modalState = null;
    if (maxOpenTimer) window.clearTimeout(maxOpenTimer);
    maxOpenTimer = null;

    try { document.removeEventListener("keydown", current.keydownHandler, true); } catch (_) {}
    try { current.root.remove(); } catch (_) {}
    try { document.body.style.overflow = current.previousOverflow; } catch (_) {}
    if (options.recordClose !== false) recordClose(current.campaignKey);
    if (options.recordSubmit === true) recordSubmit(current.campaignKey);
    try {
      if (current.previousFocus && typeof current.previousFocus.focus === "function") current.previousFocus.focus({ preventScroll: true });
    } catch (_) {}
    dispatch("tiger:popup:closed", { campaignKey: current.campaignKey, variantKey: current.variantKey, reason });
    scheduleDecision(800);
  }

  function focusableElements(root) {
    return Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(node => !node.disabled && node.getAttribute("aria-hidden") !== "true");
  }

  function renderPopup(payload) {
    if (!payload || !payload.render || modalState) return false;
    const render = payload.render;
    const creative = render.creative || {};
    const safety = render.safety || {};
    const campaignKey = String(render.campaignKey || "");
    const variantKey = String(render.variantKey || "");
    if (!campaignKey || !variantKey) return false;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const root = document.createElement("div");
    root.setAttribute("data-tiger-popup-root", "true");
    root.setAttribute("data-campaign-key", campaignKey);
    root.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(17,17,17,.54);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;";

    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", `tiger-popup-title-${campaignKey}`);
    modal.dir = ["rtl", "ltr"].includes(creative.direction) ? creative.direction : "auto";
    modal.style.cssText = "position:relative;width:min(100%,460px);max-height:min(90vh,680px);overflow:auto;background:#fff;color:#171717;border-radius:22px;box-shadow:0 28px 90px rgba(0,0,0,.28);padding:30px 26px 24px;";

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Close popup");
    close.textContent = "×";
    close.style.cssText = "position:absolute;top:10px;right:12px;width:38px;height:38px;border:0;background:transparent;font-size:30px;line-height:1;color:#444;cursor:pointer;border-radius:50%;";

    if (creative.imageUrl && /^https:\/\//i.test(String(creative.imageUrl))) {
      const image = document.createElement("img");
      image.src = String(creative.imageUrl);
      image.alt = "";
      image.loading = "eager";
      image.style.cssText = "display:block;width:100%;max-height:240px;object-fit:cover;border-radius:14px;margin:0 0 20px;";
      modal.appendChild(image);
    }

    const eyebrow = document.createElement("div");
    eyebrow.textContent = String(creative.eyebrow || "");
    eyebrow.style.cssText = "font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#737373;margin-bottom:8px;";

    const title = document.createElement("h2");
    title.id = `tiger-popup-title-${campaignKey}`;
    title.textContent = String(creative.title || "");
    title.style.cssText = "font-size:27px;line-height:1.18;margin:0 0 10px;font-weight:800;letter-spacing:-.02em;";

    const body = document.createElement("p");
    body.textContent = String(creative.body || "");
    body.style.cssText = "font-size:15px;line-height:1.55;margin:0 0 20px;color:#525252;";

    const primary = document.createElement("button");
    primary.type = "button";
    primary.textContent = String(creative.ctaLabel || "Continue");
    primary.style.cssText = "display:block;width:100%;border:0;border-radius:12px;background:#171717;color:#fff;font-size:15px;font-weight:750;padding:14px 16px;cursor:pointer;";

    const secondary = document.createElement("button");
    secondary.type = "button";
    secondary.textContent = String(creative.secondaryLabel || "Not now");
    secondary.style.cssText = "display:block;width:100%;border:0;background:transparent;color:#737373;font-size:13px;font-weight:650;padding:12px 16px 4px;cursor:pointer;";

    modal.prepend(close);
    modal.appendChild(eyebrow);
    modal.appendChild(title);
    modal.appendChild(body);
    modal.appendChild(primary);
    modal.appendChild(secondary);
    root.appendChild(modal);

    const keydownHandler = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal("escape");
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = focusableElements(modal);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    close.addEventListener("click", () => closeModal("close_button"));
    secondary.addEventListener("click", () => closeModal("secondary"));
    primary.addEventListener("click", () => {
      dispatch("tiger:popup:cta", {
        campaignKey,
        variantKey,
        assignmentId: payload.decision && payload.decision.assignmentId ? payload.decision.assignmentId : null,
        campaignType: render.campaignType,
      });
      closeModal("primary_cta", { recordClose: false, recordSubmit: creative.formMode !== "none" });
    });
    if (safety.backdropClose !== false) {
      root.addEventListener("mousedown", event => {
        if (event.target === root) closeModal("backdrop");
      });
    }
    document.addEventListener("keydown", keydownHandler, true);

    modalState = { root, modal, campaignKey, variantKey, previousFocus, previousOverflow, keydownHandler };
    document.body.appendChild(root);
    document.body.style.overflow = "hidden";
    recordImpression(campaignKey);
    exitIntent = false;
    manualTrigger = false;
    dispatch("tiger:popup:shown", { campaignKey, variantKey, assignmentId: payload.decision && payload.decision.assignmentId ? payload.decision.assignmentId : null });

    window.requestAnimationFrame(() => {
      try { close.focus({ preventScroll: true }); } catch (_) {}
    });

    const maxOpenMs = Math.max(5000, Math.min(900000, Number(safety.maxOpenMs) || 300000));
    maxOpenTimer = window.setTimeout(() => closeModal("timeout"), maxOpenMs);
    return true;
  }

  async function identityAndSnapshot() {
    const ctx = window.TigerPopupSessionContext;
    if (!ctx || typeof ctx.start !== "function" || typeof ctx.bootstrap !== "function" || typeof ctx.snapshot !== "function") {
      throw new Error("TigerPopupSessionContext is required before the renderer can start.");
    }
    await ctx.start({ endpointBase });
    const identity = await ctx.bootstrap();
    return { identity, snapshot: ctx.snapshot() };
  }

  async function postDecision(identity, snapshot, state) {
    const response = await fetch(`${endpointBase}/decision`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: identity.sessionToken, snapshot, state }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Popup decision failed (${response.status})`);
    return data;
  }

  async function makeDecision() {
    if (!started || deciding || modalState || document.visibilityState === "hidden") return null;
    const now = Date.now();
    if (now - lastDecisionAt < minimumDecisionGapMs) return null;
    deciding = true;
    lastDecisionAt = now;
    try {
      const { identity, snapshot } = await identityAndSnapshot();
      const cart = await refreshCart();
      const state = rendererState();
      const pageRole = snapshot.pageRole || currentPageRole();
      const response = await postDecision(identity, snapshot, {
        sessionElapsedMs: Math.max(0, Date.now() - sessionStartedAt),
        scrollDepthPct: snapshot.behavior && Number(snapshot.behavior.maxScrollDepthPct) || 0,
        inactiveMs: Math.max(0, Date.now() - lastInteractionAt),
        exitIntent,
        manualTrigger,
        cartSubtotal: cart.subtotal,
        cartItemCount: cart.itemCount,
        supportIntentActive: snapshot.explicitIntent === "support",
        blockingOverlayOpen: blockingOverlayOpen(),
        checkoutInProgress: pageRole === "checkout",
        lastAnyPopupAtMs: state.lastAnyPopupAtMs,
        campaignStates: allCampaignStates(),
      });
      dispatch("tiger:popup:decision", response.decision || null);
      if (response.rendererEnabled && response.decision && response.decision.action === "SHOW") renderPopup(response);
      return response;
    } catch (error) {
      dispatch("tiger:popup:error", { message: String(error && error.message ? error.message : error) });
      return null;
    } finally {
      deciding = false;
    }
  }

  function scheduleDecision(delay = decisionIntervalMs) {
    if (!started) return;
    if (decisionTimer) window.clearTimeout(decisionTimer);
    decisionTimer = window.setTimeout(async () => {
      await makeDecision();
      scheduleDecision(decisionIntervalMs);
    }, Math.max(250, delay));
  }

  async function start(options = {}) {
    endpointBase = typeof options.endpointBase === "string" && options.endpointBase.trim()
      ? options.endpointBase.trim().replace(/\/$/, "")
      : DEFAULT_ENDPOINT_BASE;
    decisionIntervalMs = Math.max(2000, Math.min(60000, Number(options.decisionIntervalMs) || 5000));
    minimumDecisionGapMs = Math.max(1000, Math.min(decisionIntervalMs, Number(options.minimumDecisionGapMs) || 2500));
    if (started) return { started: true, version: VERSION };

    started = true;
    sessionStartedAt = Date.now();
    lastInteractionAt = Date.now();
    addListener(window, "pointerdown", observeInteraction, { passive: true });
    addListener(window, "keydown", observeInteraction, { passive: true });
    addListener(window, "scroll", () => scheduleDecision(600), { passive: true });
    addListener(document, "mouseout", observeExit, { passive: true });
    addListener(document, "visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleDecision(500);
    }, false);
    scheduleDecision(500);
    return { started: true, version: VERSION };
  }

  function stop() {
    started = false;
    if (decisionTimer) window.clearTimeout(decisionTimer);
    decisionTimer = null;
    listeners.splice(0).forEach(remove => {
      try { remove(); } catch (_) {}
    });
    if (modalState) closeModal("renderer_stop", { recordClose: false });
  }

  function trigger() {
    manualTrigger = true;
    scheduleDecision(0);
  }

  function current() {
    return {
      version: VERSION,
      started,
      deciding,
      modalOpen: Boolean(modalState),
      campaignKey: modalState ? modalState.campaignKey : null,
      endpointBase,
    };
  }

  window.TigerPopupRenderer = Object.freeze({
    version: VERSION,
    start,
    stop,
    trigger,
    decide: makeDecision,
    close: reason => closeModal(reason || "api_close"),
    current,
  });
})();

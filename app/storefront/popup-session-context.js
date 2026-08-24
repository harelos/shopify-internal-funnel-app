(() => {
  "use strict";

  const VERSION = 1;
  const VISITOR_TOKEN_KEY = "_tiger_popup_visitor_token_v1";
  const SESSION_TOKEN_KEY = "_tiger_popup_session_token_v1";
  const ACQUISITION_KEY = "_tiger_popup_acquisition_v1";
  const LANDING_KEY = "_tiger_popup_landing_v1";
  const RETURNING_KEY = "_tiger_popup_seen_v1";
  const ANONYMOUS_STATE_KEY = "_tiger_popup_anon_state_v1";
  const DEFAULT_ENDPOINT_BASE = "/popup-runtime";

  let started = false;
  let endpointBase = DEFAULT_ENDPOINT_BASE;
  let productHandleOverride = null;
  let funnelIdOverride = null;
  let serverRefreshMs = 0;
  let refreshTimer = null;
  let activeTimer = null;
  let lastActiveTick = 0;
  let identity = null;
  let serverContext = null;
  let serverContextAt = 0;
  let anonymousState = null;
  let listeners = [];
  const subscribers = new Set();
  const behavior = {
    interactionCount: 0,
    maxScrollDepthPct: 0,
    activeMs: 0,
    visibilityChanges: 0,
  };

  function safeStorage(storage) {
    return {
      get(key) {
        try { return storage.getItem(key); } catch (_) { return null; }
      },
      set(key, value) {
        try { storage.setItem(key, value); return true; } catch (_) { return false; }
      },
      remove(key) {
        try { storage.removeItem(key); } catch (_) {}
      },
    };
  }

  const local = safeStorage(window.localStorage);
  const session = safeStorage(window.sessionStorage);

  function bounded(value, max) {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? text.slice(0, max) : null;
  }

  function minimizedUrl(value, max = 1200) {
    const raw = bounded(value, max);
    if (!raw) return null;
    try {
      const url = new URL(raw, window.location.origin);
      return `${url.origin}${url.pathname}`.slice(0, max);
    } catch (_) {
      return String(raw).split(/[?#]/, 1)[0].slice(0, max) || null;
    }
  }

  function parseJson(value, fallback) {
    try {
      const parsed = JSON.parse(value || "null");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function queryValue(params, names, max) {
    for (const name of names) {
      const value = bounded(params.get(name), max);
      if (value) return value;
    }
    return null;
  }

  function captureAcquisition() {
    const existing = parseJson(session.get(ACQUISITION_KEY), null);
    if (existing && existing.v === VERSION) return existing.data || {};

    const params = new URLSearchParams(window.location.search || "");
    const data = {
      utmSource: queryValue(params, ["utm_source"], 200),
      utmMedium: queryValue(params, ["utm_medium"], 200),
      utmCampaign: queryValue(params, ["utm_campaign"], 300),
      utmContent: queryValue(params, ["utm_content"], 300),
      utmTerm: queryValue(params, ["utm_term"], 300),
      fbclid: queryValue(params, ["fbclid"], 500),
      gclid: queryValue(params, ["gclid"], 500),
      ttclid: queryValue(params, ["ttclid"], 500),
      adId: queryValue(params, ["ad_id", "adid", "meta_ad_id"], 200),
      adsetId: queryValue(params, ["adset_id", "adsetid", "meta_adset_id"], 200),
      campaignId: queryValue(params, ["campaign_id", "campaignid", "meta_campaign_id", "utm_id"], 200),
      creativeId: queryValue(params, ["creative_id", "creativeid", "meta_creative_id"], 200),
      placement: queryValue(params, ["placement", "publisher_platform"], 200),
    };
    session.set(ACQUISITION_KEY, JSON.stringify({ v: VERSION, data }));
    return data;
  }

  function landingPath() {
    const existing = bounded(session.get(LANDING_KEY), 800);
    if (existing) return existing;
    const path = bounded(window.location.pathname || "/", 800) || "/";
    session.set(LANDING_KEY, path);
    return path;
  }

  function anonymousVisitorState() {
    if (anonymousState) return anonymousState;
    const sessionState = session.get(ANONYMOUS_STATE_KEY);
    if (sessionState === "new" || sessionState === "returning") {
      anonymousState = sessionState;
      return anonymousState;
    }
    const seenBeforeSession = Boolean(local.get(RETURNING_KEY));
    anonymousState = seenBeforeSession ? "returning" : "new";
    session.set(ANONYMOUS_STATE_KEY, anonymousState);
    if (!seenBeforeSession) local.set(RETURNING_KEY, String(Date.now()));
    return anonymousState;
  }

  function inferProductHandle() {
    if (productHandleOverride) return bounded(productHandleOverride, 200);
    const match = String(window.location.pathname || "").match(/^\/products\/([^/?#]+)/i);
    return match ? bounded(decodeURIComponent(match[1]), 200) : null;
  }

  function inferFunnelId() {
    if (funnelIdOverride) return bounded(funnelIdOverride, 200);
    const root = document.documentElement;
    return bounded(root && root.dataset ? root.dataset.tigerFunnelId : null, 200);
  }

  function inferPageRole() {
    const path = String(window.location.pathname || "/").toLowerCase();
    if (path === "/") return "homepage";
    if (path.startsWith("/products/")) return "product";
    if (path.startsWith("/collections/")) return "collection";
    if (path === "/cart" || path.startsWith("/cart/")) return "cart";
    if (path.startsWith("/checkout")) return "checkout";
    if (path.includes("unsubscribe")) return "unsubscribe";
    if (path === "/contact" || path.startsWith("/pages/contact")) return "contact";
    if (path.includes("order-status") || path.includes("order-tracking") || path.includes("track-order") || path.startsWith("/account/orders")) return "tracking";
    if (path.startsWith("/policies/") || path.startsWith("/pages/privacy") || path.startsWith("/pages/terms")) return "policy";
    if (path.startsWith("/blogs/") || path.startsWith("/blog/")) return "content";
    if (inferFunnelId()) return "funnel";
    return "unknown";
  }

  function testMarker() {
    const params = new URLSearchParams(window.location.search || "");
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (["localhost", "127.0.0.1"].includes(hostname)) return "localhost";
    if (params.get("__tiger_test") === "1") return "query_marker";
    if (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.tigerTest === "true") return "dom_marker";
    return null;
  }

  function viewport() {
    return {
      width: Number.isFinite(window.innerWidth) ? window.innerWidth : null,
      height: Number.isFinite(window.innerHeight) ? window.innerHeight : null,
    };
  }

  function snapshot() {
    const vp = viewport();
    const reason = testMarker();
    const pageRole = inferPageRole();
    const explicitIntent = pageRole === "contact" ? "support"
      : pageRole === "tracking" ? "tracking"
      : pageRole === "unsubscribe" ? "unsubscribe"
      : ["product", "collection", "homepage", "funnel", "cart", "checkout"].includes(pageRole) ? "commerce"
      : "unknown";

    return {
      // Deliberately omit arbitrary query strings. Known acquisition parameters
      // are captured separately below, preventing accidental email/phone/PII capture.
      pageUrl: minimizedUrl(window.location.href, 1600),
      pagePath: bounded(window.location.pathname || "/", 800) || "/",
      landingPath: landingPath(),
      referrer: minimizedUrl(document.referrer, 1200),
      userAgent: bounded(navigator.userAgent, 1200),
      language: bounded(navigator.language, 80),
      viewportWidth: vp.width,
      viewportHeight: vp.height,
      devicePixelRatio: Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : null,
      touchPoints: Number.isFinite(navigator.maxTouchPoints) ? navigator.maxTouchPoints : null,
      anonymousVisitorState: anonymousVisitorState(),
      productHandle: inferProductHandle(),
      funnelId: inferFunnelId(),
      pageRole,
      explicitIntent,
      commercialIntent: ["product", "collection", "homepage", "funnel", "cart", "checkout"].includes(pageRole) ? true : null,
      acquisition: captureAcquisition(),
      behavior: { ...behavior },
      clientInternalTest: Boolean(reason),
      clientTestReason: reason,
    };
  }

  function notify() {
    const value = current();
    subscribers.forEach(fn => {
      try { fn(value); } catch (_) {}
    });
  }

  function updateScrollDepth() {
    const doc = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY || doc.scrollTop || (body && body.scrollTop) || 0;
    const scrollHeight = Math.max(doc.scrollHeight || 0, body ? body.scrollHeight || 0 : 0);
    const viewHeight = window.innerHeight || doc.clientHeight || 0;
    const denominator = Math.max(1, scrollHeight - viewHeight);
    const pct = Math.max(0, Math.min(100, Math.round((scrollTop / denominator) * 100)));
    if (pct > behavior.maxScrollDepthPct) {
      behavior.maxScrollDepthPct = pct;
      notify();
    }
  }

  function observeInteraction() {
    behavior.interactionCount += 1;
    notify();
  }

  function observeVisibility() {
    behavior.visibilityChanges += 1;
    lastActiveTick = Date.now();
    notify();
  }

  function addListener(target, name, handler, options) {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  }

  function beginBehaviorCollection() {
    addListener(window, "scroll", updateScrollDepth, { passive: true });
    if ("PointerEvent" in window) addListener(window, "pointerdown", observeInteraction, { passive: true });
    else addListener(window, "touchstart", observeInteraction, { passive: true });
    addListener(window, "keydown", observeInteraction, { passive: true });
    addListener(document, "visibilitychange", observeVisibility, false);
    updateScrollDepth();
    lastActiveTick = Date.now();
    activeTimer = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible") behavior.activeMs += Math.max(0, Math.min(2000, now - lastActiveTick));
      lastActiveTick = now;
    }, 1000);
  }

  async function post(path, body) {
    const response = await fetch(`${endpointBase}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Popup context request failed (${response.status})`);
    return data;
  }

  async function bootstrap() {
    const response = await post("/session/bootstrap", {
      visitorToken: local.get(VISITOR_TOKEN_KEY),
      sessionToken: session.get(SESSION_TOKEN_KEY),
    });
    identity = {
      visitorId: response.visitorId,
      sessionId: response.sessionId,
      visitorToken: response.visitorToken,
      sessionToken: response.sessionToken,
      verified: true,
    };
    local.set(VISITOR_TOKEN_KEY, response.visitorToken);
    session.set(SESSION_TOKEN_KEY, response.sessionToken);
    notify();
    return identity;
  }

  async function refresh() {
    if (!identity || !identity.sessionToken) await bootstrap();
    const response = await post("/session/context", {
      sessionToken: identity.sessionToken,
      snapshot: snapshot(),
    });
    serverContext = response;
    serverContextAt = Date.now();
    notify();
    return response;
  }

  function current() {
    return {
      version: VERSION,
      started,
      identity: identity ? { visitorId: identity.visitorId, sessionId: identity.sessionId, verified: identity.verified } : null,
      local: snapshot(),
      server: serverContext,
      serverContextAt: serverContextAt || null,
    };
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  async function attemptServerVerification() {
    try {
      if (!identity || !identity.sessionToken) await bootstrap();
      await refresh();
      return true;
    } catch (error) {
      // Context failure must never block the storefront or popup close paths.
      serverContext = { ok: false, error: String(error && error.message ? error.message : error), runtimeUnavailable: true };
      serverContextAt = Date.now();
      notify();
      return false;
    }
  }

  async function start(options = {}) {
    endpointBase = bounded(options.endpointBase, 500) || endpointBase || DEFAULT_ENDPOINT_BASE;
    endpointBase = endpointBase.replace(/\/$/, "");
    productHandleOverride = options.productHandle || productHandleOverride || null;
    funnelIdOverride = options.funnelId || funnelIdOverride || null;
    serverRefreshMs = Math.max(0, Math.min(300000, Number(options.serverRefreshMs ?? serverRefreshMs) || 0));

    if (!started) {
      started = true;
      beginBehaviorCollection();
    }

    await attemptServerVerification();
    if (serverRefreshMs >= 5000 && !refreshTimer) {
      refreshTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") refresh().catch(() => {});
      }, serverRefreshMs);
    }
    return current();
  }

  function stop() {
    listeners.splice(0).forEach(remove => {
      try { remove(); } catch (_) {}
    });
    if (activeTimer) window.clearInterval(activeTimer);
    if (refreshTimer) window.clearInterval(refreshTimer);
    activeTimer = null;
    refreshTimer = null;
    started = false;
    notify();
  }

  window.TigerPopupSessionContext = Object.freeze({
    version: VERSION,
    start,
    stop,
    snapshot,
    current,
    refresh,
    bootstrap,
    subscribe,
  });
})();

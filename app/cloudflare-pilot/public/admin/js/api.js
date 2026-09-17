const ID_TOKEN_TIMEOUT_MS = 5000;
const SUPPORT_AUTH_RETRY_KEY = "funnel-support-auth-retry-v1";
const SUPPORT_AUTH_RETRY_MAX_AGE_MS = 2 * 60 * 1000;

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    Promise.resolve(promise).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

async function shopifyAuthHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  if (window.shopify && typeof window.shopify.idToken === "function") {
    try {
      const token = await withTimeout(window.shopify.idToken(), ID_TOKEN_TIMEOUT_MS, "Shopify ID token request timed out.");
      if (token) nextHeaders.Authorization = `Bearer ${token}`;
    } catch (error) {
      console.warn("Shopify ID token unavailable; using local or App Bridge fetch behavior.", error);
    }
  }
  return nextHeaders;
}

function saveSupportMutationForFreshSession(path, options) {
  const method = String(options.method || "GET").toUpperCase();
  if (method === "GET" || !String(path).startsWith("/api/support/")) return false;
  sessionStorage.setItem(SUPPORT_AUTH_RETRY_KEY, JSON.stringify({
    path,
    method,
    headers: options.headers || {},
    body: typeof options.body === "string" && options.body.length <= 20000 ? options.body : undefined,
    createdAt: Date.now(),
  }));
  window.location.reload();
  return true;
}

async function apiFetch(path, options = {}, allowFreshSessionReload = true) {
  const headers = await shopifyAuthHeaders(options.headers || {});
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    if (response.status === 401
      && allowFreshSessionReload
      && response.headers.get("X-Shopify-Retry-Invalid-Session-Request") === "1"
      && saveSupportMutationForFreshSession(path, options)) {
      return new Promise(() => {});
    }
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}

async function replaySupportMutationAfterReload() {
  const raw = sessionStorage.getItem(SUPPORT_AUTH_RETRY_KEY);
  if (!raw) return;
  sessionStorage.removeItem(SUPPORT_AUTH_RETRY_KEY);
  let pending;
  try { pending = JSON.parse(raw); } catch { return; }
  if (!pending?.path?.startsWith("/api/support/") || Date.now() - Number(pending.createdAt || 0) > SUPPORT_AUTH_RETRY_MAX_AGE_MS) return;
  try {
    const result = await apiFetch(pending.path, {
      method: pending.method,
      headers: pending.headers || {},
      body: pending.body,
    }, false);
    window.dispatchEvent(new CustomEvent("funnel:support-mutation-replayed", { detail: { ok: true, path: pending.path, result } }));
  } catch (error) {
    window.dispatchEvent(new CustomEvent("funnel:support-mutation-replayed", { detail: { ok: false, path: pending.path, error: error.message } }));
  }
}

window.addEventListener("DOMContentLoaded", () => setTimeout(replaySupportMutationAfterReload, 250));

const API = {
  async get(path) {
    return apiFetch(path);
  },
  async post(path, body) {
    return apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async put(path, body) {
    return apiFetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async patch(path, body) {
    return apiFetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  async del(path) {
    return apiFetch(path, { method: "DELETE" });
  }
};

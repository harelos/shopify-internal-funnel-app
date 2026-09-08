async function shopifyAuthHeaders(headers = {}) {
  const nextHeaders = { ...headers };
  if (window.shopify && typeof window.shopify.idToken === "function") {
    try {
      const token = await window.shopify.idToken();
      if (token) nextHeaders.Authorization = `Bearer ${token}`;
    } catch (err) {
      console.warn("Shopify ID token unavailable; using local or App Bridge fetch behavior.", err);
    }
  }
  return nextHeaders;
}

async function parseResponse(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

async function apiFetch(path, options = {}) {
  const headers = await shopifyAuthHeaders(options.headers || {});
  return parseResponse(await fetch(path, { ...options, headers }));
}

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

const ID_TOKEN_TIMEOUT_MS = 5000;

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

async function apiFetch(path, options = {}) {
  const headers = await shopifyAuthHeaders(options.headers || {});
  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
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

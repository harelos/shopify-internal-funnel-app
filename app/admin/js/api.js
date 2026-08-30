const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async put(path, body) {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async patch(path, body) {
    const res = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  },
  async del(path) {
    const res = await fetch(path, { method: "DELETE" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || "Request failed");
    }
    return res.json();
  }
};

// Classic scripts share lexical bindings, but module pages intentionally read
// the client from window so they can detect whether the shared API is loaded.
window.API = API;

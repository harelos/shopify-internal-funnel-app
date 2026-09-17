/**
 * Live funnel: polls the Worker every three seconds and shows what shoppers on
 * the sales page are doing. Sessions fold into cards; the stream keeps the
 * last few hundred actions; checkout and paid orders come from Shopify.
 */
document.addEventListener("DOMContentLoaded", () => {
  const POLL_MS = 3000;
  const MAX_ROWS = 400;
  const byId = id => document.getElementById(id);
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const money = new Map();
  const fmtMoney = (amount, currency) => {
    const code = currency || "ILS";
    if (!money.has(code)) money.set(code, new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }));
    return money.get(code).format(Number(amount || 0));
  };

  const state = { cursor: null, paused: false, seen: new Set(), rows: [], timer: null, failures: 0 };
  const pageSelect = byId("live-page");
  const hideInternal = byId("live-hide-internal");
  const pill = byId("live-state");

  const ICONS = { view: "👋", section: "↓", bundle: "📦", shade: "🎨", compare: "⇄", mix: "🧪", module: "✨", module_action: "👆", cart_add: "🛒", cart_open: "🛒", cart_close: "✕", checkout_click: "💳", click: "•", popup: "💬", leave: "🚪" };
  const DEVICE = { "iphone-facebook": "iPhone · Facebook", "android-facebook": "Android · Facebook", "iphone-instagram": "iPhone · Instagram", "android-instagram": "Android · Instagram", iphone: "iPhone", android: "Android", mobile: "Phone", desktop: "Desktop", unknown: "Unknown device" };
  const VARIANT = { control: "control", value_delta: "value delta", shade_rescue: "shade rescue", scroll_rescue: "scroll rescue", full_adaptive: "all three" };

  function setPill(mode, text) { pill.className = `live-pill is-${mode}`; pill.innerHTML = `<span class="live-dot"></span>${escape(text)}`; }
  function who(sessionKey) {
    // a stable, human name per session so the eye can follow one shopper through the stream
    let hash = 0; for (const ch of sessionKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const names = ["Amber", "Basil", "Coral", "Dune", "Ember", "Fern", "Garnet", "Hazel", "Iris", "Jade", "Kelp", "Lilac", "Maple", "Nova", "Olive", "Pearl", "Quill", "Rose", "Sage", "Teal", "Umber", "Violet", "Willow", "Zinnia"];
    return `${names[hash % names.length]} ${(hash % 97) + 1}`;
  }
  function sessionCard(s) {
    const steps = [
      ["landed", true], ["shade", Boolean(s.reached.shade)], ["bundle" + (s.reached.bundle ? ` ${s.reached.bundle}` : ""), Boolean(s.reached.bundle)],
      ["cart", s.reached.cart], ["checkout", s.reached.checkout],
    ];
    return `
      <article class="live-session ${s.active ? "is-active" : ""} ${s.isInternal ? "is-internal" : ""}" data-session="${escape(s.sessionKey)}">
        <div class="live-session__top">
          <span class="live-session__who">${escape(who(s.sessionKey))}${s.isInternal ? ' <span class="muted">(you)</span>' : ""}</span>
          <span class="live-session__meta">${escape(DEVICE[s.device] || s.device)} · ${escape(s.source)}</span>
        </div>
        <div class="live-session__last">${escape(s.lastLabel || "landed")}<time>${clock.format(new Date(s.lastSeen))}</time></div>
        <div class="live-steps">
          ${s.variant ? `<span class="live-variant">${escape(VARIANT[s.variant] || s.variant)}</span>` : ""}
          ${steps.map(([name, on]) => `<span class="live-step ${on ? "on" : ""}">${escape(name)}</span>`).join("")}
          ${s.modules.map(m => `<span class="live-step on">saw ${escape(m.replace(/_/g, " "))}</span>`).join("")}
        </div>
      </article>`;
  }
  function eventRow(e, isNew) {
    return `<div class="live-row kind-${escape(e.kind)} ${e.isInternal ? "is-internal" : ""} ${isNew ? "is-new" : ""}">
      <time>${clock.format(new Date(e.occurredAt))}</time><span class="live-icon">${ICONS[e.kind] || "•"}</span>
      <span><span class="live-who">${escape(who(e.sessionKey))}</span> ${escape(e.label || e.kind)}${e.variant && e.kind === "view" ? ` <span class="live-variant">${escape(VARIANT[e.variant] || e.variant)}</span>` : ""}</span>
    </div>`;
  }
  function orderRows(data) {
    const items = [
      ...data.purchases.map(o => ({ at: o.paidAt, paid: true, text: `Paid ${fmtMoney(o.amount, o.currency)}${o.status && o.status !== "PAID" ? ` (${o.status.toLowerCase()})` : ""}` })),
      ...data.checkouts.map(c => ({ at: c.occurredAt, paid: false, text: c.name === "checkout_completed" ? "Checkout completed" : "Checkout started" + (c.utmSource ? ` · ${c.utmSource}` : "") })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
    if (!items.length) return '<p class="muted">No checkout activity in the last hour.</p>';
    return items.map(i => `<div class="live-order ${i.paid ? "is-paid" : ""}"><time>${clock.format(new Date(i.at))}</time><span>${escape(i.text)}</span><span>${i.paid ? "✓" : ""}</span></div>`).join("");
  }

  function render(data) {
    const hide = hideInternal.checked;
    byId("c-active").textContent = data.counters.activeNow;
    byId("c-views").textContent = data.counters.views10m;
    byId("c-atc").textContent = data.counters.addToCart10m;
    byId("c-checkout").textContent = data.counters.checkout10m;
    byId("c-paid").textContent = data.counters.paid60m;

    const sessions = data.sessions.filter(s => !(hide && s.isInternal));
    byId("live-session-count").textContent = sessions.length;
    byId("live-sessions").innerHTML = sessions.length ? sessions.map(sessionCard).join("") : '<p class="muted">Nobody on the page in the last 30 minutes.</p>';

    const fresh = data.events.filter(e => !state.seen.has(e.id));
    fresh.forEach(e => state.seen.add(e.id));
    state.rows = [...fresh.reverse(), ...state.rows].slice(0, MAX_ROWS);
    const visible = state.rows.filter(e => !(hide && e.isInternal));
    byId("live-event-count").textContent = visible.length;
    byId("live-stream").innerHTML = visible.length ? visible.map((e, i) => eventRow(e, i < fresh.length)).join("") : '<p class="muted">Nothing yet.</p>';
    byId("live-orders").innerHTML = orderRows(data);
  }

  async function poll() {
    if (state.paused || document.hidden) return;
    try {
      const params = new URLSearchParams();
      if (state.cursor) params.set("since", state.cursor);
      if (pageSelect.value) params.set("page", pageSelect.value);
      const data = await API.get(`/api/live/feed?${params}`);
      state.cursor = data.cursor;
      state.failures = 0;
      render(data);
      setPill("live", `Live · ${clock.format(new Date(data.now))}`);
    } catch (error) {
      state.failures += 1;
      setPill("error", state.failures > 3 ? `Lost the connection: ${error.message}` : "Reconnecting…");
    }
  }

  function start() {
    clearInterval(state.timer);
    state.timer = setInterval(poll, POLL_MS);
    poll();
  }

  pageSelect.addEventListener("change", () => { state.cursor = null; state.seen.clear(); state.rows = []; byId("live-stream").innerHTML = ""; start(); });
  hideInternal.addEventListener("change", poll);
  byId("live-pause").addEventListener("click", event => {
    state.paused = !state.paused;
    event.currentTarget.textContent = state.paused ? "Resume" : "Pause";
    if (state.paused) setPill("paused", "Paused"); else start();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !state.paused) poll(); });
  start();
});

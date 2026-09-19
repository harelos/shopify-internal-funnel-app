/**
 * The Experiments screen: every test the store runs, in one list.
 *
 * Three kinds share the list and the same columns — whole-page tests (two
 * URLs, split by the app proxy), on-page tests (the sales page buckets the
 * visitor and reports to the app) and the popup offer test (same mechanism,
 * reported by the popup). Each card is one line until opened: what is being
 * tested, whether it runs, the split, and the headline numbers. Opening it
 * shows the funnel per variant — visitors (landing page views), add to cart,
 * checkout, orders, revenue, revenue per visitor and an estimated ROAS — and
 * the controls. Money always comes from Shopify; visitors from the app's own
 * assignment rows; ROAS from the Meta spend ledger shared by visitor share.
 */
document.addEventListener("DOMContentLoaded", () => {
  const list = document.getElementById("experiments-list");
  const refreshButton = document.getElementById("experiments-refresh");
  const addButton = document.getElementById("experiments-add");
  if (!list) return;

  const OPEN_KEY = "fc.experiments.open";
  const money = new Map();
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtMoney = (value, currency) => {
    if (value == null || !Number.isFinite(Number(value))) return "—";
    const code = currency || "ILS";
    if (!money.has(code)) money.set(code, new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }));
    return money.get(code).format(Number(value));
  };
  const pct = (value, digits = 1) => value == null ? "—" : `${(Number(value) * 100).toFixed(digits)}%`;
  const num = value => value == null ? "—" : new Intl.NumberFormat("en-US").format(Number(value));
  const roas = value => value == null ? "—" : `${Number(value).toFixed(2)}×`;
  const when = iso => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "not started";
  const uplift = value => value == null ? "—" : value === 0 ? "control" : `<span class="${value > 0 ? "exp-uplift-positive" : "exp-uplift-negative"}">${value > 0 ? "+" : ""}${value}%</span>`;
  const storefront = () => (document.body.dataset.storefront || "tigerbrandsglobal.com").replace(/^https?:\/\//, "").replace(/\/$/, "");

  /** What each variant key means to a person, per kind of test. */
  const VARIANT_LABELS = {
    control: "Control — page as it is",
    full_adaptive: "All three modules",
    value_delta: "Value delta",
    shade_rescue: "Shade rescue",
    scroll_rescue: "Scroll rescue",
    email_gate: "Code after email — as it is",
    instant_code: "Code shown at once",
  };
  const label = key => VARIANT_LABELS[key] || key;
  const KINDS = {
    page: { title: "WHOLE PAGE", blurb: "Two different pages; the ad link splits visitors before anything loads." },
    adaptive: { title: "ON-PAGE MODULES", blurb: "The sales page shows extra modules to part of its visitors." },
    popup: { title: "EXIT POPUP OFFER", blurb: "What the exit popup offers: the code after an email, or at once." },
  };
  const kindOf = exp => exp.kind === "page" ? "page" : /popup/.test(exp.key) ? "popup" : "adaptive";

  const openState = () => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "{}"); } catch { return {}; } };
  const setOpen = (id, open) => { try { const state = openState(); state[id] = open; localStorage.setItem(OPEN_KEY, JSON.stringify(state)); } catch { /* per-viewer nicety only */ } };

  // ---------------------------------------------------------------- shaping

  /** One shape for every kind, so the card renders the same columns. */
  function normalizeAdaptive(exp) {
    const r = exp.results;
    const variants = r.variants.map(v => ({ ...v, id: v.key, label: label(v.key), weight: v.percentage }));
    const control = variants.find(v => v.isControl) || variants[0];
    const challengers = variants.filter(v => v !== control);
    const live = challengers.find(v => v.percentage > 0) || challengers.slice().sort((a, b) => b.visitors - a.visitors)[0] || null;
    return {
      id: exp.key, key: exp.key, kind: kindOf(exp), name: exp.name, running: Boolean(exp.active),
      startedAt: exp.startedAt || exp.since, currency: r.currency, spend: r.spend, note: r.note, sources: exp.sources, links: exp.links,
      control, challenger: live, share: control ? 100 - control.percentage : 0,
      variants,
      totals: r.totals, unattributed: r.totals.unattributedOrders,
    };
  }
  function normalizePage(exp) {
    const variants = (exp.variants || []).map(v => ({
      ...v, label: v.label, weight: v.weight, percentage: v.weight,
      conversionRate: v.conversionRate == null ? null : v.conversionRate / 100,
      revenuePerVisitorUpliftPercent: null,
    }));
    const control = variants.find(v => v.isControl) || variants[0];
    for (const v of variants) {
      v.revenuePerVisitorUpliftPercent = v === control ? 0
        : (v.revenuePerVisitor == null || !control || !control.revenuePerVisitor) ? null
          : Number((((v.revenuePerVisitor - control.revenuePerVisitor) / control.revenuePerVisitor) * 100).toFixed(1));
    }
    const challenger = variants.find(v => v !== control) || null;
    const totals = variants.reduce((sum, v) => ({ visitors: sum.visitors + (v.visitors || 0), orders: sum.orders + (v.orders || 0), revenue: sum.revenue + (v.revenue || 0) }), { visitors: 0, orders: 0, revenue: 0 });
    return {
      id: exp.id, key: exp.key, kind: "page", name: exp.name, running: exp.status === "RUNNING", status: exp.status,
      startedAt: exp.startedAt, currency: variants.find(v => v.currency)?.currency || null, spend: exp.spend || null,
      note: exp.measurement ? exp.measurement.funnel : "", sources: null, links: { splitter: `https://${storefront()}/apps/funnels/go/${encodeURIComponent(exp.key)}` },
      control, challenger, share: challenger ? challenger.weight : 0,
      variants, totals: { ...totals, spend: exp.spend ? exp.spend.amount : null }, unattributed: 0,
    };
  }

  // ---------------------------------------------------------------- rendering

  function splitSentence(exp) {
    const target = exp.challenger ? escape(exp.challenger.label) : "the other version";
    const controlLabel = exp.control ? escape(exp.control.label) : "control";
    if (!exp.running) return `Not running. Every visitor sees <strong>${controlLabel}</strong>.`;
    if (!exp.share) return `Every visitor sees <strong>${controlLabel}</strong>. Nothing is being compared.`;
    if (exp.share === 100) return `<strong>Every</strong> visitor gets <strong>${target}</strong>. With nobody on ${controlLabel} there is nothing to compare against.`;
    return `<strong>${exp.share}%</strong> of new visitors get <strong>${target}</strong>; the other <strong>${100 - exp.share}%</strong> see ${controlLabel}.`;
  }

  function summary(exp) {
    const best = exp.challenger && exp.challenger.visitors > 0 ? exp.challenger : null;
    const items = [
      ["VISITORS", num(exp.totals.visitors)],
      ["ORDERS", num(exp.totals.orders)],
      ["REVENUE", fmtMoney(exp.totals.revenue, exp.currency)],
    ];
    if (best) items.push(["VS CONTROL", uplift(best.revenuePerVisitorUpliftPercent)]);
    return items.map(([k, v]) => `<div><span>${k}</span> <b>${v}</b></div>`).join("");
  }

  function kpis(exp) {
    const t = exp.totals;
    const atc = exp.variants.reduce((s, v) => s + (v.addToCart || 0), 0);
    const co = exp.variants.reduce((s, v) => s + (v.checkout || 0), 0);
    const hasFunnel = exp.variants.some(v => v.addToCart != null);
    const spendKnown = exp.spend && exp.spend.currency === (exp.currency || exp.spend.currency);
    const totalRoas = spendKnown && exp.spend.amount > 0 ? t.revenue / exp.spend.amount : null;
    const cells = [
      ["VISITORS · LPV", num(t.visitors), "assigned by the app"],
      ["ADD TO CART", hasFunnel ? `${num(atc)} <small class="muted">${pct(t.visitors ? atc / t.visitors : null)}</small>` : "—", exp.kind === "page" ? "PostHog sample" : "of visitors"],
      ["CHECKOUT", hasFunnel ? `${num(co)} <small class="muted">${pct(t.visitors ? co / t.visitors : null)}</small>` : "—", exp.kind === "page" ? "PostHog sample" : "of visitors"],
      ["PAID ORDERS", num(t.orders), `CVR ${pct(t.visitors ? t.orders / t.visitors : null, 2)}`],
      ["NET REVENUE", fmtMoney(t.revenue, exp.currency), t.visitors ? `${fmtMoney(t.revenue / t.visitors, exp.currency)} / visitor` : "—"],
      ["ROAS · EST.", roas(totalRoas), exp.spend ? `spend ${fmtMoney(exp.spend.amount, exp.spend.currency)}` : "no spend booked yet"],
    ];
    return `<div class="exp-kpis">${cells.map(([l, v, n]) => `<div class="exp-kpi"><div class="exp-kpi-label">${l}</div><div class="exp-kpi-value">${v}</div><div class="exp-kpi-note">${escape(n)}</div></div>`).join("")}</div>`;
  }

  function variantRows(exp) {
    const best = exp.variants.filter(v => v.visitors >= 30 && v.revenuePerVisitor != null).sort((a, b) => b.revenuePerVisitor - a.revenuePerVisitor)[0];
    const isLive = v => v.weight > 0 || v.visitors > 0 || v.orders > 0;
    return exp.variants.map(v => `
      <tr data-variant="${escape(v.id)}" data-control="${v.isControl ? 1 : 0}" ${isLive(v) ? "" : 'class="exp-folded" hidden'}>
        <td style="white-space:normal;min-width:180px;"><strong>${escape(v.label)}</strong>${v.isControl ? ' <span class="badge badge-archived">CONTROL</span>' : ""}<br>
          ${v.landingPath ? `<a class="muted" href="https://${escape(storefront())}${escape(v.landingPath)}" target="_blank" rel="noopener">${escape(v.landingPath)}</a>` : `<span class="muted">${escape(v.key)}</span>`}</td>
        <td><input class="input exp-pct" type="number" min="0" max="100" step="1" value="${v.weight}" aria-label="Traffic share for ${escape(v.label)}"> %</td>
        <td>${num(v.visitors)}</td>
        <td>${v.addToCart == null ? "—" : `${num(v.addToCart)} <span class="muted">${pct(v.addToCartRate)}</span>`}</td>
        <td>${v.checkout == null ? "—" : `${num(v.checkout)} <span class="muted">${pct(v.checkoutRate)}</span>`}</td>
        <td><strong>${num(v.orders)}</strong></td>
        <td>${pct(v.conversionRate, 2)}</td>
        <td>${fmtMoney(v.revenue, v.currency || exp.currency)}</td>
        <td class="${best && best === v ? "is-best" : ""}"><strong>${fmtMoney(v.revenuePerVisitor, v.currency || exp.currency)}</strong></td>
        <td>${roas(v.roas)}</td>
        <td>${uplift(v.revenuePerVisitorUpliftPercent)}</td>
      </tr>`).join("");
  }

  const PRESETS = [{ share: 0, text: "Off" }, { share: 20, text: "20% see it" }, { share: 50, text: "50 / 50" }, { share: 100, text: "Everyone" }];

  function card(exp) {
    const open = Boolean(openState()[exp.id]);
    const kind = KINDS[exp.kind];
    const folded = exp.variants.filter(v => !(v.weight > 0 || v.visitors > 0 || v.orders > 0)).length;
    const controls = exp.kind === "page"
      ? `<button class="btn btn-sm ${exp.running ? "" : "btn-primary"}" data-action="${exp.running ? "stop" : "start"}" type="button">${exp.running ? "Stop splitting" : "Start splitting"}</button>
         <button class="btn btn-sm" data-action="reconcile" type="button" title="Ask Shopify which landing page each recent order came from">Match orders now</button>`
      : `<button class="btn btn-sm ${exp.running ? "" : "btn-primary"}" data-action="${exp.running ? "pause" : "resume"}" type="button">${exp.running ? "Pause test" : "Resume test"}</button>
         <button class="btn btn-sm" data-action="reset" type="button" title="Start counting from now; earlier visitors and orders drop out of the table">Restart the clock</button>
         ${exp.links && exp.links.experiment ? `<a class="btn btn-sm btn-ghost" href="${escape(exp.links.experiment)}" target="_blank" rel="noopener">Open in PostHog</a>` : ""}`;
    return `
      <article class="exp" data-id="${escape(exp.id)}" data-kind="${exp.kind}" data-running="${exp.running}" data-open="${open}">
        <button class="exp-head" type="button" aria-expanded="${open}">
          <div class="exp-head-main">
            <div class="exp-kind">${kind.title} <span class="badge ${exp.running ? "badge-active" : "badge-draft"}">${exp.running ? "RUNNING" : exp.kind === "page" ? escape(exp.status || "STOPPED") : "PAUSED"}</span></div>
            <div class="exp-name">${escape(exp.name)}</div>
            <div class="exp-state">${splitSentence(exp)} <span class="muted">· since ${escape(when(exp.startedAt))}</span></div>
          </div>
          <div class="exp-sum">${summary(exp)}<svg class="exp-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>
        </button>
        <div class="exp-body" ${open ? "" : "hidden"}>
          ${kpis(exp)}
          <div class="exp-split">
            <div class="exp-split-sentence">${kind.blurb}</div>
            <div class="exp-controls">
              ${PRESETS.map(p => `<button class="btn btn-sm ${p.share === exp.share && exp.running ? "btn-primary" : ""}" data-share="${p.share}" type="button">${escape(p.text)}</button>`).join("")}
              <span class="exp-status"></span>
            </div>
          </div>
          ${exp.kind === "page" ? `
          <div class="exp-link">
            <span class="eyebrow">POINT YOUR ADS AT THIS LINK, NOT AT EITHER PAGE</span>
            <div class="exp-controls"><code>${escape(exp.links.splitter)}</code>
              <button class="btn btn-sm" data-action="copy" data-link="${escape(exp.links.splitter)}" type="button">Copy</button>
              <a class="btn btn-sm btn-ghost" href="${escape(exp.links.splitter)}?fc_internal=1" target="_blank" rel="noopener">Try it</a></div>
          </div>` : ""}
          <div class="exp-table-wrap">
            <table class="exp-table">
              <thead><tr><th>Variant</th><th>Traffic</th><th>Visitors</th><th>Add to cart</th><th>Checkout</th><th>Orders</th><th>CVR</th><th>Revenue</th><th>Rev / visitor</th><th>ROAS est.</th><th>vs control</th></tr></thead>
              <tbody>${variantRows(exp)}</tbody>
            </table>
          </div>
          <div class="exp-controls">
            ${controls}
            ${folded ? `<button class="btn btn-sm btn-ghost" data-action="unfold" type="button">Show ${folded} variant${folded > 1 ? "s" : ""} with no traffic</button>` : ""}
            <button class="btn btn-sm btn-ghost" data-action="save-split" type="button">Save an uneven split</button>
          </div>
          <div class="exp-note">${escape(exp.note || "")}${exp.spend ? ` ${escape(exp.spend.note)}` : ""}${exp.unattributed ? ` ${exp.unattributed} paid order(s) carried no variant and are not in the table.` : ""}</div>
          ${exp.sources ? `<div class="exp-sources">${Object.values(exp.sources).map(s => `<span class="badge ${s.state === "ACTUAL" ? "badge-active" : "badge-draft"}" title="${escape(s.error || "")}">${escape(s.name)} · ${s.state === "ACTUAL" ? "live" : "error"}</span>`).join("")}</div>` : ""}
        </div>
      </article>`;
  }

  // ---------------------------------------------------------------- loading

  async function load() {
    list.innerHTML = '<div class="exp-empty">Loading tests…</div>';
    const [pages, adaptive] = await Promise.allSettled([
      API.get("/api/page-experiments").then(async data => Promise.all((data.experiments || []).map(async exp => {
        try { const results = await API.get(`/api/page-experiments/${encodeURIComponent(exp.id)}/results`); return normalizePage({ ...exp, ...results }); }
        catch (error) { return { id: exp.id, name: exp.name, error: error.message }; }
      }))),
      API.get("/api/adaptive-experiments").then(data => (data.experiments || []).map(exp => exp.error ? { id: exp.key, name: exp.key, error: exp.error } : normalizeAdaptive(exp))),
    ]);
    const cards = [];
    const errors = [];
    for (const settled of [pages, adaptive]) {
      if (settled.status === "fulfilled") cards.push(...settled.value);
      else errors.push(settled.reason?.message || String(settled.reason));
    }
    const ready = cards.filter(c => !c.error).sort((a, b) => Number(b.running) - Number(a.running) || String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    const broken = cards.filter(c => c.error);
    list.innerHTML = [
      ...errors.map(e => `<div class="danger-note">${escape(e)}</div>`),
      ...broken.map(c => `<div class="danger-note"><strong>${escape(c.name)}</strong> — ${escape(c.error)}</div>`),
      ready.length ? ready.map(card).join("") : '<div class="exp-empty">No tests yet. “New page test” splits your ad traffic between two pages.</div>',
    ].join("");
    wire(ready);
  }

  // ---------------------------------------------------------------- behaviour

  function wire(exps) {
    list.querySelectorAll(".exp").forEach(node => {
      const exp = exps.find(e => String(e.id) === node.dataset.id);
      if (!exp) return;
      const head = node.querySelector(".exp-head");
      const body = node.querySelector(".exp-body");
      const status = node.querySelector(".exp-status");
      const inputs = [...node.querySelectorAll(".exp-pct")];
      const rowKey = input => input.closest("tr").dataset.variant;
      const sum = () => inputs.reduce((n, input) => n + (Number(input.value) || 0), 0);

      head.addEventListener("click", () => {
        const open = body.hidden;
        body.hidden = !open;
        node.dataset.open = String(open);
        head.setAttribute("aria-expanded", String(open));
        setOpen(exp.id, open);
      });

      const busy = on => node.querySelectorAll("button").forEach(b => { b.disabled = on; });

      async function saveSplit(message) {
        status.textContent = "Saving…";
        busy(true);
        try {
          if (exp.kind === "page") {
            await API.patch(`/api/page-experiments/${encodeURIComponent(exp.id)}/weights`, { variants: inputs.map(input => ({ id: rowKey(input), weight: Number(input.value) })) });
          } else {
            await API.patch(`/api/adaptive-experiments/${encodeURIComponent(exp.key)}/allocations`, { variants: inputs.map(input => ({ key: rowKey(input), percentage: Number(input.value) })) });
          }
          status.textContent = message;
          return true;
        } catch (error) { status.textContent = error.message; return false; }
        finally { busy(false); }
      }

      /** Put `share` on the challenger, the rest on control, nothing anywhere else. */
      async function applyShare(share) {
        const controlId = exp.control ? String(exp.control.id) : null;
        const challengerId = exp.challenger ? String(exp.challenger.id) : null;
        if (!challengerId) { status.textContent = "This test has nothing to compare against its control."; return; }
        inputs.forEach(input => {
          const key = rowKey(input);
          input.value = key === controlId ? 100 - share : key === challengerId ? share : 0;
        });
        const ok = await saveSplit(share === 0
          ? "Saved. The test is off — everyone sees the page as it is."
          : share === 100 ? "Saved. Everyone gets the new version; there is no control group to compare against."
            : `Saved. ${share}% of new visitors get it from now on; visitors already in the test keep what they were given.`);
        if (ok) await load();
      }

      node.querySelectorAll("[data-share]").forEach(button => button.addEventListener("click", async event => {
        const share = Number(event.currentTarget.dataset.share);
        if (share === 100 && !await Dialogs.confirm("Show the new version to everyone? Nobody stays on the control, so the test stops measuring anything.", { title: "Everyone sees it", okLabel: "Show everyone" })) return;
        if (share === 0 && !await Dialogs.confirm("Turn the test off? Every visitor goes back to the control. Nothing already counted is deleted.", { title: "Turn the test off", okLabel: "Turn it off" })) return;
        await applyShare(share);
      }));

      node.querySelector('[data-action="save-split"]')?.addEventListener("click", async () => {
        node.querySelectorAll("tr.exp-folded").forEach(row => { row.hidden = false; });
        if (sum() !== 100) { status.textContent = `The shares add up to ${sum()}; they must add up to 100.`; return; }
        if (await saveSplit("Saved. New visitors follow the new split immediately.")) await load();
      });
      node.querySelector('[data-action="unfold"]')?.addEventListener("click", event => {
        node.querySelectorAll("tr.exp-folded").forEach(row => { row.hidden = false; });
        event.currentTarget.remove();
      });

      const post = async (path, body, confirmText) => {
        if (confirmText && !await Dialogs.confirm(confirmText.text, { title: confirmText.title, okLabel: confirmText.ok })) return;
        busy(true);
        try { await API.post(path, body || {}); await load(); }
        catch (error) { Dialogs.alert(error.message); busy(false); }
      };
      node.querySelector('[data-action="pause"]')?.addEventListener("click", () => post(`/api/adaptive-experiments/${encodeURIComponent(exp.key)}/pause`, {}, { text: "Pause the test? Every visitor sees the control until you resume.", title: "Pause the test", ok: "Pause" }));
      node.querySelector('[data-action="resume"]')?.addEventListener("click", () => post(`/api/adaptive-experiments/${encodeURIComponent(exp.key)}/resume`));
      node.querySelector('[data-action="reset"]')?.addEventListener("click", () => post(`/api/adaptive-experiments/${encodeURIComponent(exp.key)}/reset`, {}, { text: "Restart the clock? The table starts counting from now. Nothing is deleted in PostHog or Shopify.", title: "Restart the clock", ok: "Restart" }));
      node.querySelector('[data-action="start"]')?.addEventListener("click", () => post(`/api/page-experiments/${encodeURIComponent(exp.id)}/status`, { status: "RUNNING" }));
      node.querySelector('[data-action="stop"]')?.addEventListener("click", () => post(`/api/page-experiments/${encodeURIComponent(exp.id)}/status`, { status: "STOPPED" }, { text: "Stop splitting? Everyone who follows the link goes to the control page from now on.", title: "Stop the test", ok: "Stop" }));
      node.querySelector('[data-action="reconcile"]')?.addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true; status.textContent = "Asking Shopify about recent orders…";
        try { const result = await API.post("/api/page-experiments/reconcile", { sinceDays: 14 }); status.textContent = `Matched ${result.matched ?? 0} order(s) from the last 14 days.`; await load(); }
        catch (error) { status.textContent = error.message; button.disabled = false; }
      });
      node.querySelector('[data-action="copy"]')?.addEventListener("click", async event => {
        const link = event.currentTarget.dataset.link;
        try { await navigator.clipboard.writeText(link); status.textContent = "Link copied."; }
        catch { Dialogs.alert(link, { title: "Copy this link into your ads" }); }
      });
    });
  }

  addButton?.addEventListener("click", async () => {
    const key = await Dialogs.prompt("Short name for the test, used in the link. Lowercase letters, numbers and dashes.", "", { title: "New page test", okLabel: "Next" });
    if (key === null) return;
    const pageA = await Dialogs.prompt("Path of the page you are testing against, the one that wins by default.", "/pages/", { title: "Control page", okLabel: "Next" });
    if (pageA === null) return;
    const pageB = await Dialogs.prompt("Path of the page you want to try.", "/pages/", { title: "Challenger page", okLabel: "Create" });
    if (pageB === null) return;
    try {
      await API.post("/api/page-experiments", { key, name: `${key} — A against B`, variants: [
        { key: "a", label: "Version A — control", landingPath: pageA, weight: 50 },
        { key: "b", label: "Version B", landingPath: pageB, weight: 50 },
      ] });
      await load();
      Dialogs.alert("Created, and not splitting yet. Open the card, press “Start splitting”, then point your ads at its link.", { title: "Page test created" });
    } catch (error) { Dialogs.alert(error.message); }
  });

  refreshButton?.addEventListener("click", load);
  load();
});

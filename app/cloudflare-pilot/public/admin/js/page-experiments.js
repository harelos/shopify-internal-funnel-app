/**
 * Whole-page tests panel on the Experiments screen.
 *
 * These are two different URLs, not two versions of one page, so the split
 * happens before anything renders: the ad points at the splitter link, which
 * sends each visitor on to one of the pages and remembers where it sent them.
 * The link is the one thing that has to leave this screen, so it sits at the
 * top of every card with a copy button.
 */
document.addEventListener("DOMContentLoaded", () => {
  const body = document.getElementById("page-tests-body");
  const refresh = document.getElementById("page-tests-refresh");
  const addButton = document.getElementById("page-tests-add");
  if (!body) return;

  const money = new Map();
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtMoney = (value, currency) => {
    const code = currency || "ILS";
    if (!money.has(code)) money.set(code, new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }));
    return money.get(code).format(Number(value || 0));
  };
  const when = iso => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "not started";
  const storefront = () => (document.body.dataset.storefront || "tigerbrandsglobal.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const splitterLink = key => `https://${storefront()}/apps/funnels/go/${encodeURIComponent(key)}`;

  const PRESETS = [{ share: 0, text: "Off" }, { share: 20, text: "20% see B" }, { share: 50, text: "50 / 50" }, { share: 100, text: "Everyone on B" }];

  function stateSentence(variants) {
    const control = variants.find(v => v.isControl) || variants[0];
    const rest = variants.filter(v => v !== control);
    const live = rest.filter(v => v.weight > 0);
    if (!live.length) return `Every visitor goes to <strong>${escape(control.label)}</strong>. Nothing is being compared.`;
    if (!control.weight) return `Every visitor goes to <strong>${escape(live[0].label)}</strong>. With nobody on ${escape(control.label)} there is nothing to compare against.`;
    if (live.length === 1) return `<strong>${live[0].weight}%</strong> of visitors go to <strong>${escape(live[0].label)}</strong>, the other <strong>${control.weight}%</strong> to ${escape(control.label)}.`;
    return `Split across ${variants.filter(v => v.weight > 0).length} pages.`;
  }

  function card(exp) {
    const variants = exp.variants || [];
    const running = exp.status === "RUNNING";
    const twoWay = variants.length === 2;
    const control = variants.find(v => v.isControl) || variants[0];
    const challenger = variants.find(v => v !== control);
    const share = challenger ? challenger.weight : 0;
    const link = splitterLink(exp.key);
    const totals = variants.reduce((sum, v) => ({ visitors: sum.visitors + v.visitors, orders: sum.orders + v.orders, revenue: sum.revenue + v.revenue }), { visitors: 0, orders: 0, revenue: 0 });
    const best = variants.filter(v => v.visitors >= 30).sort((a, b) => (b.revenue / b.visitors) - (a.revenue / a.visitors))[0];

    const rows = variants.map(v => {
      const perVisitor = v.visitors > 0 ? v.revenue / v.visitors : null;
      return `
      <tr data-variant-id="${escape(v.id)}" data-control="${v.isControl ? 1 : 0}">
        <td><strong>${escape(v.label)}</strong>${v.isControl ? ' <span class="eyebrow">CONTROL</span>' : ""}<br>
          <a href="https://${escape(storefront())}${escape(v.landingPath)}" target="_blank" rel="noopener" class="eyebrow">${escape(v.landingPath)}</a></td>
        <td><input class="input pe-weight" type="number" min="0" max="100" step="1" value="${v.weight}" style="width:72px;margin:0;padding:6px 8px;" aria-label="Traffic share for ${escape(v.label)}"> %</td>
        <td>${v.visitors}</td>
        <td><strong>${v.orders}</strong></td>
        <td>${v.conversionRate == null ? "—" : `${v.conversionRate}%`}</td>
        <td>${fmtMoney(v.revenue, v.currency)}</td>
        <td><strong>${perVisitor == null ? "—" : fmtMoney(perVisitor, v.currency)}</strong>${best && best.id === v.id ? ' <span class="uplift-positive">best</span>' : ""}</td>
      </tr>`;
    }).join("");

    return `
      <article class="pe-exp" data-id="${escape(exp.id)}" data-key="${escape(exp.key)}" style="display:grid;gap:12px;">
        <div class="actions" style="justify-content:space-between;">
          <div>
            <strong style="font-size:16px;">${escape(exp.name)}</strong>
            <span class="badge ${running ? "badge-active" : "badge-draft"}" style="margin-left:8px;">${running ? "RUNNING" : escape(exp.status)}</span>
            <div class="muted" style="margin-top:4px;">${running ? `Splitting since ${escape(when(exp.startedAt))}` : "Not splitting traffic"} · short name <code>${escape(exp.key)}</code></div>
          </div>
          <div class="actions">
            <button class="btn btn-sm ${running ? "" : "btn-primary"}" data-action="${running ? "stop" : "start"}" type="button">${running ? "Stop splitting" : "Start splitting"}</button>
            <button class="btn btn-sm" data-action="reconcile" type="button" title="Ask Shopify which landing page each recent order came from">Match orders now</button>
          </div>
        </div>

        <div style="display:grid;gap:8px;padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);">
          <div class="pe-state" style="font-size:14px;line-height:1.5;">${stateSentence(variants)}</div>
          ${twoWay ? `<div class="actions pe-presets" style="gap:6px;flex-wrap:wrap;">
            ${PRESETS.map(p => `<button class="btn btn-sm ${p.share === share ? "btn-primary" : ""}" data-share="${p.share}" type="button">${escape(p.text)}</button>`).join("")}
            <span class="muted pe-status" style="font-size:12px;"></span>
          </div>` : '<span class="muted pe-status" style="font-size:12px;"></span>'}
        </div>

        <div style="display:grid;gap:6px;padding:14px;border:1px solid var(--accent);border-radius:var(--radius);background:rgba(216,83,54,.05);">
          <span class="eyebrow">POINT YOUR ADS AT THIS LINK, NOT AT EITHER PAGE</span>
          <div class="actions" style="gap:8px;">
            <code class="pe-link" style="flex:1;overflow-wrap:anywhere;font-size:13px;">${escape(link)}</code>
            <button class="btn btn-sm" data-action="copy" data-link="${escape(link)}" type="button">Copy</button>
            <a class="btn btn-sm" href="${escape(link)}?fc_internal=1" target="_blank" rel="noopener">Try it</a>
          </div>
          <span class="muted" style="font-size:12px;">Visitors keep the page they were first given. Anyone opening a page directly is counted as an order but not as a visitor, so send all paid traffic through this link.</span>
        </div>

        <div class="results-table-wrap">
          <table class="table">
            <thead><tr><th>Page</th><th>Traffic</th><th>Visitors</th><th>Paid orders</th><th>CVR</th><th>Revenue</th><th>Revenue / visitor</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td><strong>Total</strong></td><td><span class="pe-total">100</span> %</td><td>${totals.visitors}</td><td>${totals.orders}</td><td></td><td>${fmtMoney(totals.revenue, variants[0] && variants[0].currency)}</td><td></td></tr></tfoot>
          </table>
        </div>

        <div class="actions" style="justify-content:space-between;">
          <span class="muted" style="font-size:12px;">Visitors are counted by the splitter. Orders come from the landing page Shopify recorded, so press "Match orders now" after a sale.</span>
          <button class="btn btn-sm" data-action="save-weights" type="button">Save an uneven split</button>
        </div>
      </article>`;
  }

  async function load() {
    body.innerHTML = '<p class="muted">Loading page tests…</p>';
    try {
      const { experiments } = await API.get("/api/page-experiments");
      if (!experiments.length) {
        body.innerHTML = '<p class="muted">No whole-page tests yet. Use “New page test” to send half your ad traffic to a different page.</p>';
        return;
      }
      const detailed = await Promise.all(experiments.map(async exp => {
        try {
          const results = await API.get(`/api/page-experiments/${encodeURIComponent(exp.id)}/results`);
          return { ...exp, variants: results.variants };
        } catch (error) { return { ...exp, variants: [], error: error.message }; }
      }));
      body.innerHTML = detailed.map(exp => exp.error
        ? `<div class="danger-note"><strong>${escape(exp.name)}</strong> — ${escape(exp.error)}</div>`
        : card(exp)).join("<hr style='border:0;border-top:1px solid var(--line);margin:16px 0;'>");
      wire();
    } catch (error) {
      body.innerHTML = `<div class="danger-note"><strong>Page tests could not be loaded.</strong><br>${escape(error.message)}</div>`;
    }
  }

  function wire() {
    body.querySelectorAll(".pe-exp").forEach(node => {
      const id = node.dataset.id;
      const inputs = [...node.querySelectorAll(".pe-weight")];
      const total = node.querySelector(".pe-total");
      const status = node.querySelector(".pe-status");
      const rowId = input => input.closest("tr").dataset.variantId;
      const sum = () => inputs.reduce((n, input) => n + (Number(input.value) || 0), 0);
      const refreshTotal = () => { const value = sum(); total.textContent = value; total.style.color = value === 100 ? "" : "var(--red)"; };
      inputs.forEach(input => input.addEventListener("input", refreshTotal));

      async function save(message) {
        status.textContent = "Saving…";
        node.querySelectorAll("button").forEach(b => { b.disabled = true; });
        try {
          await API.patch(`/api/page-experiments/${encodeURIComponent(id)}/weights`, { variants: inputs.map(input => ({ id: rowId(input), weight: Number(input.value) })) });
          status.textContent = message;
          return true;
        } catch (error) { status.textContent = error.message; return false; }
        finally { node.querySelectorAll("button").forEach(b => { b.disabled = false; }); }
      }

      node.querySelectorAll(".pe-presets button").forEach(button => button.addEventListener("click", async event => {
        const share = Number(event.currentTarget.dataset.share);
        if (share === 0 && !await Dialogs.confirm("Send every visitor to the control page? The other page stops getting traffic. Nothing already counted is deleted.", { title: "Stop the split", okLabel: "Send everyone to control" })) return;
        if (share === 100 && !await Dialogs.confirm("Send every visitor to the other page? Nobody stays on the control page, so the test stops measuring anything.", { title: "Everyone on B", okLabel: "Send everyone" })) return;
        inputs.forEach(input => { input.value = input.closest("tr").dataset.control === "1" ? 100 - share : share; });
        refreshTotal();
        if (await save("Saved. The next visitor follows the new split.")) await load();
      }));

      node.querySelector('[data-action="save-weights"]').addEventListener("click", async () => {
        if (sum() !== 100) { status.textContent = `The shares add up to ${sum()}; they must add up to 100.`; return; }
        if (await save("Saved. The next visitor follows the new split.")) await load();
      });

      node.querySelectorAll('[data-action="start"],[data-action="stop"]').forEach(button => button.addEventListener("click", async event => {
        const stopping = event.currentTarget.dataset.action === "stop";
        if (stopping && !await Dialogs.confirm("Stop splitting? Everyone who follows the link goes to the control page from now on.", { title: "Stop the test", okLabel: "Stop" })) return;
        event.currentTarget.disabled = true;
        try { await API.post(`/api/page-experiments/${encodeURIComponent(id)}/status`, { status: stopping ? "STOPPED" : "RUNNING" }); await load(); }
        catch (error) { Dialogs.alert(error.message); await load(); }
      }));

      node.querySelector('[data-action="reconcile"]').addEventListener("click", async event => {
        const button = event.currentTarget;
        button.disabled = true; status.textContent = "Asking Shopify about recent orders…";
        try {
          const result = await API.post("/api/page-experiments/reconcile", { sinceDays: 14 });
          status.textContent = `Matched ${result.matched ?? 0} order(s) from the last 14 days.`;
          await load();
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });

      node.querySelector('[data-action="copy"]').addEventListener("click", async event => {
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
      await API.post("/api/page-experiments", {
        key,
        name: `${key} — A against B`,
        variants: [
          { key: "a", label: "Version A — control", landingPath: pageA, weight: 50 },
          { key: "b", label: "Version B", landingPath: pageB, weight: 50 },
        ],
      });
      await load();
      Dialogs.alert("Created, and not splitting yet. Press “Start splitting”, then point your ads at the link on the card.", { title: "Page test created" });
    } catch (error) { Dialogs.alert(error.message); }
  });

  refresh?.addEventListener("click", load);
  load();
});

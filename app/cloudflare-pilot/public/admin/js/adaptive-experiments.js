/**
 * Adaptive page tests panel on the Experiments screen.
 *
 * One table per experiment: the traffic split (editable), then what each
 * variant did — visitors from PostHog, orders and revenue from Shopify. The
 * two sources are labelled separately so a blank from one never reads as a
 * zero from the other.
 */
document.addEventListener("DOMContentLoaded", () => {
  const body = document.getElementById("adaptive-body");
  const refresh = document.getElementById("adaptive-refresh");
  if (!body) return;
  const money = new Map();
  const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmtMoney = (value, currency) => {
    if (value == null) return "—";
    const code = currency || "ILS";
    if (!money.has(code)) money.set(code, new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 0 }));
    return money.get(code).format(value);
  };
  const pct = value => value == null ? "—" : `${(value * 100).toFixed(2)}%`;
  const uplift = value => value == null ? "—" : value === 0 ? "control" : `<span class="${value > 0 ? "uplift-positive" : "uplift-negative"}">${value > 0 ? "+" : ""}${value}%</span>`;
  const when = iso => iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "not started";
  const label = key => ({ control: "Control — page as it is", value_delta: "Value delta", shade_rescue: "Shade rescue", scroll_rescue: "Scroll rescue", full_adaptive: "All three" }[key] || key);

  function sourceBadge(source) {
    const ok = source.state === "ACTUAL";
    return `<span class="badge ${ok ? "badge-active" : "badge-draft"}" title="${escape(source.error || "")}">${escape(source.name)} · ${ok ? "live" : "error"}</span>`;
  }

  function renderExperiment(exp) {
    if (exp.error) return `<div class="danger-note"><strong>${escape(exp.key)}</strong> — ${escape(exp.error)}</div>`;
    const r = exp.results;
    const rows = r.variants.map(v => `
      <tr data-variant="${escape(v.key)}">
        <td><strong>${escape(label(v.key))}</strong><br><span class="eyebrow">${escape(v.key)}</span></td>
        <td><input class="input adaptive-pct" type="number" min="0" max="100" step="1" value="${v.percentage}" style="width:72px;margin:0;padding:6px 8px;" aria-label="Traffic share for ${escape(v.key)}"> %</td>
        <td>${v.visitors}</td><td>${v.addToCart}</td><td>${v.checkout}</td>
        <td><strong>${v.orders}</strong></td><td>${pct(v.conversionRate)}</td>
        <td>${fmtMoney(v.revenue, r.currency)}</td><td><strong>${fmtMoney(v.revenuePerVisitor, r.currency)}</strong></td>
        <td>${uplift(v.revenuePerVisitorUpliftPercent)}</td>
      </tr>`).join("");
    return `
      <article class="adaptive-exp" data-key="${escape(exp.key)}" style="display:grid;gap:12px;">
        <div class="actions" style="justify-content:space-between;">
          <div>
            <strong style="font-size:16px;">${escape(exp.name)}</strong>
            <span class="badge ${exp.active ? "badge-active" : "badge-draft"}" style="margin-left:8px;">${exp.active ? "RUNNING" : "PAUSED"}</span>
            <div class="muted" style="margin-top:4px;">Counting since ${when(exp.startedAt || exp.since)} · flag <code>${escape(exp.key)}</code>
              ${exp.links.experiment ? ` · <a href="${escape(exp.links.experiment)}" target="_blank" rel="noopener">open in PostHog</a>` : ""}</div>
          </div>
          <div class="actions">
            <button class="btn btn-sm ${exp.active ? "" : "btn-primary"}" data-action="${exp.active ? "pause" : "resume"}" type="button">${exp.active ? "Pause test" : "Resume test"}</button>
            <button class="btn btn-sm" data-action="reset" type="button" title="Start counting from now; earlier visitors and orders drop out of the table">Restart the clock</button>
          </div>
        </div>
        <div class="results-table-wrap">
          <table class="table">
            <thead><tr><th>Variant</th><th>Traffic</th><th>Visitors</th><th>Add to cart</th><th>Checkout</th><th>Paid orders</th><th>Purchase CVR</th><th>Net revenue</th><th>Revenue / visitor</th><th>vs control</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td><strong>Total</strong></td><td><span class="adaptive-total">100</span> %</td><td>${r.totals.visitors}</td><td colspan="2"></td><td>${r.totals.orders}</td><td></td><td>${fmtMoney(r.totals.revenue, r.currency)}</td><td colspan="2">${r.totals.unattributedOrders ? `<span class="muted">${r.totals.unattributedOrders} paid order(s) carried no variant and are not in the table</span>` : ""}</td></tr></tfoot>
          </table>
        </div>
        <div class="actions" style="justify-content:space-between;">
          <div class="actions">${sourceBadge(exp.sources.visitors)} ${sourceBadge(exp.sources.orders)}</div>
          <div class="actions"><span class="muted adaptive-split-status"></span><button class="btn btn-sm btn-primary" data-action="save-split" type="button">Save traffic split</button></div>
        </div>
        <div class="results-note"><strong>${escape(r.note)}</strong><br>Judge on revenue per visitor first, then purchase conversion. Upgrade clicks are diagnostic only.${r.mixedCurrencies ? " Revenue is in more than one currency and is not summed." : ""}</div>
      </article>`;
  }

  async function load() {
    body.innerHTML = '<p class="muted">Loading PostHog experiments and Shopify orders…</p>';
    try {
      const data = await API.get("/api/adaptive-experiments");
      if (!data.experiments.length) { body.innerHTML = '<p class="muted">No PostHog experiments yet.</p>'; return; }
      body.innerHTML = data.experiments.map(renderExperiment).join("<hr style='border:0;border-top:1px solid var(--line);margin:16px 0;'>");
      wire();
    } catch (error) {
      body.innerHTML = `<div class="danger-note"><strong>PostHog is not reachable from the app.</strong><br>${escape(error.message)}</div>`;
    }
  }

  function wire() {
    body.querySelectorAll(".adaptive-exp").forEach(card => {
      const key = card.dataset.key;
      const inputs = [...card.querySelectorAll(".adaptive-pct")];
      const total = card.querySelector(".adaptive-total");
      const status = card.querySelector(".adaptive-split-status");
      const sum = () => inputs.reduce((n, input) => n + (Number(input.value) || 0), 0);
      const refreshTotal = () => { const value = sum(); total.textContent = value; total.style.color = value === 100 ? "" : "var(--red)"; };
      inputs.forEach(input => input.addEventListener("input", refreshTotal));
      card.querySelector('[data-action="save-split"]').addEventListener("click", async event => {
        if (sum() !== 100) { status.textContent = `Percentages add up to ${sum()}; they must add up to 100.`; return; }
        event.currentTarget.disabled = true; status.textContent = "Saving…";
        try {
          await API.patch(`/api/adaptive-experiments/${encodeURIComponent(key)}/allocations`, {
            variants: inputs.map(input => ({ key: input.closest("tr").dataset.variant, percentage: Number(input.value) })),
          });
          status.textContent = "Saved. New visitors follow the new split immediately; returning visitors keep the variant they were given.";
        } catch (error) { status.textContent = error.message; }
        finally { event.currentTarget.disabled = false; }
      });
      card.querySelectorAll('[data-action="pause"],[data-action="resume"]').forEach(button => button.addEventListener("click", async () => {
        const action = button.dataset.action;
        if (action === "pause" && !confirm("Pause the test? Every visitor sees the normal page until you resume.")) return;
        button.disabled = true;
        try { await API.post(`/api/adaptive-experiments/${encodeURIComponent(key)}/${action}`, {}); await load(); }
        catch (error) { alert(error.message); button.disabled = false; }
      }));
      card.querySelector('[data-action="reset"]').addEventListener("click", async event => {
        if (!confirm("Restart the clock? The table starts counting from now. Nothing is deleted in PostHog or Shopify.")) return;
        event.currentTarget.disabled = true;
        try { await API.post(`/api/adaptive-experiments/${encodeURIComponent(key)}/reset`, {}); await load(); }
        catch (error) { alert(error.message); event.currentTarget.disabled = false; }
      });
    });
  }

  refresh?.addEventListener("click", load);
  load();
});

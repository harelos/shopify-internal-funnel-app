/**
 * Adaptive page tests panel on the Experiments screen.
 *
 * The everyday control is one row of buttons: what is being tested, and how
 * much traffic sees it. Clicking one saves straight away. Underneath, a table
 * shows what each variant did — visitors from PostHog, orders and revenue from
 * Shopify, labelled separately so a blank from one never reads as a zero from
 * the other. Variants with no traffic and no history stay folded away; the
 * per-variant boxes are still there for anyone who wants an uneven split.
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
  /** The same names without the "control" explainer, for sentences. */
  const shortLabel = key => ({ control: "the page as it is", value_delta: "Value delta", shade_rescue: "Shade rescue", scroll_rescue: "Scroll rescue", full_adaptive: "all three modules" }[key] || key);

  /** Share of visitors who see the new experience. Anything else is a fine-tune. */
  const PRESETS = [
    { share: 0, text: "Off" },
    { share: 20, text: "20% see it" },
    { share: 50, text: "50 / 50" },
    { share: 100, text: "Everyone" },
  ];

  const others = r => r.variants.filter(v => v.key !== "control");
  /** Which variant the buttons act on: the one carrying traffic, else the one with history, else the richest. */
  function targetKey(r) {
    const rest = others(r);
    if (!rest.length) return null;
    return (rest.find(v => v.percentage > 0)
      || rest.slice().sort((a, b) => (b.visitors || 0) - (a.visitors || 0)).find(v => v.visitors > 0)
      || rest.find(v => v.key === "full_adaptive")
      || rest[0]).key;
  }
  const shareOf = r => {
    const control = r.variants.find(v => v.key === "control");
    return control ? 100 - control.percentage : 0;
  };

  function stateSentence(r, share, target) {
    if (!share) return "The test is <strong>off</strong>. Every visitor sees the page as it is, and nothing is being learned.";
    if (share === 100) return `<strong>Every</strong> visitor sees ${escape(shortLabel(target))}. With nobody left on the normal page there is nothing to compare against.`;
    return `<strong>${share}%</strong> of new visitors see ${escape(shortLabel(target))}. The other <strong>${100 - share}%</strong> see the page as it is.`;
  }

  function simpleControls(r) {
    const target = targetKey(r);
    const share = shareOf(r);
    const rest = others(r);
    const picker = rest.length > 1 ? `
      <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:13px;">Testing
        <select class="adaptive-target" style="padding:6px 8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);font:inherit;font-size:13px;">
          ${rest.map(v => `<option value="${escape(v.key)}" ${v.key === target ? "selected" : ""}>${escape(label(v.key))}</option>`).join("")}
        </select>
      </label>` : "";
    return `
      <div class="adaptive-simple" style="display:grid;gap:10px;padding:14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--card);">
        <div class="adaptive-state" style="font-size:14px;line-height:1.5;">${stateSentence(r, share, target)}</div>
        <div class="actions" style="gap:10px;flex-wrap:wrap;align-items:center;">
          ${picker}
          <div class="actions adaptive-presets" style="gap:6px;">
            ${PRESETS.map(p => `<button class="btn btn-sm ${p.share === share ? "btn-primary" : ""}" data-share="${p.share}" type="button">${escape(p.text)}</button>`).join("")}
          </div>
          <span class="muted adaptive-split-status" style="font-size:12px;"></span>
        </div>
      </div>`;
  }

  function sourceBadge(source) {
    const ok = source.state === "ACTUAL";
    return `<span class="badge ${ok ? "badge-active" : "badge-draft"}" title="${escape(source.error || "")}">${escape(source.name)} · ${ok ? "live" : "error"}</span>`;
  }

  function renderExperiment(exp) {
    if (exp.error) return `<div class="danger-note"><strong>${escape(exp.key)}</strong> — ${escape(exp.error)}</div>`;
    const r = exp.results;
    // a variant is worth a row when it carries traffic or when it already has history
    const isLive = v => v.percentage > 0 || v.visitors > 0 || v.orders > 0;
    const folded = r.variants.filter(v => !isLive(v)).length;
    const rows = r.variants.map(v => `
      <tr data-variant="${escape(v.key)}" class="${isLive(v) ? "" : "adaptive-folded"}" ${isLive(v) ? "" : 'style="display:none;"'}>
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
        ${simpleControls(r)}
        <div class="results-table-wrap">
          <table class="table">
            <thead><tr><th>Variant</th><th>Traffic</th><th>Visitors</th><th>Add to cart</th><th>Checkout</th><th>Paid orders</th><th>Purchase CVR</th><th>Net revenue</th><th>Revenue / visitor</th><th>vs control</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr><td><strong>Total</strong></td><td><span class="adaptive-total">100</span> %</td><td>${r.totals.visitors}</td><td colspan="2"></td><td>${r.totals.orders}</td><td></td><td>${fmtMoney(r.totals.revenue, r.currency)}</td><td colspan="2">${r.totals.unattributedOrders ? `<span class="muted">${r.totals.unattributedOrders} paid order(s) carried no variant and are not in the table</span>` : ""}</td></tr></tfoot>
          </table>
        </div>
        <div class="actions" style="justify-content:space-between;">
          <div class="actions">${sourceBadge(exp.sources.visitors)} ${sourceBadge(exp.sources.orders)}</div>
          <div class="actions">
            ${folded ? `<button class="btn btn-sm btn-ghost" data-action="unfold" type="button">Show ${folded} variant${folded > 1 ? "s" : ""} with no traffic</button>` : ""}
            <button class="btn btn-sm" data-action="save-split" type="button">Save an uneven split</button>
          </div>
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
      const picker = card.querySelector(".adaptive-target");
      const inputFor = variant => inputs.find(input => input.closest("tr").dataset.variant === variant);
      const sum = () => inputs.reduce((n, input) => n + (Number(input.value) || 0), 0);
      const refreshTotal = () => { const value = sum(); total.textContent = value; total.style.color = value === 100 ? "" : "var(--red)"; };
      inputs.forEach(input => input.addEventListener("input", refreshTotal));

      async function save(message) {
        status.textContent = "Saving…";
        card.querySelectorAll(".adaptive-presets button, [data-action=\"save-split\"]").forEach(b => { b.disabled = true; });
        try {
          await API.patch(`/api/adaptive-experiments/${encodeURIComponent(key)}/allocations`, {
            variants: inputs.map(input => ({ key: input.closest("tr").dataset.variant, percentage: Number(input.value) })),
          });
          status.textContent = message;
          return true;
        } catch (error) { status.textContent = error.message; return false; }
        finally { card.querySelectorAll(".adaptive-presets button, [data-action=\"save-split\"]").forEach(b => { b.disabled = false; }); }
      }

      /** Put `share` of the traffic on one variant, the rest on control, nothing anywhere else. */
      async function applyShare(share, variant) {
        if (!variant) return;
        inputs.forEach(input => {
          const rowKey = input.closest("tr").dataset.variant;
          input.value = rowKey === "control" ? 100 - share : rowKey === variant ? share : 0;
        });
        refreshTotal();
        const ok = await save(share === 0
          ? "Saved. The test is off — everyone sees the page as it is."
          : share === 100
            ? "Saved. Everyone now sees the new experience; there is no control group to compare against."
            : `Saved. ${share}% of new visitors see it from now on. Visitors already in the test keep the version they were given.`);
        if (ok) await load();
      }

      card.querySelectorAll(".adaptive-presets button").forEach(button => button.addEventListener("click", async event => {
        const share = Number(event.currentTarget.dataset.share);
        const variant = picker ? picker.value : (inputs.map(i => i.closest("tr").dataset.variant).find(k => k !== "control"));
        if (share === 100 && !await Dialogs.confirm("Show the new experience to everyone? Nobody stays on the normal page, so the test stops measuring anything.", { title: "Everyone sees it", okLabel: "Show everyone" })) return;
        if (share === 0 && !await Dialogs.confirm("Turn the test off? Every visitor goes back to the normal page. Nothing already counted is deleted.", { title: "Turn the test off", okLabel: "Turn it off" })) return;
        await applyShare(share, variant);
      }));

      // moving the dropdown moves the traffic with it, so the sentence above stays true
      picker?.addEventListener("change", async event => {
        const control = inputFor("control");
        const share = control ? 100 - (Number(control.value) || 0) : 0;
        if (!share) { status.textContent = "Pick a split below to start testing this one."; return; }
        await applyShare(share, event.currentTarget.value);
      });

      card.querySelector('[data-action="unfold"]')?.addEventListener("click", event => {
        card.querySelectorAll("tr.adaptive-folded").forEach(row => { row.style.display = ""; });
        event.currentTarget.remove();
      });

      card.querySelector('[data-action="save-split"]').addEventListener("click", async event => {
        const button = event.currentTarget; // null after the first await
        card.querySelectorAll("tr.adaptive-folded").forEach(row => { row.style.display = ""; });
        card.querySelector('[data-action="unfold"]')?.remove();
        if (sum() !== 100) { status.textContent = `Percentages add up to ${sum()}; they must add up to 100.`; return; }
        button.disabled = true;
        const ok = await save("Saved. New visitors follow the new split immediately; returning visitors keep the variant they were given.");
        button.disabled = false;
        if (ok) await load();
      });

      card.querySelectorAll('[data-action="pause"],[data-action="resume"]').forEach(button => button.addEventListener("click", async () => {
        const action = button.dataset.action;
        if (action === "pause" && !await Dialogs.confirm("Pause the test? Every visitor sees the normal page until you resume.", { title: "Pause the test", okLabel: "Pause" })) return;
        button.disabled = true;
        try { await API.post(`/api/adaptive-experiments/${encodeURIComponent(key)}/${action}`, {}); await load(); }
        catch (error) { Dialogs.alert(error.message); button.disabled = false; }
      }));

      card.querySelector('[data-action="reset"]').addEventListener("click", async event => {
        const button = event.currentTarget;
        if (!await Dialogs.confirm("Restart the clock? The table starts counting from now. Nothing is deleted in PostHog or Shopify.", { title: "Restart the clock", okLabel: "Restart" })) return;
        button.disabled = true;
        try { await API.post(`/api/adaptive-experiments/${encodeURIComponent(key)}/reset`, {}); await load(); }
        catch (error) { Dialogs.alert(error.message); button.disabled = false; }
      });
    });
  }

  refresh?.addEventListener("click", load);
  load();
});

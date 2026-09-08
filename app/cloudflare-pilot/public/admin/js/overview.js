document.addEventListener("DOMContentLoaded", () => {
  const currency = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  let activeDays = 1;

  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const node = byId(id); if (node) node.textContent = value; };

  function timezoneParts(date, timeZone = "Asia/Jerusalem") {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  }

  function zonedTimeToUtc(parts, timeZone = "Asia/Jerusalem") {
    const expected = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
    let timestamp = expected;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const represented = timezoneParts(new Date(timestamp), timeZone);
      const representedTimestamp = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute, represented.second);
      timestamp -= representedTimestamp - expected;
    }
    return new Date(timestamp);
  }

  function dateRange(days) {
    const now = new Date();
    const local = timezoneParts(now);
    const localStart = new Date(Date.UTC(local.year, local.month - 1, local.day));
    localStart.setUTCDate(localStart.getUTCDate() - Math.max(0, days - 1));
    return {
      from: zonedTimeToUtc({
        year: localStart.getUTCFullYear(),
        month: localStart.getUTCMonth() + 1,
        day: localStart.getUTCDate(),
        hour: 0,
        minute: 0,
        second: 0,
      }).toISOString(),
      to: now.toISOString(),
    };
  }

  function queryForRange(days, extra = {}) {
    const range = dateRange(days);
    return new URLSearchParams({ from: range.from, to: range.to, mode: "production", ...extra }).toString();
  }

  function showModuleError(prefix, message) {
    const state = byId(`${prefix}-state`);
    if (state) {
      state.textContent = "Unavailable";
      state.className = "module-state error";
    }
    setText(`${prefix}-detail`, message);
  }

  async function loadShopifyStatus() {
    const pill = byId("shopify-connection-status");
    try {
      const status = await API.get("/api/shopify/status");
      const connected = Boolean(status.ok);
      if (pill) {
        pill.className = `connection-pill ${connected ? "connected" : "error"}`;
        pill.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${connected ? "Shopify connected" : "Shopify needs attention"}`;
      }
      setText("status-shopify", connected ? "Connected" : "Needs attention");
      return connected;
    } catch {
      if (pill) {
        pill.className = "connection-pill error";
        pill.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Connection unavailable';
      }
      setText("status-shopify", "Unavailable");
      return false;
    }
  }

  async function loadBusinessMetrics(days) {
    const data = await API.get(`/api/analytics/account?${queryForRange(days)}`);
    setText("metric-revenue", currency.format(Number(data.totalRevenue || 0)));
    setText("metric-orders", integer.format(Number(data.totalOrders || 0)));
    setText("metric-conversion", `${Number(data.overallConvRate || 0).toFixed(1)}%`);
    setText("metric-aov", currency.format(Number(data.aov || 0)));
    setText("metric-revenue-note", days === 1 ? "Today in Israel time" : `Last ${days} calendar days in Israel time`);
    setText("metric-orders-note", "Shopify-paid, test orders excluded");
    setText("growth-visitors", integer.format(Number(data.totalVisitors || 0)));
    setText("growth-detail", `${integer.format(Number(data.totalViews || 0))} page views and ${integer.format(Number(data.totalCtas || 0))} tracked calls to action.`);
    return data;
  }

  function resultCell(value, label, className = "") {
    return `<span class="result-cell ${className}"><strong>${value}</strong><span>${label}</span></span>`;
  }

  async function loadExperiment() {
    const slots = await API.get("/api/element-slots");
    const slot = slots.find(item => item.experiment?.status === "RUNNING") || slots.find(item => item.experiment);
    if (!slot?.experiment) {
      byId("experiment-results").innerHTML = '<p class="decision-note">No active experiment.</p>';
      setText("experiment-subtitle", "Create an experiment when you have a focused conversion hypothesis.");
      return null;
    }
    const results = await API.get(`/api/element-experiments/${encodeURIComponent(slot.experiment.id)}/results`);
    setText("experiment-title", slot.name || "Live experiment");
    setText("experiment-subtitle", `${String(results.status || "").toLowerCase()} · Shopify paid orders are the source of truth`);
    const rows = Array.isArray(results.rows) ? results.rows : Array.isArray(results.variants) ? results.variants : [];
    byId("experiment-results").innerHTML = rows.map(row => {
      const revenue = Number(row.netRevenue ?? row.revenue ?? 0);
      const orders = Number(row.paidOrders ?? row.orders ?? 0);
      const visitors = Number(row.exposedVisitors ?? row.visitors ?? 0);
      const cvr = Number(row.purchaseConversionRate ?? row.purchaseCvr ?? row.conversionRate ?? 0);
      return `<div class="experiment-row">
        <span class="variant-name"><strong>${escapeHtml(row.name || row.variantName || "Variant")}</strong><span>${row.isControl ? "Control" : "Variant"}</span></span>
        ${resultCell(integer.format(visitors), "visitors", "exposure-cell")}
        ${resultCell(integer.format(orders), "paid orders")}
        ${resultCell(currency.format(revenue), `${Number.isFinite(cvr) ? cvr.toFixed(1) : "0.0"}% CVR`)}
      </div>`;
    }).join("") || '<p class="decision-note">The test is running, but no results are available yet.</p>';
    setText("experiment-decision", results.recommendation || "Keep collecting data. No winner should be declared from this sample yet.");
    return results;
  }

  async function loadSupport() {
    try {
      const data = await API.get("/api/support/overview");
      const counts = data.counts || {};
      const mailbox = Array.isArray(data.mailboxes) ? data.mailboxes[0] : null;
      setText("support-open", integer.format(Number(counts.open || 0)));
      setText("support-detail", `${integer.format(Number(counts.escalated || 0))} escalated · ${integer.format(Number(counts.pendingReview || 0))} drafts awaiting review.`);
      const state = byId("support-state");
      if (state) {
        const healthy = mailbox && ["RUNNING", "IDLE"].includes(mailbox.agentStatus);
        state.textContent = healthy ? "Agent online" : "Review agent";
        state.className = `module-state ${healthy ? "" : "attention"}`.trim();
      }
      return data;
    } catch {
      showModuleError("support", "Support status could not be loaded.");
      return null;
    }
  }

  async function loadConcierge(days) {
    try {
      const data = await API.get(`/api/analytics/popup?${queryForRange(days, { experience: "concierge" })}`);
      const metrics = data.metrics || {};
      setText("concierge-sales", integer.format(Number(metrics.popupAttributedOrders || 0)));
      setText("concierge-detail", `${integer.format(Number(metrics.popupViews || 0))} opens · ${integer.format(Number(metrics.successfulLeads || 0))} saved leads · ${currency.format(Number(metrics.popupAttributedRevenue || 0))} verified revenue.`);
      const state = byId("concierge-state");
      if (state) {
        const hasSales = Number(metrics.popupAttributedOrders || 0) > 0;
        state.textContent = hasSales ? "Converting" : "No verified sales";
        state.className = `module-state ${hasSales ? "" : "attention"}`.trim();
      }
      return data;
    } catch {
      showModuleError("concierge", "Concierge performance could not be loaded.");
      return null;
    }
  }

  async function refresh(days) {
    activeDays = days;
    document.querySelectorAll(".range-button").forEach(button => button.classList.toggle("active", Number(button.dataset.days) === days));
    const banner = byId("truth-banner");
    const [connected, metrics, experiment] = await Promise.all([
      loadShopifyStatus(),
      loadBusinessMetrics(days).catch(() => null),
      loadExperiment().catch(() => null),
      loadSupport(),
      loadConcierge(days),
    ]);
    const healthy = connected && Boolean(metrics) && Boolean(experiment);
    if (banner) banner.className = `truth-banner ${healthy ? "" : "warning"}`.trim();
    setText("truth-status", healthy ? "Healthy" : "Needs review");
    setText("truth-title", healthy ? "Shopify revenue and experiment attribution are reporting" : "One or more reporting sources could not be verified");
    setText("truth-detail", healthy ? "Orders reconcile into the attribution ledger every five minutes." : "Financial decisions should remain anchored to Shopify until the warning is cleared.");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  document.querySelectorAll(".range-button").forEach(button => button.addEventListener("click", () => refresh(Number(button.dataset.days || 1))));
  refresh(activeDays);
});

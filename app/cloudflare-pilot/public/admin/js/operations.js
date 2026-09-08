document.addEventListener("DOMContentLoaded", () => {
  const REFRESH_MS = 60_000;
  const byId = id => document.getElementById(id);
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  function displayTime(value, fallback = "No signal yet") {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : time.format(date);
  }

  function stateClass(value) {
    const normalized = String(value || "UNKNOWN").toLowerCase();
    return ["attention", "partial", "unknown", "critical"].includes(normalized) ? normalized : "";
  }

  function healthCard({ name, state, value, label, metaLeft, metaRight }) {
    return `<article class="health-card">
      <div class="health-topline"><h2 class="health-name">${escapeHtml(name)}</h2><span class="health-state ${stateClass(state)}">${escapeHtml(readableState(state))}</span></div>
      <strong class="health-value">${escapeHtml(value)}</strong>
      <span class="health-label">${escapeHtml(label)}</span>
      <p class="health-meta"><span>${escapeHtml(metaLeft)}</span><span>${escapeHtml(metaRight)}</span></p>
    </article>`;
  }

  function readableState(value) {
    const labels = { CURRENT: "Current", RUNNING: "Running", IDLE: "Idle", MONITORING: "Monitoring", PARTIAL: "Partial", ATTENTION: "Attention", UNKNOWN: "Unknown" };
    return labels[value] || String(value || "Unknown").replaceAll("_", " ");
  }

  function renderSystems(systems) {
    const support = systems.support || {};
    const revenue = systems.revenue || {};
    const attribution = systems.attribution || {};
    const experiments = systems.experiments || {};
    const acquisition = systems.acquisition || {};
    const storefront = systems.storefront || {};
    const checkoutTracking = systems.checkoutTracking || {};
    const cards = [
      healthCard({ name: "Customer support", state: support.state, value: support.deliveryAttention ? `${support.deliveryAttention} need attention` : `${support.open || 0} open`, label: `${support.escalated || 0} escalated · ${support.queued || 0} queued`, metaLeft: displayTime(support.lastAgentRunAt), metaRight: support.automationMode === "AUTOSEND_LOW_RISK" ? "Low-risk automation" : readableState(support.automationMode) }),
      healthCard({ name: "Revenue ledger", state: revenue.state, value: `${integer.format(revenue.paidOrdersToday || 0)} paid orders`, label: "Today in Israel time", metaLeft: displayTime(revenue.lastReconciledAt), metaRight: "Shopify source" }),
      healthCard({ name: "Customer journeys", state: attribution.state, value: `${integer.format(attribution.verifiedJourneysToday || 0)} verified`, label: `of ${integer.format(attribution.paidOrdersToday || 0)} paid orders today`, metaLeft: `${integer.format(attribution.unattributedOrdersToday || 0)} unattributed`, metaRight: "Never guessed" }),
      healthCard({ name: "Experiments", state: experiments.state, value: `${integer.format(experiments.active || 0)} active`, label: "Tests using actual rendered exposure", metaLeft: displayTime(experiments.lastExposureAt), metaRight: "Paid outcomes" }),
      healthCard({ name: "Acquisition costs", state: acquisition.state, value: readableState(acquisition.quality), label: "Meta cost coverage", metaLeft: displayTime(acquisition.lastReconciledAt), metaRight: "Scheduled sync" }),
      healthCard({ name: "Storefront safeguards", state: storefront.state, value: storefront.failedChecks ? `${storefront.failedChecks} failed` : `${storefront.passedChecks || 0} passed`, label: "NovaHair order monitor", metaLeft: displayTime(storefront.lastWebhookAt), metaRight: storefront.purchaseKillSwitchActive ? "Purchase protection active" : "Purchase path open" }),
      healthCard({ name: "Checkout tracking", state: checkoutTracking.state, value: checkoutTracking.configured && checkoutTracking.endpointMatches ? "Pixel connected" : "Verification needed", label: "Shopify checkout events → first-party ledger", metaLeft: displayTime(checkoutTracking.lastVerifiedAt), metaRight: checkoutTracking.endpointMatches ? "Endpoint verified" : "Check configuration" }),
    ];
    byId("health-grid").innerHTML = cards.join("");
  }

  function renderIncidents(incidents) {
    const list = byId("incident-list");
    if (!incidents.length) {
      list.innerHTML = '<div class="all-clear"><strong>No verified issue requires action right now.</strong><br>The dashboard will keep checking once per minute.</div>';
      return;
    }
    list.innerHTML = incidents.map(item => `<div class="incident-row ${String(item.severity || "").toLowerCase()}">
      <span class="incident-dot" aria-hidden="true"></span>
      <div class="incident-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.action)}</span></div>
    </div>`).join("");
  }

  function renderSummary(data) {
    const summary = data.summary || {};
    const state = summary.state || "UNKNOWN";
    const panel = byId("operations-summary");
    panel.className = `operations-summary ${state === "CRITICAL" ? "critical" : state === "ATTENTION" ? "attention" : ""}`.trim();
    byId("summary-state").textContent = state === "HEALTHY" ? "All clear" : state === "CRITICAL" ? "Action required" : "Review";
    byId("summary-title").textContent = summary.actionCount ? `${summary.actionCount} verified ${summary.actionCount === 1 ? "issue needs" : "issues need"} attention` : "Live systems are reporting normally";
    byId("summary-detail").textContent = "Shopify remains the financial source of truth. Storefront behavior is read-only from this workspace.";
    byId("summary-time").textContent = `Last checked ${displayTime(data.generatedAt)}`;
    const pill = byId("health-pill");
    pill.className = `connection-pill ${state === "HEALTHY" ? "connected" : "error"}`;
    pill.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${state === "HEALTHY" ? "Systems reporting" : "Attention needed"}`;
  }

  async function refresh() {
    const button = byId("refresh-operations");
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      const data = await API.get("/api/operations/health");
      renderSummary(data);
      renderSystems(data.systems || {});
      renderIncidents(Array.isArray(data.incidents) ? data.incidents : []);
    } catch (error) {
      byId("operations-summary").className = "operations-summary critical";
      byId("summary-state").textContent = "Unavailable";
      byId("summary-title").textContent = "Operations health could not be verified";
      byId("summary-detail").textContent = error?.message || "Refresh the embedded app and try again.";
      byId("incident-list").innerHTML = '<div class="incident-row critical"><span class="incident-dot" aria-hidden="true"></span><div class="incident-copy"><strong>The health endpoint is unavailable.</strong><span>No live system is changed by this reporting failure.</span></div></div>';
    } finally {
      button.disabled = false;
      button.textContent = "Refresh now";
    }
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  byId("refresh-operations").addEventListener("click", refresh);
  refresh();
  window.setInterval(refresh, REFRESH_MS);
});

document.addEventListener("DOMContentLoaded", () => {
  const client = window.API;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const pct = value => value == null ? "—" : `${Number(value).toFixed(2)}%`;
  const money = value => value == null ? "—" : `₪${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const integer = value => Number(value || 0).toLocaleString("en-US");

  function showError(message) {
    const node = $("error");
    node.hidden = false;
    node.textContent = message;
    clearTimeout(showError.timer);
    showError.timer = setTimeout(() => { node.hidden = true; }, 7000);
  }

  function renderBreakdown(rootId, rows) {
    const root = $(rootId);
    if (!rows?.length) {
      root.innerHTML = '<div class="empty">No qualified sessions in this window.</div>';
      return;
    }
    root.innerHTML = rows.map(row => `<div class="mini-row"><span title="${esc(row.key)}">${esc(row.key)}</span><b>${integer(row.sessions)}</b></div>`).join("");
  }

  function renderReasons(rows) {
    const root = $("reason-list");
    if (!rows?.length) {
      root.innerHTML = '<div class="empty">No reconstructed sessions.</div>';
      return;
    }
    root.innerHTML = rows.map(row => `<div class="reason-row"><strong>${esc(row.reason)}</strong><span class="reason-badge ${esc(row.status)}">${esc(row.status)}</span><span>${integer(row.sessions)}</span></div>`).join("");
  }

  function renderSessions(rows) {
    const body = $("session-body");
    if (!rows?.length) {
      body.innerHTML = '<tr><td colspan="9">No sessions in this range.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(row => {
      const when = row.startedAt ? new Date(row.startedAt).toLocaleString() : "—";
      return `<tr>
        <td>${esc(when)}</td>
        <td title="${esc(row.landingPath || "UNKNOWN")}">${esc(row.landingPath || "UNKNOWN")}</td>
        <td>${esc(row.countryCode || "UNKNOWN")}</td>
        <td>${esc(row.utmSource || "UNKNOWN")}</td>
        <td>${row.hasCheckout ? "Yes" : "No"}</td>
        <td>${integer(row.purchaseCount)}</td>
        <td>${money(row.revenue)}</td>
        <td><span class="status-pill ${esc(row.status)}">${esc(row.status)}</span></td>
        <td>${esc(row.reason)}</td>
      </tr>`;
    }).join("");
  }

  function render(data) {
    const metrics = data.metrics || {};
    const classification = data.classification || {};
    const mode = String(data.dataMode || "UNKNOWN").toUpperCase();
    $("data-mode").textContent = mode;
    $("data-mode").className = `ci-chip ${mode === "LIVE" ? "live" : "test"}`;
    $("coverage").textContent = pct(metrics.classificationCoveragePct);
    $("qualified-sessions").textContent = integer(metrics.qualifiedSessions);
    $("qualified-share").textContent = `${pct(classification.qualifiedPctOfAll)} of ${integer(metrics.allSessions)} reconstructed sessions`;
    $("landing-checkout").textContent = pct(metrics.landingToCheckoutPct);
    $("checkout-purchase").textContent = pct(metrics.checkoutToPurchasePct);
    $("landing-purchase").textContent = pct(metrics.landingToPurchasePct);
    $("revenue-session").textContent = money(metrics.revenuePerQualifiedSession);
    $("qualified-revenue").textContent = money(metrics.qualifiedRevenue);
    $("qualified-orders").textContent = `${integer(metrics.qualifiedOrders)} attributed order${Number(metrics.qualifiedOrders) === 1 ? "" : "s"}`;
    $("status-qualified").textContent = `${integer(metrics.qualifiedSessions)} · ${pct(classification.qualifiedPctOfAll)}`;
    $("status-excluded").textContent = `${integer(metrics.excludedSessions)} · ${pct(classification.excludedPctOfAll)}`;
    $("status-unknown").textContent = `${integer(metrics.unknownSessions)} · ${pct(classification.unknownPctOfAll)}`;
    $("unknown-count").textContent = integer(metrics.unknownSessions);
    $("unattributed-orders").textContent = integer(metrics.unattributedOrders);
    $("unattributed-revenue").textContent = money(metrics.unattributedRevenue);
    $("target-geo").textContent = (data.policy?.targetCountries || []).join(", ") || "Not configured";
    const unknownPct = Number(classification.unknownPctOfAll || 0);
    $("quality-note").textContent = unknownPct > 20
      ? `${unknownPct.toFixed(2)}% of sessions are UNKNOWN. Do not treat clean CVR as representative until telemetry coverage improves.`
      : "Unknown sessions remain outside the clean denominator. No geo or attribution is guessed.";
    renderReasons(classification.reasons);
    renderBreakdown("landing-breakdown", data.breakdowns?.qualifiedByLandingPath);
    renderBreakdown("source-breakdown", data.breakdowns?.qualifiedBySource);
    renderSessions(data.recentSessions);
  }

  async function load() {
    $("refresh").disabled = true;
    try {
      const range = $("range").value || "7d";
      const data = await client.get(`/api/commerce-intelligence/qualified-traffic?range=${encodeURIComponent(range)}`);
      render(data);
    } catch (error) {
      showError(error?.message || String(error));
    } finally {
      $("refresh").disabled = false;
    }
  }

  $("refresh")?.addEventListener("click", load);
  $("range")?.addEventListener("change", load);
  load();
});

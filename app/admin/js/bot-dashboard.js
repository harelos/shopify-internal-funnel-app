document.addEventListener("DOMContentLoaded", () => {
  const client = window.API;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const moneyIls = value => value == null || !Number.isFinite(Number(value)) ? "—" : `₪${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  function showError(message) {
    const node = $("dashboard-error");
    node.hidden = false;
    node.textContent = message;
    clearTimeout(showError.timer);
    showError.timer = setTimeout(() => { node.hidden = true; }, 6000);
  }

  async function safeGet(url) {
    try {
      return { ok: true, data: await client.get(url) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  function renderConfig(response) {
    if (!response?.ok) {
      $("kpi-allocation").textContent = "Unavailable";
      $("offer-state").textContent = "Config unavailable";
      $("offer-state").classList.add("bad");
      return;
    }
    const config = response.data?.config || {};
    const models = Array.isArray(config.models) ? config.models : [];
    const allocation = models.reduce((sum, item) => sum + Math.max(0, Number(item.trafficPct || 0)), 0);
    $("kpi-allocation").textContent = `${Number(allocation.toFixed(2))}%`;
    $("kpi-model-count").textContent = `${models.length} configured model variant${models.length === 1 ? "" : "s"}`;

    const offers = config.offers || {};
    $("offer-first").textContent = `${Number(offers.firstPct || 0)}% only if authorized`;
    $("offer-second").textContent = `${Number(offers.secondPct || 0)}% only if authorized`;
    const marginConfigured = offers.marginFloorIls != null && Number.isFinite(Number(offers.marginFloorIls));
    const maxPct = Number(offers.maxPct || 0);
    $("offer-state").textContent = marginConfigured ? "Economics gate configured" : "No economics = no auto offer";
    $("offer-state").classList.toggle("safe", marginConfigured);
    $("offer-state").classList.toggle("warn", !marginConfigured);
    $("offer-rules").innerHTML = [
      `Absolute max ${maxPct}%`,
      `First offer after ${Number(offers.firstMinMessages || 0)} messages`,
      `Second offer after ${Number(offers.secondMinMessages || 0)} messages`,
      marginConfigured ? "Margin guard configured" : "Margin guard missing",
      "Eligibility required",
      "Previous-offer history required",
      "Server-authorized issuance only",
    ].map(rule => `<span>${esc(rule)}</span>`).join("");
  }

  function renderKnowledge(response) {
    $("kpi-knowledge").textContent = response?.ok ? String(response.data?.count ?? response.data?.packs?.length ?? 0) : "Unavailable";
  }

  function renderProviders(response) {
    const root = $("provider-list");
    if (!response?.ok) {
      $("kpi-providers").textContent = "Unavailable";
      root.innerHTML = '<div class="loading-row">Provider status could not be loaded.</div>';
      return;
    }
    const providers = response.data?.providers || {};
    const entries = Object.entries(providers).filter(([key]) => key !== "pricingConfigured");
    const ready = entries.filter(([, value]) => Boolean(value)).length;
    $("kpi-providers").textContent = `${ready}/${entries.length}`;
    $("kpi-pricing").textContent = providers.pricingConfigured ? "Exact model pricing configured" : "AI cost pricing missing or incomplete";
    root.innerHTML = entries.map(([key, value]) => `<span class="provider-item ${value ? "ready" : ""}"><i></i>${esc(key)}: ${value ? "ready" : "not configured"}</span>`).join("") || '<div class="loading-row">No provider data.</div>';
  }

  function renderAnalytics(response) {
    const body = $("model-table-body");
    if (!response?.ok) {
      $("kpi-conversations").textContent = "Unavailable";
      body.innerHTML = '<tr><td colspan="6">Analytics unavailable.</td></tr>';
      return;
    }
    const data = response.data || {};
    $("kpi-conversations").textContent = String(data.conversations ?? 0);
    const rows = Object.entries(data.models || {});
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6">No model response data in this window.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(([key, row]) => `<tr>
      <td><strong>${esc(key)}</strong></td>
      <td>${esc(row.conversations ?? 0)}</td>
      <td>${esc(row.conversionRate ?? 0)}%</td>
      <td>${row.avgLatencyMs == null ? "—" : `${esc(row.avgLatencyMs)}ms`}</td>
      <td>${esc(row.purchases ?? 0)}</td>
      <td>${esc(moneyIls(row.revenueIls))}</td>
    </tr>`).join("");
  }

  async function loadDashboard() {
    $("refresh-dashboard").disabled = true;
    const [config, providers, knowledge, analytics] = await Promise.all([
      safeGet("/api/bot/config"),
      safeGet("/api/bot/providers/status"),
      safeGet("/api/bot/knowledge"),
      safeGet("/api/bot/analytics?range=7d"),
    ]);
    renderConfig(config);
    renderProviders(providers);
    renderKnowledge(knowledge);
    renderAnalytics(analytics);
    const failures = [config, providers, knowledge, analytics].filter(item => !item.ok);
    if (failures.length) showError(`${failures.length} dashboard data source${failures.length === 1 ? "" : "s"} failed. The dashboard kept the remaining data visible.`);
    $("refresh-dashboard").disabled = false;
  }

  $("refresh-dashboard")?.addEventListener("click", loadDashboard);
  loadDashboard();
});

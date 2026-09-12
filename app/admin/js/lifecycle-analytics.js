document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("lifecycle-status");
  const rangeBadge = document.getElementById("range-badge");
  const dateFrom = document.getElementById("date-from");
  const dateTo = document.getElementById("date-to");
  const btnApplyDates = document.getElementById("btn-apply-dates");
  const rangeButtons = document.querySelectorAll("#range-buttons button");
  const btnRefresh = document.getElementById("btn-refresh");

  const metricSent = document.getElementById("metric-sent");
  const metricDelivered = document.getElementById("metric-delivered");
  const metricOpened = document.getElementById("metric-opened");
  const metricProviderClicked = document.getElementById("metric-provider-clicked");
  const metricFirstPartyClicked = document.getElementById("metric-first-party-clicked");
  const metricFailed = document.getElementById("metric-failed");
  const metricDeliveryRate = document.getElementById("metric-delivery-rate");
  const metricOpenRate = document.getElementById("metric-open-rate");
  const metricClickRate = document.getElementById("metric-click-rate");
  const metricFirstPartyClickRate = document.getElementById("metric-first-party-click-rate");
  const metricShopifyOrders = document.getElementById("metric-shopify-orders");
  const metricShopifyRevenue = document.getElementById("metric-shopify-revenue");
  const metricAttributedOrders = document.getElementById("metric-attributed-orders");
  const metricAttributedRevenue = document.getElementById("metric-attributed-revenue");

  const flowsUpdated = document.getElementById("flows-updated");
  const flowTableBody = document.getElementById("flow-body");
  const emailTableBody = document.getElementById("email-body");
  const healthBanner = document.getElementById("health-banner");
  const healthStatus = document.getElementById("health-status");
  const healthBody = document.getElementById("health-body");

  const state = {
    currentDays: "30",
    from: "",
    to: "",
    loadedAt: null,
  };

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "var(--accent)" : "var(--green)";
  }

  function setRangeLabel(custom = null) {
    if (!rangeBadge) return;
    if (custom) {
      rangeBadge.textContent = custom;
      return;
    }
    if (state.currentDays === "all") {
      rangeBadge.textContent = "Range: all available";
      return;
    }
    rangeBadge.textContent = `Range: last ${state.currentDays} days`;
  }

  function buildQueryParams() {
    if (state.from || state.to) {
      const q = new URLSearchParams();
      if (state.from) q.set("from", state.from);
      if (state.to) q.set("to", state.to);
      return q.toString();
    }
    if (state.currentDays !== "all" && state.currentDays !== "custom") {
      return `from=${encodeURIComponent(defaultFromIso(parseInt(state.currentDays, 10)))}&to=${encodeURIComponent(new Date().toISOString())}`;
    }
    return "";
  }

  function defaultFromIso(daysBack) {
    const from = new Date();
    from.setDate(from.getDate() - daysBack);
    return from.toISOString();
  }

  function safeText(value) {
    return String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[c]));
  }

  function formatRate(value) {
    return `${Number(value || 0).toFixed(2)}%`;
  }

  function formatMoneyByCurrency(values = {}) {
    const keys = Object.keys(values || {});
    if (keys.length === 0) return "₪0";
    return keys
      .map((currency) => {
        const amount = Number(values[currency] || 0);
        return `${currency || "ILS"} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      })
      .join(" | ");
  }

  function formatMoney(values = {}, fallbackCurrency = "ILS") {
    const keys = Object.keys(values || {});
    if (keys.length === 0) return `${fallbackCurrency}0.00`;
    const first = values[Object.keys(values)[0]];
    const currency = Object.keys(values)[0] ?? fallbackCurrency;
    return `${currency} ${Number(first || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function setTotalsCard(metrics, totals) {
    if (!metrics) return;
    const flows = metrics.flows || [];
    const totalsAggregate = flows.reduce((acc, flow) => {
      const flowMetrics = flow.metrics || {};
      acc.sent += Number(flowMetrics.sent || 0);
      acc.delivered += Number(flowMetrics.delivered || 0);
      acc.opened += Number(flowMetrics.opened || 0);
      acc.providerClicked += Number(flowMetrics.providerClicked || 0);
      acc.firstPartyClicked += Number(flowMetrics.firstPartyClicked || 0);
      acc.failed += Number(flowMetrics.failed || 0) + Number(flowMetrics.suppressed || 0);
    return acc;
    }, {
      sent: 0,
      delivered: 0,
      opened: 0,
      providerClicked: 0,
      firstPartyClicked: 0,
      failed: 0,
    });

    metricSent.textContent = totalsAggregate.sent.toLocaleString();
    metricDelivered.textContent = totalsAggregate.delivered.toLocaleString();
    metricOpened.textContent = totalsAggregate.opened.toLocaleString();
    metricProviderClicked.textContent = totalsAggregate.providerClicked.toLocaleString();
    metricFirstPartyClicked.textContent = totalsAggregate.firstPartyClicked.toLocaleString();
    metricFailed.textContent = totalsAggregate.failed.toLocaleString();
    metricDeliveryRate.textContent = totalsAggregate.sent > 0
      ? formatRate((totalsAggregate.delivered / totalsAggregate.sent) * 100)
      : "0%";
    metricOpenRate.textContent = totalsAggregate.delivered > 0
      ? formatRate((totalsAggregate.opened / totalsAggregate.delivered) * 100)
      : "0%";
    metricClickRate.textContent = totalsAggregate.delivered > 0
      ? formatRate((totalsAggregate.providerClicked / totalsAggregate.delivered) * 100)
      : "0%";
    metricFirstPartyClickRate.textContent = totalsAggregate.delivered > 0
      ? formatRate((totalsAggregate.firstPartyClicked / totalsAggregate.delivered) * 100)
      : "0%";

    if (totals) {
      metricShopifyOrders.textContent = Number(totals.shopifyOrders || 0).toLocaleString();
      metricShopifyRevenue.textContent = formatMoneyByCurrency(totals.shopifyRevenueByCurrency || {});
      metricAttributedOrders.textContent = Number(totals.firstPartyAttributedOrders || 0).toLocaleString();
      metricAttributedRevenue.textContent = formatMoneyByCurrency(totals.firstPartyAttributedRevenueByCurrency || {});
    }
  }

  function setHealth() {
    return API.get("/api/lifecycle/admin/health")
      .then((health) => {
        healthBanner.style.display = "block";
        if (!health || health.ok === false) {
          healthStatus.textContent = "Health unavailable";
          healthStatus.style.color = "var(--accent)";
          healthBody.innerHTML = `<p class=\"muted\">Worker health endpoint unavailable or unauthorized.</p>`;
          return;
        }
        const status = health.status || "unknown";
        healthStatus.textContent = status.toUpperCase();
        healthStatus.style.color = status === "ok" ? "var(--green)" : "var(--accent)";
        healthBody.innerHTML = `
          <div class=\"grid-4\" style=\"grid-template-columns: repeat(4, 1fr);\">
            <div><strong>${health.workerAlive ? "Worker" : "Worker"}</strong><br><span class=\"muted\">${health.workerAlive ? "up" : "down"}</span></div>
            <div><strong>Last Shopify Sync</strong><br><span class=\"muted\">${health.shopify?.lastSync || "n/a"}</span></div>
            <div><strong>Emails /24h</strong><br><span class=\"muted\">${health.lifecycle?.emailsSentLast24h || 0}</span></div>
            <div><strong>Recoveries /24h</strong><br><span class=\"muted\">${health.lifecycle?.recoveriesLast24h || 0}</span></div>
          </div>
        `;
      })
      .catch(() => {
        healthBanner.style.display = "block";
        healthStatus.textContent = "Health unavailable";
        healthStatus.style.color = "var(--accent)";
        healthBody.innerHTML = `<p class=\"muted\">Worker health endpoint could not be reached.</p>`;
      });
  }

  function setFlowRows(flows) {
    const totalEmails = flows.reduce((acc, flow) => acc + (flow.emails?.length || 0), 0);
    flowsUpdated.textContent = `Loaded ${flows.length} flows · ${totalEmails} emails`;

    flowTableBody.innerHTML = flows.map((flow) => {
      const metrics = flow.metrics || {};
      const revenue = formatMoneyByCurrency(metrics.attributedRevenueByCurrency || {});
      return `
        <tr>
          <td><strong>${safeText(flow.name || flow.flow || "")}</strong></td>
          <td><span class="badge badge-kind">${safeText((flow.status || "unknown").toUpperCase())}</span></td>
          <td>${Number(metrics.sent || 0).toLocaleString()}</td>
          <td>${Number(metrics.delivered || 0).toLocaleString()}</td>
          <td>${formatRate(metrics.openRate || 0)} (${Number(metrics.opened || 0)})</td>
          <td>${formatRate(metrics.clickRate || 0)} (${Number(metrics.providerClicked || 0)})</td>
          <td>${formatRate(metrics.firstPartyClickRate || 0)} (${Number(metrics.firstPartyClicked || 0)})</td>
          <td>${Number(metrics.attributedOrders || 0).toLocaleString()}</td>
          <td>${revenue || "—"}</td>
          <td><a href="${safeText(flow.automationUrl || "#")}" target="_blank" rel="noopener noreferrer">${flow.automationUrl ? "Open automation" : "N/A"}</a></td>
        </tr>
      `;
    }).join("");

    const emails = [];
    for (const flow of flows) {
      for (const email of (flow.emails || [])) {
        emails.push({ ...email, flowName: flow.name, flowStatus: flow.status, automationUrl: flow.automationUrl });
      }
    }

    if (emails.length === 0) {
      emailTableBody.innerHTML = `<tr><td colspan=\"12\" class=\"muted\">No emails returned yet.</td></tr>`;
      return;
    }

    emailTableBody.innerHTML = emails.map((email) => {
      const metrics = email.metrics || {};
      const revenue = formatMoneyByCurrency(metrics.attributedRevenueByCurrency || {});
      const templateLink = email.templateUrl
        ? `<a href="${safeText(email.templateUrl)}" target="_blank" rel="noopener noreferrer">Template</a>`
        : "N/A";
      return `
        <tr>
          <td>${safeText(email.flowName || "")}</td>
          <td>#${Number(email.number || 0)} · ${safeText(email.timing || "")}</td>
          <td>${safeText(email.subject || "")}</td>
          <td>${safeText(email.timing || "")}</td>
          <td>${Number(metrics.sent || 0).toLocaleString()}</td>
          <td>${Number(metrics.delivered || 0).toLocaleString()}</td>
          <td>${formatRate(metrics.openRate || 0)} (${Number(metrics.opened || 0)})</td>
          <td>${formatRate(metrics.clickRate || 0)} (${Number(metrics.providerClicked || 0)})</td>
          <td>${formatRate(metrics.firstPartyClickRate || 0)} (${Number(metrics.firstPartyClicked || 0)})</td>
          <td>${Number(metrics.attributedOrders || 0).toLocaleString()}</td>
          <td>${revenue || "—"}</td>
          <td>${templateLink}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadReports() {
    setStatus("Loading...");
    setRangeLabel(state.currentDays === "all" ? null : `Range: last ${state.currentDays} days`);

    try {
      const params = buildQueryParams();
      const query = params ? `?${params}` : "";
      const [flows, analytics, health] = await Promise.all([
        API.get(`/api/lifecycle/admin/flows`),
        API.get(`/api/lifecycle/admin/analytics${query}`),
        setHealth(),
      ]);

      if (!flows.ok || !analytics.ok) {
        throw new Error("Lifecycle admin endpoints returned not-ok");
      }

      const totals = analytics.totals || {};
      setTotalsCard(analytics, totals);
      setFlowRows(analytics.flows || []);
      state.loadedAt = new Date().toLocaleTimeString();
      setStatus(`Loaded at ${state.loadedAt}`, false);
    } catch (err) {
      setStatus(`Load failed: ${err.message}`, true);
    }
  }

  rangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      rangeButtons.forEach((btn) => btn.classList.remove("btn-primary", "active"));
      button.classList.add("btn-primary", "active");
      state.currentDays = button.dataset.days || "30";
      state.from = "";
      state.to = "";
      dateFrom.value = "";
      dateTo.value = "";
      setRangeLabel();
      loadReports();
    });
  });

  btnApplyDates?.addEventListener("click", () => {
    rangeButtons.forEach((btn) => btn.classList.remove("btn-primary", "active"));
    state.currentDays = "custom";
    state.from = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00.000Z`).toISOString() : "";
    state.to = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999Z`).toISOString() : "";
    setRangeLabel(`${dateFrom.value || "…"} → ${dateTo.value || "…"}`);
    loadReports();
  });

  btnRefresh?.addEventListener("click", () => loadReports());

  loadReports();
});

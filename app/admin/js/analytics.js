document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const funnelId = urlParams.get("funnelId");

  const backFunnelLink = document.getElementById("back-funnel-link");
  if (funnelId) {
    backFunnelLink.href = `funnel.html?id=${funnelId}`;
    backFunnelLink.textContent = "← Back to Funnel";
  } else {
    backFunnelLink.href = "index.html";
    backFunnelLink.textContent = "← Dashboard";
  }

  const analyticsTitle = document.getElementById("analytics-title");
  const analyticsHeading = document.getElementById("analytics-heading");
  const metricVisitors = document.getElementById("metric-visitors");
  const metricOrders = document.getElementById("metric-orders");
  const metricConvRate = document.getElementById("metric-conv-rate");
  const metricRevenue = document.getElementById("metric-revenue");
  const reportGeneratedAt = document.getElementById("report-generated-at");
  const breakdownTableTitle = document.getElementById("breakdown-table-title");
  const analyticsTableHead = document.getElementById("analytics-table-head");
  const analyticsTableBody = document.getElementById("analytics-table-body");
  const btnExportCsv = document.getElementById("btn-export-csv");

  // Visual Funnel & Path Elements
  const visualFunnelPanel = document.getElementById("visual-funnel-panel");
  const visualFunnelContainer = document.getElementById("visual-funnel-container");
  const pathAttributionPanel = document.getElementById("path-attribution-panel");
  const pathTableBody = document.getElementById("path-table-body");

  // Date Range Elements
  const dateFrom = document.getElementById("date-from");
  const dateTo = document.getElementById("date-to");
  const btnApplyDates = document.getElementById("btn-apply-dates");
  const dateButtons = document.querySelectorAll("#date-range-buttons button");

  let currentDays = "7";
  let customFrom = "";
  let customTo = "";

  dateButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      dateButtons.forEach(b => b.classList.remove("active", "btn-primary"));
      btn.classList.add("active", "btn-primary");
      currentDays = btn.dataset.days;
      customFrom = "";
      customTo = "";
      dateFrom.value = "";
      dateTo.value = "";
      loadReport();
    });
  });

  btnApplyDates?.addEventListener("click", () => {
    if (!dateFrom.value && !dateTo.value) return;
    dateButtons.forEach(b => b.classList.remove("active", "btn-primary"));
    customFrom = dateFrom.value ? new Date(dateFrom.value).toISOString() : "";
    customTo = dateTo.value ? new Date(dateTo.value + "T23:59:59").toISOString() : "";
    loadReport();
  });

  btnExportCsv?.addEventListener("click", () => {
    let csvUrl = funnelId ? `/api/analytics/${funnelId}/csv` : `/api/analytics/account`;
    const params = buildQueryParams();
    if (params) csvUrl += `?${params}`;
    window.location.href = csvUrl;
  });

  function buildQueryParams() {
    if (customFrom || customTo) {
      const q = [];
      if (customFrom) q.push(`from=${encodeURIComponent(customFrom)}`);
      if (customTo) q.push(`to=${encodeURIComponent(customTo)}`);
      return q.join("&");
    } else if (currentDays !== "all") {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - parseInt(currentDays, 10));
      return `from=${encodeURIComponent(fromDate.toISOString())}`;
    }
    return "";
  }

  async function loadReport() {
    let url = funnelId ? `/api/analytics/${funnelId}` : `/api/analytics/account`;
    const params = buildQueryParams();
    if (params) url += `?${params}`;

    try {
      const data = await API.get(url);
      if (data.accountMode) {
        renderAccountReport(data);
      } else {
        renderFunnelReport(data);
      }
    } catch (err) {
      console.error("Failed to load analytics:", err);
    }
  }

  function renderAccountReport(report) {
    analyticsTitle.textContent = "Account Analytics — Storewide";
    analyticsHeading.textContent = "Storewide Performance & Revenue Insights";
    metricVisitors.textContent = report.totalVisitors.toLocaleString();
    metricOrders.textContent = report.totalOrders.toLocaleString();
    metricConvRate.textContent = `${report.overallConvRate || 0.0}%`;
    metricRevenue.textContent = `$${report.totalRevenue.toFixed(2)}`;
    reportGeneratedAt.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    breakdownTableTitle.textContent = "Active Funnels Overview";

    visualFunnelPanel.style.display = "none";
    pathAttributionPanel.style.display = "none";

    analyticsTableHead.innerHTML = `
      <tr>
        <th>Funnel Name</th>
        <th>Path Slug</th>
        <th>Steps</th>
        <th>Visitors</th>
        <th>Views</th>
        <th>CTA Clicks</th>
        <th>Orders</th>
        <th>Conv %</th>
        <th>Revenue</th>
        <th>Action</th>
      </tr>
    `;

    const funnels = report.funnels || [];
    if (funnels.length === 0) {
      analyticsTableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;" class="muted">No active funnels found.</td></tr>`;
      return;
    }

    analyticsTableBody.innerHTML = funnels.map(f => `
      <tr>
        <td><strong>${escapeHtml(f.name)}</strong></td>
        <td><span class="eyebrow">/apps/funnels/${escapeHtml(f.slug)}</span></td>
        <td>${f.stepsCount}</td>
        <td>${f.visitors}</td>
        <td>${f.views}</td>
        <td>${f.ctas}</td>
        <td>${f.orders}</td>
        <td>${f.conversionRate}%</td>
        <td>$${f.revenue.toFixed(2)}</td>
        <td><a href="analytics.html?funnelId=${f.funnelId}" class="btn btn-sm">Funnel Detail</a></td>
      </tr>
    `).join("");
  }

  function renderFunnelReport(report) {
    analyticsTitle.textContent = `${report.funnelName} — Analytics`;
    analyticsHeading.textContent = `${report.funnelName} Stage Conversion & Attribution`;
    metricVisitors.textContent = report.totalVisitors.toLocaleString();
    metricOrders.textContent = report.totalOrders.toLocaleString();
    metricConvRate.textContent = `${report.overallConvRate || 0.0}%`;
    metricRevenue.textContent = `$${report.totalRevenue.toFixed(2)}`;
    reportGeneratedAt.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    breakdownTableTitle.textContent = "Stage & Variant Progression Breakdown";

    // 1. Render Visual Stepped Funnel Chart
    const flow = report.funnelFlow || [];
    if (flow.length > 0) {
      visualFunnelPanel.style.display = "block";
      const maxCount = flow[0]?.count || 1;

      visualFunnelContainer.innerHTML = flow.map((stage, i) => {
        const widthPct = Math.max(12, Math.round((stage.count / maxCount) * 100));
        return `
          <div class="funnel-stage-row">
            <div class="funnel-stage-header">
              <span>${stage.stage}</span>
              <span>${stage.count.toLocaleString()} Visitors (${stage.percentage}%)</span>
            </div>
            <div class="funnel-bar-container">
              <div class="funnel-bar-fill" style="width: ${widthPct}%;">
                ${stage.percentage}%
              </div>
            </div>
            ${i < flow.length - 1 && stage.dropoff > 0 ? `<div class="funnel-dropoff-tag">Drop-off to next stage: -${stage.dropoff}%</div>` : ''}
          </div>
        `;
      }).join("");
    } else {
      visualFunnelPanel.style.display = "none";
    }

    // 2. Render Path Attribution Table
    const paths = report.pathAttribution || [];
    if (paths.length > 0) {
      pathAttributionPanel.style.display = "block";
      pathTableBody.innerHTML = paths.map(p => `
        <tr>
          <td><strong>${escapeHtml(p.path)}</strong></td>
          <td>${p.visitors}</td>
          <td>${p.orders}</td>
          <td>${p.convRate}%</td>
          <td>$${p.revenue.toFixed(2)}</td>
          <td>$${p.aov.toFixed(2)}</td>
        </tr>
      `).join("");
    } else {
      pathAttributionPanel.style.display = "none";
    }

    // 3. Render Step Breakdown Table
    analyticsTableHead.innerHTML = `
      <tr>
        <th style="width:30px;"></th>
        <th>Step / Variant</th>
        <th>Entries</th>
        <th>Page Views</th>
        <th>CTA Clicks</th>
        <th>Stage Metric</th>
        <th>Orders</th>
        <th>Revenue</th>
      </tr>
    `;

    const steps = report.steps || [];
    if (steps.length === 0) {
      analyticsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;" class="muted">No step data available.</td></tr>`;
      return;
    }

    let rowsHtml = "";

    steps.forEach(step => {
      rowsHtml += `
        <tr style="background:rgba(0,0,0,0.02); font-weight:bold; cursor:pointer;" onclick="toggleStepExpand('${step.stepId}')">
          <td style="text-align:center;" id="toggle-icon-${step.stepId}">▶</td>
          <td>${step.position}. ${escapeHtml(step.name)} <span class="badge badge-kind" style="font-size:9px;">${step.kind}</span></td>
          <td>${step.entries}</td>
          <td>${step.views}</td>
          <td>${step.ctas}</td>
          <td><span style="color:var(--green);">${step.stageMetricLabel}: ${step.stageMetricValue}%</span></td>
          <td>${step.orders}</td>
          <td>$${step.revenue.toFixed(2)}</td>
        </tr>
      `;

      (step.variants || []).forEach(v => {
        rowsHtml += `
          <tr class="variant-subrow-${step.stepId}" style="display:none; background:#fff; font-size:13px;">
            <td></td>
            <td style="padding-left:28px;">↳ Variant: <strong>${escapeHtml(v.name)}</strong></td>
            <td>${v.entries}</td>
            <td>${v.views}</td>
            <td>${v.ctas}</td>
            <td>Progression: ${v.progressionRate}%</td>
            <td>${v.orders}</td>
            <td>$${v.revenue.toFixed(2)}</td>
          </tr>
        `;
      });
    });

    analyticsTableBody.innerHTML = rowsHtml;
  }

  window.toggleStepExpand = function(stepId) {
    const subrows = document.querySelectorAll(`.variant-subrow-${stepId}`);
    const toggleIcon = document.getElementById(`toggle-icon-${stepId}`);
    let isExpanded = false;
    subrows.forEach(r => {
      if (r.style.display === "none") {
        r.style.display = "table-row";
        isExpanded = true;
      } else {
        r.style.display = "none";
      }
    });
    if (toggleIcon) {
      toggleIcon.textContent = isExpanded ? "▼" : "▶";
    }
  };

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c]);
  }

  loadReport();
});

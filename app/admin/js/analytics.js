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
  const metricViews = document.getElementById("metric-views");
  const metricOrders = document.getElementById("metric-orders");
  const metricRevenue = document.getElementById("metric-revenue");
  const reportGeneratedAt = document.getElementById("report-generated-at");
  const breakdownTableTitle = document.getElementById("breakdown-table-title");
  const analyticsTableHead = document.getElementById("analytics-table-head");
  const analyticsTableBody = document.getElementById("analytics-table-body");
  const btnExportCsv = document.getElementById("btn-export-csv");
  const dateButtons = document.querySelectorAll("#date-range-buttons button");

  let currentDays = "7";

  dateButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      dateButtons.forEach(b => b.classList.remove("active", "btn-primary"));
      btn.classList.add("active", "btn-primary");
      currentDays = btn.dataset.days;
      loadReport();
    });
  });

  btnExportCsv?.addEventListener("click", () => {
    let csvUrl = funnelId ? `/api/analytics/${funnelId}/csv` : `/api/analytics/account`;
    if (currentDays !== "all") {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - parseInt(currentDays, 10));
      csvUrl += `?from=${fromDate.toISOString()}`;
    }
    window.location.href = csvUrl;
  });

  async function loadReport() {
    let url = funnelId ? `/api/analytics/${funnelId}` : `/api/analytics/account`;
    if (currentDays !== "all") {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - parseInt(currentDays, 10));
      url += `?from=${fromDate.toISOString()}`;
    }

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
    metricViews.textContent = report.totalViews.toLocaleString();
    metricOrders.textContent = report.totalOrders.toLocaleString();
    metricRevenue.textContent = `$${report.totalRevenue.toFixed(2)}`;
    reportGeneratedAt.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    breakdownTableTitle.textContent = "Active Funnels Overview";

    analyticsTableHead.innerHTML = `
      <tr>
        <th>Funnel Name</th>
        <th>Path Slug</th>
        <th>Steps</th>
        <th>Visitors</th>
        <th>Views</th>
        <th>CTA Clicks</th>
        <th>Orders</th>
        <th>Revenue</th>
        <th>Action</th>
      </tr>
    `;

    const funnels = report.funnels || [];
    if (funnels.length === 0) {
      analyticsTableBody.innerHTML = `<tr><td colspan="9" style="text-align:center;" class="muted">No active funnels found.</td></tr>`;
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
        <td>$${f.revenue.toFixed(2)}</td>
        <td><a href="analytics.html?funnelId=${f.funnelId}" class="btn btn-sm">Funnel Detail</a></td>
      </tr>
    `).join("");
  }

  function renderFunnelReport(report) {
    analyticsTitle.textContent = `${report.funnelName} — Analytics`;
    analyticsHeading.textContent = `${report.funnelName} Conversion Telemetry`;
    metricVisitors.textContent = report.totalVisitors.toLocaleString();
    metricViews.textContent = report.totalViews.toLocaleString();
    metricOrders.textContent = report.totalOrders.toLocaleString();
    metricRevenue.textContent = `$${report.totalRevenue.toFixed(2)}`;
    reportGeneratedAt.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
    breakdownTableTitle.textContent = "Step & Variant Breakdown";

    analyticsTableHead.innerHTML = `
      <tr>
        <th style="width:30px;"></th>
        <th>Step / Variant</th>
        <th>Entries</th>
        <th>Page Views</th>
        <th>CTA Clicks</th>
        <th>CTA Rate (%)</th>
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
          <td>${step.ctaRate}%</td>
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
            <td>${v.ctaRate}%</td>
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

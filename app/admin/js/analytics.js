document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const funnelId = urlParams.get("funnelId");

  if (!funnelId) {
    window.location.href = "index.html";
    return;
  }

  const backFunnelLink = document.getElementById("back-funnel-link");
  backFunnelLink.href = `funnel.html?id=${funnelId}`;

  const analyticsTitle = document.getElementById("analytics-title");
  const metricVisitors = document.getElementById("metric-visitors");
  const metricViews = document.getElementById("metric-views");
  const metricOrders = document.getElementById("metric-orders");
  const metricRevenue = document.getElementById("metric-revenue");
  const reportGeneratedAt = document.getElementById("report-generated-at");
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
    window.location.href = `/api/analytics/${funnelId}/csv`;
  });

  async function loadReport() {
    let url = `/api/analytics/${funnelId}`;
    if (currentDays !== "all") {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - parseInt(currentDays, 10));
      url += `?from=${fromDate.toISOString()}`;
    }

    try {
      const data = await API.get(url);
      renderReport(data);
    } catch (err) {
      console.error("Failed to load analytics:", err);
    }
  }

  function renderReport(report) {
    analyticsTitle.textContent = `${report.funnelName} — Analytics`;
    metricVisitors.textContent = report.totalVisitors.toLocaleString();
    metricViews.textContent = report.totalViews.toLocaleString();
    metricOrders.textContent = report.totalOrders.toLocaleString();
    metricRevenue.textContent = `$${report.totalRevenue.toFixed(2)}`;
    reportGeneratedAt.textContent = `Updated: ${new Date().toLocaleTimeString()}`;

    const steps = report.steps || [];
    if (steps.length === 0) {
      analyticsTableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;" class="muted">No step data available.</td></tr>`;
      return;
    }

    let rowsHtml = "";

    steps.forEach(step => {
      const rowId = `step-row-${step.stepId}`;
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

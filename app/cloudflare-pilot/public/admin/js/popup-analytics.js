document.addEventListener('DOMContentLoaded', () => {
  const state = { range: '7', breakdown: 'device', report: null };
  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const number = (value) => Number(value || 0).toLocaleString();
  const percent = (value) => `${Number(value || 0).toFixed(1)}%`;
  const money = (value, currency = 'ILS') => value == null || !currency ? '—' : new Intl.NumberFormat('he-IL', { style: 'currency', currency }).format(Number(value || 0));
  const time = (value) => value ? new Date(value).toLocaleString() : '—';

  function rangeValues() {
    const now = new Date();
    let from;
    let to = now;
    if (state.range === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (state.range === 'yesterday') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, -1);
    } else {
      from = new Date(now.getTime() - Number(state.range || 7) * 86400000);
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }

  function queryString() {
    const params = new URLSearchParams();
    const customFrom = byId('date-from').value;
    const customTo = byId('date-to').value;
    if (customFrom || customTo) {
      if (customFrom) params.set('from', new Date(`${customFrom}T00:00:00`).toISOString());
      if (customTo) params.set('to', new Date(`${customTo}T23:59:59.999`).toISOString());
    } else {
      const range = rangeValues();
      params.set('from', range.from);
      params.set('to', range.to);
    }
    ['device', 'page', 'source', 'medium', 'campaign', 'version'].forEach(key => {
      const value = byId(`filter-${key}`).value;
      if (value) params.set(key, value);
    });
    return params.toString();
  }

  function metricCard(label, value, detail, revenue = false) {
    return `<article class="kpi${revenue ? ' revenue' : ''}"><span class="label">${escapeHtml(label)}</span><strong class="value">${escapeHtml(value)}</strong><span class="detail">${escapeHtml(detail)}</span></article>`;
  }

  function renderKpis(report) {
    const metric = report.metrics;
    const revenue = (metric.popupAttributedRevenueByCurrency || []).map(row => money(row.revenue, row.currency)).join(' + ')
      || money(metric.popupAttributedRevenue, metric.popupRevenueCurrency);
    const cards = [
      ['Eligible Sessions', number(metric.eligibleSessions), 'Targeted, unsuppressed sessions'],
      ['Popup Views', number(metric.popupViews), `${percent(metric.viewRate)} of eligible`],
      ['Email Starts', number(metric.emailStarts), 'First field interaction'],
      ['Submit Attempts', number(metric.submitAttempts), 'Valid form submits'],
      ['Successful Leads', number(metric.successfulLeads), `${percent(metric.leadConversionRate)} of views`],
      ['Submit Success Rate', percent(metric.submitSuccessRate), 'Shopify-confirmed / attempts'],
      ['Coupon Reveals', number(metric.couponReveals), 'After confirmed lead'],
      ['Attributed Orders', number(metric.popupAttributedOrders), 'Popup line-item marker', true],
      ['Attributed Revenue', revenue, 'Shopify net order revenue', true],
      ['Revenue per View', money(metric.popupRevenuePerView, metric.popupRevenueCurrency), 'Attributed revenue / views', true],
      ['Coupon Orders', number(metric.couponOrders), report.configuredCoupon, true],
      ['Coupon Revenue', money(metric.couponRevenue), 'Orders using popup code', true],
      ['Reveal to Purchase', percent(metric.revealToPurchaseRate), 'Coupon orders / reveals', true]
    ];
    byId('kpi-grid').innerHTML = cards.map(card => metricCard(...card)).join('');
  }

  function renderFunnel(report) {
    const maximum = Math.max(...report.funnel.map(stage => stage.count), 1);
    byId('popup-funnel').innerHTML = report.funnel.map(stage => {
      const width = stage.count ? Math.max(2, (stage.count / maximum) * 100) : 0;
      return `<div class="popup-stage">
        <strong>${escapeHtml(stage.label)}</strong>
        <div class="stage-track"><div class="stage-fill" style="width:${width}%"></div></div>
        <span class="stage-stat stage-count">${number(stage.count)}</span>
        <span class="stage-stat">${percent(stage.fromPrevious)} previous</span>
        <span class="stage-stat">${stage.fromView == null ? '—' : `${percent(stage.fromView)} of views`}</span>
      </div>`;
    }).join('');
  }

  function compact(items) {
    return items.map(([label, value]) => `<div class="compact-metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
  }

  function renderOperational(report) {
    const metric = report.metrics;
    const dismissals = report.dismissals;
    const errors = report.errors;
    byId('coupon-metrics').innerHTML = compact([
      ['Reveals', number(metric.couponReveals)], ['Coupon orders', number(metric.couponOrders)],
      ['Coupon revenue', money(metric.couponRevenue, metric.popupRevenueCurrency)], ['Reveal to purchase', percent(metric.revealToPurchaseRate)]
    ]);
    byId('dismissal-metrics').innerHTML = compact([
      ['Total closes', number(dismissals.total)], ['Close rate', percent(dismissals.closeRate)],
      ['X', number(dismissals.x)], ['Backdrop', number(dismissals.backdrop)],
      ['ESC', number(dismissals.esc)], ['Other', number(dismissals.other)]
    ]);
    byId('error-metrics').innerHTML = compact([
      ['Attempts', number(errors.submitAttempts)], ['Confirmed', number(errors.successfulSubmits)],
      ['Failed', number(errors.failedSubmits)], ['Failure rate', percent(errors.failureRate)]
    ]);
  }

  function emptyRow(columns, message) {
    return `<tr><td colspan="${columns}" class="empty-row">${escapeHtml(message)}</td></tr>`;
  }

  function renderBreakdown() {
    const rows = state.report?.breakdowns?.[state.breakdown] || [];
    byId('breakdown-body').innerHTML = rows.length ? rows.map(row => `<tr>
      <td><strong>${escapeHtml(row.value)}</strong></td><td>${number(row.views)}</td><td>${number(row.leads)}</td>
      <td>${percent(row.leadConversionRate)}</td><td>${number(row.orders)}</td><td>${money(row.revenue, row.currency)}</td>
    </tr>`).join('') : emptyRow(6, 'No data in this range.');
  }

  function renderErrors(report) {
    byId('failure-rate').textContent = `${percent(report.errors.failureRate)} failure rate`;
    byId('failure-categories').innerHTML = report.errors.categories.length
      ? report.errors.categories.map(row => `<tr><td>${escapeHtml(row.category)}</td><td>${number(row.count)}</td></tr>`).join('')
      : emptyRow(2, 'No failures in this range.');
    byId('recent-failures').innerHTML = report.errors.recent.length
      ? report.errors.recent.map(row => `<tr><td>${escapeHtml(time(row.at))}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.device || 'Unattributed')}</td><td>${escapeHtml(row.path || 'Unattributed')}</td></tr>`).join('')
      : emptyRow(4, 'No recent failures.');
  }

  function renderRecent(report) {
    byId('recent-events').innerHTML = report.recentEvents.length
      ? report.recentEvents.map(row => `<tr><td>${escapeHtml(time(row.at))}</td><td><strong>${escapeHtml(row.event)}</strong></td><td>${escapeHtml(row.source)}</td><td>${escapeHtml(row.device || 'Unattributed')}</td><td>${escapeHtml(row.page || 'Unattributed')}</td><td>${escapeHtml(row.version || 'Unversioned')}</td></tr>`).join('')
      : emptyRow(6, 'No popup events in this range.');
  }

  function renderRecentOrders(report) {
    const orders = report.recentAttributedOrders || [];
    byId('recent-orders').innerHTML = orders.length
      ? orders.map(row => `<tr><td><strong>#${escapeHtml(row.orderId)}</strong></td><td>${escapeHtml(time(row.paidAt))}</td><td>${escapeHtml(row.source)} / ${escapeHtml(row.medium)}</td><td>${escapeHtml(row.campaign)}</td><td>${escapeHtml(money(row.revenue, row.currency))}</td><td>${escapeHtml(row.attributionMethod)}</td></tr>`).join('')
      : emptyRow(6, 'No attributed sales in this range.');
  }

  function renderTruth(report) {
    byId('truth-strip').innerHTML = Object.entries(report.sourceOfTruth).map(([key, value]) => `<div class="truth-item"><strong>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</strong><span>${escapeHtml(value)}</span></div>`).join('');
  }

  function populateFilters(options) {
    Object.entries(options || {}).forEach(([key, values]) => {
      const select = byId(`filter-${key}`);
      const current = select.value;
      select.replaceChildren(new Option('All', ''), ...values.map(value => new Option(value, value)));
      if ([...select.options].some(option => option.value === current)) select.value = current;
    });
  }

  async function loadReport() {
    byId('report-status').textContent = 'Loading authenticated production data...';
    try {
      const report = await API.get(`/api/analytics/popup?${queryString()}`);
      state.report = report;
      populateFilters(report.filterOptions);
      renderKpis(report);
      renderFunnel(report);
      renderOperational(report);
      renderBreakdown();
      renderErrors(report);
      renderRecent(report);
      renderRecentOrders(report);
      renderTruth(report);
      byId('coupon-chip').textContent = `Coupon: ${report.configuredCoupon}`;
      byId('report-status').textContent = `${report.dataMode} · D1 + Shopify truth · Updated ${time(report.generatedAt)}`;
    } catch (error) {
      byId('report-status').textContent = 'Authenticated data unavailable.';
      byId('kpi-grid').innerHTML = `<div class="error-banner">${escapeHtml(error.message || 'Open this page from the authorized Shopify Admin app.')}</div>`;
    }
  }

  byId('date-presets').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-range]');
    if (!button) return;
    state.range = button.dataset.range;
    byId('date-from').value = '';
    byId('date-to').value = '';
    byId('date-presets').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    loadReport();
  });
  ['date-from', 'date-to', 'filter-device', 'filter-page', 'filter-source', 'filter-medium', 'filter-campaign', 'filter-version'].forEach(id => {
    byId(id).addEventListener('change', loadReport);
  });
  byId('breakdown-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-breakdown]');
    if (!button) return;
    state.breakdown = button.dataset.breakdown;
    byId('breakdown-tabs').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    renderBreakdown();
  });
  byId('refresh-report').addEventListener('click', loadReport);
  loadReport();
});



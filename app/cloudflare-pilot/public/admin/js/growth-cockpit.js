document.addEventListener('DOMContentLoaded', () => {
  const state = { preset: 'today', definitions: {} };
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const labels = { revenue: 'Revenue', orders: 'Orders', popupEvents: 'Popup events', metaSpend: 'Meta spend', cjCosts: 'CJ costs', paymentFees: 'Payment fees' };

  async function apiGet(path) {
    const headers = {};
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      const token = await window.shopify.idToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(path, { headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  function query() {
    const params = new URLSearchParams();
    params.set('preset', state.preset);
    const from = byId('date-from').value;
    const to = byId('date-to').value;
    if (from || to) {
      params.delete('preset');
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    }
    return params.toString();
  }

  function render(config) {
    const range = config.range;
    const rangeText = range.localFrom && range.localTo
      ? `${range.localFrom} through ${range.localTo} (${range.timezone})`
      : `All available history (${range.timezone})`;
    byId('timezone-label').textContent = `Timezone: ${range.timezone}`;
    byId('range-summary').textContent = `Active window: ${rangeText}. Boundaries are calendar-day based and end-exclusive.`;
    byId('currency-value').textContent = config.reportingCurrency || 'MISSING';
    byId('currency-status').textContent = config.reportingCurrencyConfigured ? 'Configured reporting currency' : 'Set REPORTING_CURRENCY before financial aggregation';
    byId('data-access-value').textContent = config.access.data.enforced ? 'Protected' : 'Unprotected';
    byId('document-access-value').textContent = config.access.document.enforced ? 'Protected' : 'Shell only';
    byId('document-access-note').textContent = config.access.document.releaseBlocked ? 'Release blocked until document gate exists' : 'Configured';
    byId('source-grid').innerHTML = Object.entries(config.sources).map(([key, value]) => `<div class="source-item"><strong>${escapeHtml(labels[key] || key)}</strong><span>${escapeHtml(value)}</span></div>`).join('');
    byId('contract-status').textContent = `Batch 1 contract loaded · ${config.contractVersion} · ${new Date(config.generatedAt).toLocaleString()}`;
  }

  function formatMoney(amount, currency) {
    if (amount == null || !Number.isFinite(Number(amount)) || !currency) return 'MISSING';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
  }

  function financialCard(key, label, value, quality, note) {
    const normalizedQuality = String(quality || 'MISSING').toLowerCase();
    const definition = state.definitions[key];
    const tooltip = definition ? `<button class="definition-trigger" type="button" aria-label="About ${escapeHtml(label)}">?</button>
      <span class="definition-tooltip" role="tooltip"><strong>${escapeHtml(definition.definition)}</strong><span>Source: ${escapeHtml(definition.source)}</span>${definition.calculation ? `<span>Calculation: ${escapeHtml(definition.calculation)}</span>` : ''}</span>` : '';
    return `<article class="financial-card">
      <span class="financial-label">${escapeHtml(label)}${tooltip}</span>
      <strong class="financial-value">${escapeHtml(value)}</strong>
      <span class="quality quality-${escapeHtml(normalizedQuality)}">${escapeHtml(quality || 'MISSING')}</span>
      <span class="financial-note">${escapeHtml(note || '')}</span>
    </article>`;
  }

  function comparisonText(comparison) {
    if (!comparison || comparison.reason) return comparison?.reason || 'No comparison is available for this range.';
    if (!comparison.revenue || comparison.revenue.quality !== 'ACTUAL') return comparison.revenue?.note || 'Comparison is unavailable.';
    const previous = formatMoney(comparison.revenue.previous, comparison.revenue.currency);
    const change = formatMoney(comparison.revenue.absoluteChange, comparison.revenue.currency);
    const percent = comparison.revenue.percentChange == null ? 'percentage change unavailable' : `${comparison.revenue.percentChange >= 0 ? '+' : ''}${Number(comparison.revenue.percentChange).toFixed(1)}%`;
    return `Compared with ${comparison.range.localFrom} through ${comparison.range.localTo}: ${previous} prior net payments, ${change} change (${percent}).`;
  }

  function popupMoney(value, currency) {
    return currency ? formatMoney(value, currency) : (value == null ? 'MISSING' : 'MISSING · currency unset');
  }

  function popupKpi(label, value, detail) {
    return `<article class="popup-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`;
  }

  function renderPopup(report, config) {
    const metric = report.metrics;
    const currency = config.reportingCurrency;
    byId('popup-status').textContent = `${report.dataMode} · D1 events + Shopify order truth · Updated ${new Date(report.generatedAt).toLocaleString()}`;
    byId('popup-kpi-grid').innerHTML = [
      popupKpi('Eligible sessions', Number(metric.eligibleSessions).toLocaleString(), 'D1 popup_eligible'),
      popupKpi('Popup views', Number(metric.popupViews).toLocaleString(), `${Number(metric.viewRate || 0).toFixed(1)}% of eligible`),
      popupKpi('Successful leads', Number(metric.successfulLeads).toLocaleString(), `${Number(metric.leadConversionRate || 0).toFixed(1)}% of views`),
      popupKpi('Submit success', `${Number(metric.submitSuccessRate || 0).toFixed(1)}%`, `${Number(metric.submitAttempts).toLocaleString()} attempts`),
      popupKpi('Coupon reveals', Number(metric.couponReveals).toLocaleString(), report.configuredCoupon || 'Configured coupon'),
      popupKpi('Popup orders', Number(metric.popupAttributedOrders).toLocaleString(), 'Shopify-attributed orders'),
      popupKpi('Popup revenue', popupMoney(metric.popupAttributedRevenue, currency), currency ? 'Shopify net order revenue' : 'Reporting currency required'),
      popupKpi('Coupon orders', Number(metric.couponOrders).toLocaleString(), popupMoney(metric.couponRevenue, currency))
    ].join('');

    const stages = report.funnel || [];
    const max = Math.max(...stages.map(stage => Number(stage.count) || 0), 1);
    byId('popup-funnel').innerHTML = stages.map(stage => `<div class="popup-funnel-row">
      <strong>${escapeHtml(stage.label)}</strong>
      <div class="popup-funnel-track"><div class="popup-funnel-fill" style="width:${Math.max(0, Math.min(100, ((Number(stage.count) || 0) / max) * 100))}%"></div></div>
      <span class="popup-stat">${Number(stage.count).toLocaleString()}</span>
      <span class="popup-stat">${stage.fromPrevious == null ? '—' : `${Number(stage.fromPrevious).toFixed(1)}% prev`}</span>
      <span class="popup-stat">${stage.fromView == null ? '—' : `${Number(stage.fromView).toFixed(1)}% views`}</span>
    </div>`).join('');

    const dismissals = report.dismissals;
    const errors = report.errors;
    byId('popup-diagnostics').innerHTML = [
      ['Total closes', dismissals.total, `${Number(dismissals.closeRate || 0).toFixed(1)}% close rate`],
      ['X closes', dismissals.x, 'Close method'],
      ['Backdrop closes', dismissals.backdrop, 'Close method'],
      ['ESC closes', dismissals.esc, 'Close method'],
      ['Failed submits', errors.failedSubmits, `${Number(errors.failureRate || 0).toFixed(1)}% failure rate`],
      ['Other closes', dismissals.other, 'Close method']
    ].map(([label, value, detail]) => `<div class="popup-diagnostic"><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(label)} · ${escapeHtml(detail)}</span></div>`).join('');
    const recentFailures = (errors.recent || []).slice(0, 5).map(failure => `${failure.category} · ${failure.device || 'Unattributed'}`).join(' | ');
    byId('popup-failures').textContent = recentFailures ? `Recent failure categories: ${recentFailures}` : 'No recent submit failures in this range.';

    const breakdowns = report.breakdowns || {};
    byId('popup-breakdowns').innerHTML = ['device', 'page', 'source'].map(key => {
      const rows = (breakdowns[key] || []).slice(0, 5);
      return `<div class="popup-breakdown"><h4>${escapeHtml(key === 'source' ? 'Source / UTM' : key[0].toUpperCase() + key.slice(1))}</h4>${rows.length ? rows.map(row => `<div class="popup-breakdown-row"><span>${escapeHtml(row.value)}</span><strong>${Number(row.views).toLocaleString()} views</strong></div>`).join('') : '<span class="muted">No data</span>'}</div>`;
    }).join('');
    byId('popup-source-truth').textContent = `Source of truth: ${report.sourceOfTruth?.eligibilityViewsInteractionsDismissals || 'D1 popup events'}; leads: ${report.sourceOfTruth?.successfulLeads || 'Shopify confirmation'}; orders: ${report.sourceOfTruth?.ordersRevenue || 'Shopify order webhooks'}.`;
  }

  function renderFinance(report) {
    const metrics = report.metrics;
    const profit = report.profit;
    const profitQuality = profit.complete ? 'ACTUAL' : 'MISSING';
    state.definitions = Object.fromEntries((report.metricDefinitions || []).map(definition => [definition.key, definition]));
    const cards = [
      financialCard('revenue', 'Shopify net payments', formatMoney(metrics.revenue.amount, metrics.revenue.currency), metrics.revenue.quality, metrics.revenue.source),
      financialCard('orders', 'Paid orders', metrics.orders.amount == null ? 'MISSING' : Number(metrics.orders.amount).toLocaleString(), metrics.orders.quality, metrics.orders.source),
      financialCard('cjCosts', 'CJ variable costs', formatMoney(metrics.cjCosts.amount, metrics.cjCosts.currency), metrics.cjCosts.quality, metrics.cjCosts.source),
      financialCard('paymentFees', 'Payment fees', formatMoney(metrics.paymentFees.amount, metrics.paymentFees.currency), metrics.paymentFees.quality, metrics.paymentFees.source),
      financialCard('metaSpend', 'Meta spend', formatMoney(metrics.metaSpend.amount, metrics.metaSpend.currency), metrics.metaSpend.quality, metrics.metaSpend.source),
      financialCard('cm1', 'CM1', formatMoney(profit.cm1, profit.currency), profitQuality, 'Revenue - CJ costs - payment fees'),
      financialCard('cm2', 'CM2', formatMoney(profit.cm2, profit.currency), profitQuality, 'CM1 - Meta spend'),
      financialCard('cm2Margin', 'CM2 margin', profit.marginPct == null ? 'MISSING' : `${Number(profit.marginPct).toFixed(1)}%`, profitQuality, 'CM2 / revenue')
    ];
    byId('financial-grid').innerHTML = cards.join('');
    byId('comparison-summary').textContent = comparisonText(report.comparison);
    byId('profit-status').textContent = profit.complete
      ? `Authoritative profit available in ${profit.currency}.`
      : `Profit unavailable: ${profit.blockers.join(' ')}`;
    byId('financial-status').textContent = `Shopify: ${metrics.revenue.quality}. CJ: ${metrics.cjCosts.quality}. Payment fees: ${metrics.paymentFees.quality}. Meta: ${metrics.metaSpend.quality}.`;
  }

  async function load() {
    byId('contract-status').textContent = 'Loading the authenticated reporting contract...';
    try {
      const queryString = query();
      const config = await apiGet(`/api/growth-cockpit/config?${queryString}`);
      const popupParams = new URLSearchParams();
      if (config.range.from) popupParams.set('from', config.range.from);
      if (config.range.toExclusive) popupParams.set('to', new Date(new Date(config.range.toExclusive).getTime() - 1).toISOString());
      const [finance, popup] = await Promise.all([
        apiGet(`/api/growth-cockpit/finance?${queryString}`),
        apiGet(`/api/analytics/popup?${popupParams.toString()}`)
      ]);
      render(config);
      renderFinance(finance);
      renderPopup(popup, config);
    } catch (error) {
      byId('contract-status').textContent = 'Authenticated contract unavailable.';
      byId('source-grid').innerHTML = `<div class="error-banner">${escapeHtml(error.message || 'Open this page from the authorized Shopify Admin app.')}</div>`;
      byId('financial-grid').innerHTML = `<div class="error-banner">${escapeHtml(error.message || 'Verified financial data is unavailable.')}</div>`;
      byId('popup-status').textContent = 'Authenticated popup data unavailable.';
      byId('popup-kpi-grid').innerHTML = `<div class="error-banner">${escapeHtml(error.message || 'Popup analytics are unavailable.')}</div>`;
    }
  }

  byId('date-presets').addEventListener('click', event => {
    const button = event.target.closest('button[data-preset]');
    if (!button) return;
    state.preset = button.dataset.preset;
    byId('date-from').value = '';
    byId('date-to').value = '';
    byId('date-presets').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    load();
  });
  byId('apply-custom-range').addEventListener('click', () => {
    byId('date-presets').querySelectorAll('button').forEach(item => item.classList.remove('active'));
    load();
  });
  byId('refresh-contract').addEventListener('click', load);
  load();
});

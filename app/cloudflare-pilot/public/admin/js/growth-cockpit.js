document.addEventListener('DOMContentLoaded', () => {
  const state = { preset: 'today', definitions: {} };
  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const labels = { revenue: 'Revenue', orders: 'Orders', popupEvents: 'Popup events', metaSpend: 'Meta spend', cjCosts: 'CJ costs', paymentFees: 'Payment fees' };

  async function apiRequest(path, options = {}) {
    const headers = {};
    if (window.shopify && typeof window.shopify.idToken === 'function') {
      const token = await window.shopify.idToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(path, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  function apiGet(path) {
    return apiRequest(path);
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

  function financialCard(key, label, value, quality, note, conversion) {
    // A converted amount says what it came from, on the value itself.
    const conversionTitle = window.Money && window.Money.conversionTitle(conversion);
    const converted = conversionTitle ? ` title="${escapeHtml(conversionTitle)}"` : '';
    const normalizedQuality = String(quality || 'MISSING').toLowerCase();
    const definition = state.definitions[key];
    const tooltip = definition ? `<button class="definition-trigger" type="button" aria-label="About ${escapeHtml(label)}">?</button>
      <span class="definition-tooltip" role="tooltip"><strong>${escapeHtml(definition.definition)}</strong><span>Source: ${escapeHtml(definition.source)}</span>${definition.calculation ? `<span>Calculation: ${escapeHtml(definition.calculation)}</span>` : ''}</span>` : '';
    return `<article class="financial-card">
      <span class="financial-label">${escapeHtml(label)}${tooltip}</span>
      <strong class="financial-value"${converted}>${escapeHtml(value)}</strong>
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
    const currency = metric.popupRevenueCurrency || config.reportingCurrency;
    const popupRevenue = (metric.popupAttributedRevenueByCurrency || [])
      .map(row => popupMoney(row.revenue, row.currency)).join(' + ') || popupMoney(metric.popupAttributedRevenue, currency);
    byId('popup-status').textContent = `${report.dataMode} · D1 events + Shopify order truth · Updated ${new Date(report.generatedAt).toLocaleString()}`;
    byId('popup-kpi-grid').innerHTML = [
      popupKpi('Eligible sessions', Number(metric.eligibleSessions).toLocaleString(), 'D1 popup_eligible'),
      popupKpi('Popup views', Number(metric.popupViews).toLocaleString(), `${Number(metric.viewRate || 0).toFixed(1)}% of eligible`),
      popupKpi('Successful leads', Number(metric.successfulLeads).toLocaleString(), `${Number(metric.leadConversionRate || 0).toFixed(1)}% of views`),
      popupKpi('Submit success', `${Number(metric.submitSuccessRate || 0).toFixed(1)}%`, `${Number(metric.submitAttempts).toLocaleString()} attempts`),
      popupKpi('Coupon reveals', Number(metric.couponReveals).toLocaleString(), report.configuredCoupon || 'Configured coupon'),
      popupKpi('Popup orders', Number(metric.popupAttributedOrders).toLocaleString(), 'Shopify-attributed orders'),
      popupKpi('Popup revenue', popupRevenue, 'Shopify net order revenue'),
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
    const breakdownLabels = { device: 'Device', page: 'Page', source: 'UTM source', medium: 'UTM medium', campaign: 'UTM campaign' };
    byId('popup-breakdowns').innerHTML = ['device', 'page', 'source', 'medium', 'campaign'].map(key => {
      const rows = (breakdowns[key] || []).slice(0, 5);
      return `<div class="popup-breakdown"><h4>${escapeHtml(breakdownLabels[key])}</h4>${rows.length ? rows.map(row => {
        const revenue = row.currency && row.revenue != null ? ` · ${popupMoney(row.revenue, row.currency)}` : '';
        return `<div class="popup-breakdown-row"><span>${escapeHtml(row.value)}</span><strong>${Number(row.views).toLocaleString()} views · ${Number(row.leads).toLocaleString()} leads · ${Number(row.orders).toLocaleString()} orders${escapeHtml(revenue)}</strong></div>`;
      }).join('') : '<span class="muted">No data</span>'}</div>`;
    }).join('');
    byId('popup-source-truth').textContent = `Source of truth: ${report.sourceOfTruth?.eligibilityViewsInteractionsDismissals || 'D1 popup events'}; leads: ${report.sourceOfTruth?.successfulLeads || 'Shopify confirmation'}; orders: ${report.sourceOfTruth?.ordersRevenue || 'Shopify order webhooks'}.`;
  }

  function renderFinance(report) {
    const metrics = report.metrics;
    const profit = report.profit;
    const shopifySourceRevenue = metrics.shopifySourceRevenue || metrics.revenue;
    const revenueNeedsConversion = metrics.revenue.amount == null && shopifySourceRevenue.amount != null;
    const ownerRevenue = revenueNeedsConversion ? shopifySourceRevenue : metrics.revenue;
    const revenueNote = revenueNeedsConversion
      ? `${ownerRevenue.source} · Native Shopify currency; conversion to ${report.reportingCurrency || 'the reporting currency'} is still required for profit`
      : ownerRevenue.source;
    // Profit stands on the weakest of its inputs; product cost is incomplete
    // until CJ has charged the window.
    const profitQuality = profit.complete ? (profit.costQuality || 'ACTUAL') : 'MISSING';
    const productCost = metrics.productCost;
    const feesIn = profit.paymentFeesIncluded;
    const netOf = feesIn ? 'after payment fees' : 'before payment fees';
    state.definitions = Object.fromEntries((report.metricDefinitions || []).map(definition => [definition.key, definition]));
    const cards = [
      financialCard('revenue', 'Shopify net payments', formatMoney(ownerRevenue.amount, ownerRevenue.currency), ownerRevenue.quality, revenueNote, ownerRevenue.conversion),
      financialCard('orders', 'Paid orders', metrics.orders.amount == null ? 'MISSING' : Number(metrics.orders.amount).toLocaleString(), metrics.orders.quality, metrics.orders.source),
      financialCard('productCost', 'Product cost', formatMoney(productCost.amount, productCost.currency), productCost.quality,
        'What CJ charges for these orders', productCost.conversion),
      financialCard('paymentFees', 'Payment fees', formatMoney(metrics.paymentFees.amount, metrics.paymentFees.currency), metrics.paymentFees.quality,
        feesIn ? 'Shopify Payments fees, subtracted from profit' : 'Shopify Payments fees; not available for this window', metrics.paymentFees.conversion),
      financialCard('metaSpend', 'Meta spend', formatMoney(metrics.metaSpend.amount, metrics.metaSpend.currency), metrics.metaSpend.quality, metrics.metaSpend.source, metrics.metaSpend.conversion),
      financialCard('cm1', `Contribution margin ${netOf}`, formatMoney(profit.cm1, profit.currency), profitQuality, `Revenue − product cost${feesIn ? ' − payment fees' : ''}`),
      financialCard('cm2', `Profit ${netOf}`, formatMoney(profit.cm2, profit.currency), profitQuality, 'Contribution margin − Meta spend'),
      financialCard('cm2Margin', `Profit margin ${netOf}`, profit.marginPct == null ? 'MISSING' : `${Number(profit.marginPct).toFixed(1)}%`, profitQuality, 'Profit ÷ revenue')
    ];
    byId('financial-grid').innerHTML = cards.join('');
    byId('comparison-summary').textContent = comparisonText(report.comparison);
    byId('profit-status').textContent = profit.complete
      ? `Profit ${netOf} is reported in ${profit.currency}${profit.costQuality === 'PARTIAL' ? ', and the product cost does not yet cover every order in the window' : ''}. Shopify pays out in the store currency, so a converted figure uses that day's published rate.`
      : `${revenueNeedsConversion ? `Shopify paid revenue is available in ${ownerRevenue.currency}; profit remains unavailable until authoritative conversion to ${report.reportingCurrency} exists. ` : ''}Profit is unavailable: ${profit.blockers.join(' ')}`;
    byId('financial-status').textContent = `Shopify source: ${shopifySourceRevenue.quality}${shopifySourceRevenue.currency ? ` (${shopifySourceRevenue.currency})` : ''}. Reporting conversion: ${metrics.revenue.quality}. Product cost: ${productCost.quality}. Payment fees: ${metrics.paymentFees.quality}. Meta: ${metrics.metaSpend.quality}.`;
    const coverage = report.supplierCostCoverage || {};
    byId('cj-cost-coverage').textContent = Number(coverage.orders || 0) > 0
      ? `Supplier cost covers ${Number(coverage.pricedOrders || 0)} of ${Number(coverage.orders || 0)} sale(s) in this window: ${Number(coverage.exactOrders || 0)} from CJ's own order, ${Number(coverage.bundlePricedOrders || 0)} from the identical bundle, ${Number(coverage.unpricedOrders || 0)} not yet priced.`
      : 'No paid sales in this window.';
  }

  function renderCjStatus(status) {
    const connected = Boolean(status?.ok && status?.connected && status?.orderRead);
    byId('source-grid').insertAdjacentHTML('beforeend', `<div class="source-item"><strong>CJ API connection</strong><span>${connected ? 'CONNECTED · READ VERIFIED' : 'UNAVAILABLE'}</span></div>`);
    byId('financial-status').textContent += connected
      ? ' CJ API authentication and read-only order access verified.'
      : ` CJ API unavailable: ${String(status?.error || 'connection check failed').slice(0, 160)}`;
  }

  async function load() {
    byId('contract-status').textContent = 'Loading the authenticated reporting contract...';
    try {
      const queryString = query();
      const config = await apiGet(`/api/growth-cockpit/config?${queryString}`);
      const popupParams = new URLSearchParams();
      if (config.range.from) popupParams.set('from', config.range.from);
      if (config.range.toExclusive) popupParams.set('to', new Date(new Date(config.range.toExclusive).getTime() - 1).toISOString());
      const [finance, popup, cjStatus] = await Promise.all([
        apiGet(`/api/growth-cockpit/finance?${queryString}`),
        apiGet(`/api/analytics/popup?${popupParams.toString()}`),
        apiGet('/api/growth-cockpit/cj-status').catch(error => ({ ok: false, connected: false, error: error.message }))
      ]);
      render(config);
      renderFinance(finance);
      renderPopup(popup, config);
      renderCjStatus(cjStatus);
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
  byId('reconcile-cj').addEventListener('click', async () => {
    const button = byId('reconcile-cj');
    button.disabled = true;
    byId('cj-reconcile-status').textContent = "Pricing this window's sales from CJ's orders, then auditing the ledger against the sales and against CJ...";
    try {
      const params = new URLSearchParams(query());
      const result = await apiRequest('/api/growth-cockpit/cj-reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(params.entries()))
      });
      const summary = result.result || {};
      const audit = await apiRequest('/api/growth-cockpit/cj-cost-audit?days=7');
      const problems = [];
      if ((audit.unpriced || []).length) problems.push(`${audit.unpriced.length} unpriced (${audit.unpriced.slice(0, 6).map(item => item.order).join(', ')})`);
      if ((audit.misdated || []).length) problems.push(`${audit.misdated.length} dated on the wrong day`);
      if ((audit.duplicatesAtCj || []).length) problems.push(`${audit.duplicatesAtCj.length} with more than one CJ order (${audit.duplicatesAtCj.slice(0, 4).map(item => item.order).join(', ')})`);
      if ((audit.needsMapping || []).length) problems.push(`${audit.needsMapping.length} waiting for a supplier mapping (${audit.needsMapping.slice(0, 4).map(item => item.order).join(', ')})`);
      if (audit.cjList && audit.cjList.note) problems.push(audit.cjList.note);
      const clean = `clean — ${Number(audit.priced || 0)} of ${Number(audit.sales || 0)} sale(s) priced on the day of the sale`;
      byId('cj-reconcile-status').textContent = `CJ costs for this window: ${Number(summary.exactOrders || 0)} sale(s) priced from CJ's own order, ${Number(summary.bundlePricedOrders || 0)} from the identical bundle, ${(summary.unpricedOrders || []).length} not priced. Audit of the last 7 days: ${problems.length ? problems.join('; ') : clean}.`;
      await load();
    } catch (error) {
      byId('cj-reconcile-status').textContent = `CJ cost check unavailable: ${error.message || 'Request failed.'}`;
    } finally {
      button.disabled = false;
    }
  });
  load();
});

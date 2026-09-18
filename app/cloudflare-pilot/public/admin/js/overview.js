document.addEventListener("DOMContentLoaded", () => {
  // The store sells in shekels; this screen reads the business in the
  // reporting currency the server converted to, so the formatter follows the
  // response instead of assuming either one.
  const currencyFormatters = new Map();
  let reportingCurrency = "USD";
  const currency = {
    format(value, code) {
      const resolved = code || reportingCurrency || "USD";
      if (!currencyFormatters.has(resolved)) {
        currencyFormatters.set(resolved, new Intl.NumberFormat("en-US", { style: "currency", currency: resolved, maximumFractionDigits: 2 }));
      }
      return currencyFormatters.get(resolved).format(Number(value || 0));
    },
  };
  const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  let reportingWindow = null;

  const byId = id => document.getElementById(id);
  const setText = (id, value) => { const node = byId(id); if (node) node.textContent = value; };

  function queryFor(reportingWindow, extra = {}) {
    return new URLSearchParams({ from: reportingWindow.from, to: reportingWindow.to, mode: "production", ...extra }).toString();
  }

  function showModuleError(prefix, message) {
    const state = byId(`${prefix}-state`);
    if (state) {
      state.textContent = "Unavailable";
      state.className = "module-state error";
    }
    setText(`${prefix}-detail`, message);
  }

  async function loadShopifyStatus() {
    const pill = byId("shopify-connection-status");
    try {
      const status = await API.get("/api/shopify/status");
      const connected = Boolean(status.ok);
      if (pill) {
        pill.className = `connection-pill ${connected ? "connected" : "error"}`;
        pill.innerHTML = `<span class="status-dot" aria-hidden="true"></span>${connected ? "Shopify connected" : "Shopify needs attention"}`;
      }
      setText("status-shopify", connected ? "Connected" : "Needs attention");
      return connected;
    } catch {
      if (pill) {
        pill.className = "connection-pill error";
        pill.innerHTML = '<span class="status-dot" aria-hidden="true"></span>Connection unavailable';
      }
      setText("status-shopify", "Unavailable");
      return false;
    }
  }

  async function loadBusinessMetrics(selectedWindow) {
    const data = await API.get(`/api/analytics/account?${queryFor(selectedWindow)}`);
    if (data.reportingCurrency) reportingCurrency = data.reportingCurrency;
    // Revenue, orders and AOV are painted from the financial contract instead.
    // This endpoint only sees the visitors the app tracked, so its order count
    // is a subset, and showing it beside a profit built on every Shopify order
    // put two different revenues on one screen.
    // The tracked conversion tile is gone. It could only ever divide orders by
    // the visitors this app happened to see, and on most windows it saw none of
    // the buyers, so the honest output was the words "Not measurable" sitting in
    // the middle of a row of real money. The endpoint still returns
    // conversionCoverage and overallConvRate for the analytics page.
    setText("metric-revenue-note", `${selectedWindow.label} · ${selectedWindow.timezone}`);
    setText("metric-orders-note", "Shopify-paid, test orders excluded");
    setText("growth-visitors", integer.format(Number(data.totalVisitors || 0)));
    setText("growth-detail", `${integer.format(Number(data.totalViews || 0))} page views and ${integer.format(Number(data.totalCtas || 0))} tracked calls to action.`);
    return data;
  }

  function resultCell(value, label, className = "") {
    return `<span class="result-cell ${className}"><strong>${value}</strong><span>${label}</span></span>`;
  }

  async function loadExperiment() {
    const slots = await API.get("/api/element-slots");
    const slot = slots.find(item => item.experiment?.status === "RUNNING") || slots.find(item => item.experiment);
    if (!slot?.experiment) {
      byId("experiment-results").innerHTML = '<p class="decision-note">No active experiment.</p>';
      setText("experiment-subtitle", "Create an experiment when you have a focused conversion hypothesis.");
      return null;
    }
    const results = await API.get(`/api/element-experiments/${encodeURIComponent(slot.experiment.id)}/results`);
    setText("experiment-title", slot.name || "Live experiment");
    setText("experiment-subtitle", `${String(results.status || "").toLowerCase()} · Shopify paid orders are the source of truth`);
    const rows = Array.isArray(results.rows) ? results.rows : Array.isArray(results.variants) ? results.variants : [];
    byId("experiment-results").innerHTML = rows.map(row => {
      const revenue = Number(row.netRevenue ?? row.revenue ?? 0);
      const orders = Number(row.paidOrders ?? row.orders ?? 0);
      const visitors = Number(row.exposedVisitors ?? row.visitors ?? 0);
      const cvr = Number(row.purchaseConversionRate ?? row.purchaseCvr ?? row.conversionRate ?? 0);
      return `<div class="experiment-row">
        <span class="variant-name"><strong>${escapeHtml(row.name || row.variantName || "Variant")}</strong><span>${row.isControl ? "Control" : "Variant"}</span></span>
        ${resultCell(integer.format(visitors), "visitors", "exposure-cell")}
        ${resultCell(integer.format(orders), "paid orders")}
        ${resultCell(currency.format(revenue), `${Number.isFinite(cvr) ? cvr.toFixed(1) : "0.0"}% CVR`)}
      </div>`;
    }).join("") || '<p class="decision-note">The test is running, but no results are available yet.</p>';
    setText("experiment-decision", results.recommendation || "Keep collecting data. No winner should be declared from this sample yet.");
    return results;
  }

  async function loadSupport() {
    try {
      const data = await API.get("/api/support/overview");
      const counts = data.counts || {};
      const mailbox = Array.isArray(data.mailboxes) ? data.mailboxes[0] : null;
      setText("support-open", integer.format(Number(counts.open || 0)));
      setText("support-detail", `${integer.format(Number(counts.escalated || 0))} escalated · ${integer.format(Number(counts.pendingReview || 0))} drafts awaiting review.`);
      const state = byId("support-state");
      if (state) {
        const healthy = mailbox && ["RUNNING", "IDLE"].includes(mailbox.agentStatus);
        state.textContent = healthy ? "Agent online" : "Review agent";
        state.className = `module-state ${healthy ? "" : "attention"}`.trim();
      }
      return data;
    } catch {
      showModuleError("support", "Support status could not be loaded.");
      return null;
    }
  }

  var HEALTH_ARC_LENGTH = 270;

  function paintHealth(health) {
    const arc = byId("health-arc");
    const panel = byId("health-panel");
    const list = byId("health-components");
    if (!panel || !arc || !list) return;

    const scored = health && health.score != null;
    panel.dataset.band = scored ? health.band.id : "unknown";
    setText("health-score", scored ? String(health.score) : "—");
    setText("health-band", scored ? health.band.label : "Not measurable");
    setText("health-note", health ? health.note : "Verified sources could not be reached.");
    // The arc is drawn by dashing a fixed-length path, so no score means no fill.
    arc.style.strokeDasharray = String(HEALTH_ARC_LENGTH);
    arc.style.strokeDashoffset = String(scored ? HEALTH_ARC_LENGTH * (1 - health.score / 100) : HEALTH_ARC_LENGTH);

    list.innerHTML = (health && health.components ? health.components : []).map(component => `
      <li data-available="${component.available}">
        <span class="health-component__label">${escapeHtml(component.label)}</span>
        <span class="health-component__value">${escapeHtml(component.display)}</span>
        <span class="health-component__bar"><i style="width:${component.score == null ? 0 : component.score}%"></i></span>
        <span class="health-component__reason">${escapeHtml(component.reason)}</span>
      </li>`).join("");
  }

  function moneyText(metric) {
    if (!metric || metric.amount == null || !metric.currency) return "Unavailable";
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: metric.currency, maximumFractionDigits: 2 }).format(Number(metric.amount));
    } catch {
      return `${Number(metric.amount).toFixed(2)} ${metric.currency}`;
    }
  }

  /**
   * A stat on its own does not say whether the business is moving. Each tile
   * carries the change against the same window just before it, and the last
   * seven days as a sparkline, so direction is readable without opening a
   * second screen.
   *
   * "Better" is not always "bigger": a rising product cost or payment fee is
   * worse, and ad spend is neither on its own.
   */
  const TREND_POLARITY = {
    revenue: "up-good", orders: "up-good", aov: "up-good", roas: "up-good",
    profit: "up-good", becpa: "up-good", takerate: "up-good", conversion: "up-good",
    cogs: "up-bad", fees: "up-bad", risk: "up-bad",
    spend: "neutral",
  };

  function sparkline(series) {
    const values = (series || []).map(point => (point && point.value != null ? Number(point.value) : null));
    const present = values.filter(value => value != null);
    if (present.length < 2) return "";
    const min = Math.min(...present, 0);
    const max = Math.max(...present);
    const span = max - min || 1;
    const step = 100 / Math.max(1, values.length - 1);
    let path = "";
    let started = false;
    values.forEach((value, index) => {
      if (value == null) return;
      const x = (index * step).toFixed(2);
      const y = (26 - ((value - min) / span) * 24).toFixed(2);
      path += `${started ? "L" : "M"}${x} ${y}`;
      started = true;
    });
    if (!path) return "";
    return `<svg class="metric-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  function trendMarkup(id, current, trend) {
    if (!trend || current == null || !Number.isFinite(Number(current))) return "";
    const previous = trend.previous;
    const spark = sparkline(trend.series);
    if (previous == null || !Number.isFinite(Number(previous))) {
      return `<div class="metric-trend"><span class="trend-chip is-flat">No ${escapeHtml(trend.previousLabel || "earlier")} figure</span>${spark}</div>`;
    }
    const delta = Number(current) - Number(previous);
    const pct = Number(previous) === 0 ? null : (delta / Math.abs(Number(previous))) * 100;
    const polarity = TREND_POLARITY[id] || "neutral";
    const direction = Math.abs(delta) < 1e-9 ? "flat" : delta > 0 ? "up" : "down";
    const tone = polarity === "neutral" || direction === "flat"
      ? "is-flat"
      : (direction === "up") === (polarity === "up-good") ? "is-good" : "is-bad";
    const arrow = direction === "flat" ? "→" : direction === "up" ? "▲" : "▼";
    const size = pct == null
      ? `${delta > 0 ? "+" : ""}${Number(delta.toFixed(2))}`
      : `${Math.abs(pct) >= 999 ? ">999" : Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
    const caveat = trend.incomplete ? " (partial history)" : "";
    return `<div class="metric-trend"><span class="trend-chip ${tone}" title="${escapeHtml(`vs ${trend.previousLabel}${caveat}`)}">${arrow} ${escapeHtml(size)}</span><span class="trend-label">vs ${escapeHtml(trend.previousLabel || "before")}</span>${spark}</div>`;
  }

  function paintFinanceTile(id, value, note, quality, conversion, trend, currentValue) {
    setText(`metric-${id}`, value);
    // A converted number is only trustworthy if the reader can see what it
    // was converted from and at which rate.
    if (window.Money) window.Money.explain(byId(`metric-${id}`), conversion);
    if (note) setText(`metric-${id}-note`, note);
    const tile = byId(`metric-${id}`)?.closest(".metric-card");
    if (tile) tile.dataset.quality = quality || "";
    if (!tile) return;
    let holder = tile.querySelector(".metric-trend-slot");
    if (!holder) {
      holder = document.createElement("div");
      holder.className = "metric-trend-slot";
      byId(`metric-${id}`)?.insertAdjacentElement("afterend", holder);
    }
    holder.innerHTML = trendMarkup(id, currentValue, trend);
  }

  /**
   * Financial metrics used to live on a separate screen, so the first screen
   * could not answer whether the day was profitable. They are read from the
   * same verified sources here, for the same reporting window.
   */
  async function loadFinance(selectedWindow) {
    const blank = ["spend", "roas", "cogs", "fees", "profit", "becpa"];
    try {
      const params = new URLSearchParams({ from: selectedWindow.fromLabel, to: selectedWindow.toLabel });
      const data = await API.get(`/api/growth-cockpit/finance?${params.toString()}`);
      const metrics = data.metrics || {};
      const profit = data.profit || {};
      const revenue = metrics.revenue || {};
      const spend = metrics.metaSpend || {};

      const orderCount = Number(metrics.orders?.amount ?? 0);
      // The previous window is measured exactly as the current one is, so a
      // derived stat is compared against the same stat derived the same way.
      // The sparkline comes from the settled daily rows behind it.
      const previousMetrics = data.comparison?.previousMetrics || null;
      const daily = data.comparison?.daily?.metrics || {};
      const dailyDates = data.comparison?.daily?.seriesDates || [];
      const previousLabel = data.comparison?.previousLabel || "the previous period";
      const num = value => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
      const prevRevenue = num(previousMetrics?.revenue);
      const prevOrders = num(previousMetrics?.orders);
      const prevSpend = num(previousMetrics?.adSpend);
      const prevCost = num(previousMetrics?.productCost);
      const prevFees = num(previousMetrics?.paymentFees);
      const series = key => daily[key]?.series || [];
      const combine = (keys, fn) => dailyDates.map((date, index) => {
        const values = keys.map(key => daily[key]?.series?.[index]?.value ?? null);
        const value = values.some(one => one == null) ? null : fn(...values.map(Number));
        return { date, value: value == null || !Number.isFinite(value) ? null : value };
      });
      const trend = (previous, seriesPoints) => ({
        previous, previousLabel, series: seriesPoints || [],
        incomplete: Boolean(data.comparison?.daily?.metrics?.netRevenue?.incomplete),
      });
      const compare = {
        netRevenue: trend(prevRevenue, series("netRevenue")),
        orders: trend(prevOrders, series("orders")),
        adSpend: trend(prevSpend, series("adSpend")),
        productCost: trend(prevCost, series("productCost")),
        paymentFees: trend(prevFees, series("paymentFees")),
      };
      const derived = (value, seriesPoints) => trend(value, seriesPoints);

      paintFinanceTile("revenue", moneyText(revenue), "Shopify net payments", revenue.quality, revenue.conversion,
        compare.netRevenue, revenue.amount);
      setText("metric-orders", new Intl.NumberFormat("en-US").format(orderCount));
      paintFinanceTile("orders", new Intl.NumberFormat("en-US").format(orderCount), null, undefined, null,
        compare.orders, orderCount);
      paintFinanceTile("aov", orderCount > 0 && revenue.amount != null
        ? moneyText({ amount: Number(revenue.amount) / orderCount, currency: revenue.currency })
        : "Unavailable", "Net revenue ÷ paid orders", revenue.quality,
        revenue.conversion && orderCount > 0
          ? { ...revenue.conversion, originalAmount: Number((revenue.conversion.originalAmount / orderCount).toFixed(2)) }
          : null,
        derived(prevRevenue != null && prevOrders ? prevRevenue / prevOrders : null, combine(["netRevenue", "orders"], (r, o) => (o ? r / o : null))),
        orderCount > 0 && revenue.amount != null ? Number(revenue.amount) / orderCount : null);
      paintFinanceTile("spend", moneyText(spend), spend.source || "Meta Ads", spend.quality, null,
        compare.adSpend, spend.amount);
      const cost = metrics.productCost || {};
      const costLabel = cost.amount == null
        ? "CJ costs are not synchronised for this window"
        : "What CJ charges for these orders";
      paintFinanceTile("cogs", moneyText(cost), costLabel, cost.quality, cost.conversion,
        compare.productCost, cost.amount);
      // Profit is never shown as more certain than the cost it was built on.
      const profitQuality = profit.complete ? (profit.costQuality || "ACTUAL") : "MISSING";
      const costWord = "product cost";
      const feeWord = profit.paymentFeesIncluded ? " − payment fees" : "";
      paintFinanceTile("fees", moneyText(metrics.paymentFees), "Shopify transaction fees", metrics.paymentFees?.quality, metrics.paymentFees?.conversion,
        compare.paymentFees, metrics.paymentFees?.amount);

      const canDivide = revenue.amount != null && Number(spend.amount) > 0 && revenue.currency === spend.currency;
      paintFinanceTile("roas", canDivide ? `${(Number(revenue.amount) / Number(spend.amount)).toFixed(2)}×` : "Unavailable",
        canDivide ? "Net revenue ÷ ad spend" : "Needs revenue and ad spend in one currency", canDivide ? "ACTUAL" : "MISSING", null,
        derived(prevRevenue != null && prevSpend ? prevRevenue / prevSpend : null, combine(["netRevenue", "adSpend"], (r, a) => (a ? r / a : null))),
        canDivide ? Number(revenue.amount) / Number(spend.amount) : null);

      const prevProfit = prevRevenue != null && prevCost != null && prevSpend != null
        ? prevRevenue - prevCost - prevSpend - (prevFees ?? 0)
        : null;
      paintFinanceTile("profit", profit.cm2 != null ? moneyText({ amount: profit.cm2, currency: profit.currency }) : "Unavailable",
        profit.complete ? `Revenue − ${costWord}${feeWord} − ad spend` : (profit.blockers || ["Incomplete inputs"]).join(" "),
        profitQuality, null,
        derived(prevProfit, combine(["netRevenue", "productCost", "adSpend", "paymentFees"], (r, c, a, f) => r - c - a - f)),
        profit.cm2);

      paintFinanceTile("becpa", profit.breakEvenCpa != null ? moneyText({ amount: profit.breakEvenCpa, currency: profit.currency }) : "Unavailable",
        profit.breakEvenCpa != null
          ? `Most you can pay per order and break even${profit.paymentFeesIncluded ? ", after payment fees" : ", before payment fees"}`
          : "Needs product cost and revenue",
        profit.breakEvenCpa != null ? profitQuality : "MISSING", null,
        derived(prevRevenue != null && prevCost != null && prevOrders ? (prevRevenue - prevCost - (prevFees ?? 0)) / prevOrders : null,
          combine(["netRevenue", "productCost", "paymentFees", "orders"], (r, c, f, o) => (o ? (r - c - f) / o : null))),
        profit.breakEvenCpa);

      paintHealth(data.health);

      if (data.fx?.length) {
        const rate = data.fx[0];
        setText("metric-revenue-note", `${selectedWindow.label} · ${selectedWindow.timezone} · ${rate.note}`);
      }
      return data;
    } catch (error) {
      blank.forEach(id => paintFinanceTile(id, "Unavailable", "Verified financial sources could not be reached.", "MISSING"));
      paintHealth(null);
      return null;
    }
  }

  /**
   * Blended ROAS can look healthy while one ad set buys every order above what
   * the business can afford. This compares each ad set's cost per purchase with
   * the store's own break-even CPA and says which to cut.
   */
  async function loadAdSets(selectedWindow) {
    const panel = byId("adset-breakdown");
    const rows = byId("adset-rows");
    if (!panel || !rows) return;
    try {
      const params = new URLSearchParams({ from: selectedWindow.fromLabel, to: selectedWindow.toLabel });
      const data = await API.get(`/api/growth-cockpit/ad-sets?${params.toString()}`);
      const adSets = Array.isArray(data.adSets) ? data.adSets : [];
      panel.hidden = adSets.length === 0;
      if (!adSets.length) return;
      const over = adSets.filter(row => row.verdict === "OVER_BREAK_EVEN").length;
      setText("adset-state", over ? `${over} above break-even` : "All within break-even");
      const ceiling = data.breakEvenCpa != null ? moneyText({ amount: data.breakEvenCpa, currency: data.currency }) : null;
      rows.innerHTML = adSets.map(row => {
        const cost = row.costPerPurchase != null ? moneyText({ amount: row.costPerPurchase, currency: data.adSetCurrency }) : "no purchase yet";
        const label = row.verdict === "OVER_BREAK_EVEN" ? "CUT OR FIX"
          : row.verdict === "UNDER_BREAK_EVEN" ? "PROFITABLE"
          : row.verdict === "NO_PURCHASES" ? "NO SALES" : "UNKNOWN";
        const severity = row.verdict === "OVER_BREAK_EVEN" ? "CRITICAL" : row.verdict === "NO_PURCHASES" ? "WARNING" : "";
        const headroom = row.headroom != null
          ? `${row.headroom >= 0 ? "$" + row.headroom.toFixed(2) + " under" : "$" + Math.abs(row.headroom).toFixed(2) + " over"} the ceiling`
          : "";
        return `<div class="offer-row" data-severity="${escapeHtml(severity)}">
          <span class="offer-row__title">${escapeHtml(row.adSetName)}</span>
          <span class="offer-row__rate">${escapeHtml(label)}</span>
          <span class="offer-row__meta">${escapeHtml(row.campaignName)} · ${escapeHtml(moneyText({ amount: row.spend, currency: data.adSetCurrency }))} spent · ${escapeHtml(String(row.purchases))} purchase(s) · ${escapeHtml(cost)} each${headroom ? " · " + escapeHtml(headroom) : ""}</span>
        </div>`;
      }).join("");
      setText("adset-note", ceiling
        ? `Break-even is ${ceiling} per order: revenue minus product cost and payment fees, divided by orders. Purchases are as Meta attributes them.`
        : "Break-even could not be computed for this window, so no ad set is judged.");
    } catch (error) {
      panel.hidden = true;
    }
  }

  /** Take rate answers whether the offer is working, not just whether it exists. */
  async function loadTakeRates(selectedWindow) {
    const panel = byId("offer-breakdown");
    const rows = byId("offer-rows");
    try {
      const params = new URLSearchParams({ from: selectedWindow.fromLabel, to: selectedWindow.toLabel });
      const data = await API.get(`/api/growth-cockpit/take-rates?${params.toString()}`);
      const measurable = data.quality === "ACTUAL" && data.anyOfferTakeRatePct != null;
      paintFinanceTile("takerate", measurable ? `${data.anyOfferTakeRatePct.toFixed(1)}%` : "Not measurable", data.note, measurable ? "ACTUAL" : "MISSING");
      if (panel && rows) {
        const offers = data.offers || [];
        panel.hidden = offers.length === 0;
        rows.innerHTML = offers.map(offer => `
          <div class="offer-row">
            <span class="offer-row__title">${escapeHtml(offer.title)}</span>
            <span class="offer-row__rate">${offer.takeRatePct == null ? "—" : offer.takeRatePct.toFixed(1) + "%"}</span>
            <span class="offer-row__meta">${offer.ordersWithOffer} of ${data.paidOrders} orders · ${offer.unitsSold} unit(s)</span>
          </div>`).join("");
        setText("offer-note", data.note);
      }
      return data;
    } catch {
      paintFinanceTile("takerate", "Unavailable", "Cart offer performance could not be read.", "MISSING");
      if (panel) panel.hidden = true;
      return null;
    }
  }

  /**
    * Shipment risk is the earliest visible cause of a chargeback, and it was
    * only reachable by opening a separate screen. It is surfaced here because
    * this is the screen the owner actually opens.
    */
  async function loadAttention() {
    const panel = byId("attention-panel");
    const rows = byId("attention-rows");
    try {
      const health = await API.get("/api/operations/health");
      const shipments = health.systems?.shipments || {};
      const atRisk = Number(shipments.actionable || 0);
      paintFinanceTile("risk", Number.isFinite(atRisk) ? atRisk.toLocaleString() : "Unavailable",
        `${Number(shipments.critical || 0)} critical · reconciled ${shipments.lastReconciledAt ? new Date(shipments.lastReconciledAt).toLocaleString() : "never"}`,
        shipments.state === "CURRENT" ? "ACTUAL" : "MISSING");

      const incidents = (health.incidents || []).filter(item => item.severity !== "INFO");
      if (panel && rows) {
        panel.hidden = incidents.length === 0;
        setText("attention-state", incidents.length ? `${incidents.length} to act on` : "All clear");
        const rank = { CRITICAL: 0, WARNING: 1 };
        rows.innerHTML = incidents
          .sort((a, b) => (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2))
          .map(item => `
            <div class="offer-row" data-severity="${escapeHtml(item.severity)}">
              <span class="offer-row__title">${escapeHtml(item.title)}</span>
              <span class="offer-row__rate">${escapeHtml(item.severity)}</span>
              <span class="offer-row__meta">${escapeHtml(item.area)} · ${escapeHtml(item.action)}</span>
            </div>`).join("");
      }
      return health;
    } catch {
      paintFinanceTile("risk", "Unavailable", "Operations health could not be reached.", "MISSING");
      if (panel) panel.hidden = true;
      return null;
    }
  }

  async function loadConcierge(selectedWindow) {
    try {
      const data = await API.get(`/api/analytics/popup?${queryFor(selectedWindow, { experience: "concierge" })}`);
      const metrics = data.metrics || {};
      setText("concierge-sales", integer.format(Number(metrics.popupAttributedOrders || 0)));
      setText("concierge-detail", `${integer.format(Number(metrics.popupViews || 0))} opens · ${integer.format(Number(metrics.successfulLeads || 0))} saved leads · ${currency.format(Number(metrics.popupAttributedRevenue || 0))} verified revenue.`);
      const state = byId("concierge-state");
      if (state) {
        const hasSales = Number(metrics.popupAttributedOrders || 0) > 0;
        state.textContent = hasSales ? "Converting" : "No verified sales";
        state.className = `module-state ${hasSales ? "" : "attention"}`.trim();
      }
      return data;
    } catch {
      showModuleError("concierge", "Concierge performance could not be loaded.");
      return null;
    }
  }

  async function refresh(selectedWindow) {
    reportingWindow = selectedWindow;
    const banner = byId("truth-banner");
    const [connected, metrics, finance, , , experiment] = await Promise.all([
      loadShopifyStatus(),
      loadBusinessMetrics(selectedWindow).catch(() => null),
      loadFinance(selectedWindow).catch(() => null),
      loadTakeRates(selectedWindow).catch(() => null),
      loadAdSets(selectedWindow).catch(() => null),
      loadAttention().catch(() => null),
      loadExperiment().catch(() => null),
      loadSupport(),
      loadConcierge(selectedWindow),
    ]);
    const healthy = connected && Boolean(metrics) && Boolean(finance) && Boolean(experiment);
    if (banner) banner.className = `truth-banner ${healthy ? "" : "warning"}`.trim();
    setText("truth-status", healthy ? "Healthy" : "Needs review");
    setText("truth-title", healthy ? "Shopify revenue and experiment attribution are reporting" : "One or more reporting sources could not be verified");
    setText("truth-detail", healthy ? "Orders reconcile into the attribution ledger every five minutes." : "Financial decisions should remain anchored to Shopify until the warning is cleared.");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  }

  const rangeHost = byId("overview-range");
  if (rangeHost && window.RangePicker) {
    const picker = window.RangePicker.mount(rangeHost, {
      storageKey: "fc.reportingWindow",
      defaultPreset: "today",
      onChange: selected => { refresh(selected).catch(() => {}); },
    });
    refresh(picker.current()).catch(() => {});
  } else {
    // The dashboard must still report if the window control fails to load, so
    // fall back to today rather than leaving every metric blank.
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setUTCHours(0, 0, 0, 0);
    refresh({
      from: startOfToday.toISOString(),
      to: now.toISOString(),
      label: "Today",
      timezone: "UTC",
    }).catch(() => {});
    if (rangeHost) rangeHost.textContent = "Reporting window control unavailable; showing today.";
  }
});

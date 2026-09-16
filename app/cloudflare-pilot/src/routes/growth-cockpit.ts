import { Router } from "express";
import {
  getGrowthCockpitConfig,
  addCalendarDays,
  previousEquivalentGrowthCockpitRange,
  resolveGrowthCockpitRange,
  type GrowthCockpitConfig,
  type GrowthCockpitDateRange,
} from "../lib/growth-cockpit-config.js";
import {
  compareGrowthCockpitMetric,
  GROWTH_COCKPIT_METRIC_DEFINITIONS,
} from "../lib/growth-cockpit-comparison.js";
import {
  computeGrowthCockpitProfit,
  computeGrowthCockpitProfitBeforePaymentFees,
  convertFinancialMetric,
  missingFinancialMetric,
  type FinancialMetric,
} from "../lib/growth-cockpit-finance.js";
import prisma from "../lib/db.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { fetchMetaSpend } from "../lib/meta-ads.js";
import { resolveFxRate, type FxRateResolution } from "../lib/fx.js";
import { computeOperatingHealth } from "../lib/operating-health.js";
import { computeOfferTakeRates } from "../services/offer-take-rate.js";
import { testCjReadConnection } from "../services/novahair-monitor.js";
import { reconcileCjCosts } from "../services/cj-cost-reconcile.js";
import { reconcileCjPaidCosts } from "../services/cj-paid-costs.js";
import { sumDailyCoverage } from "../lib/financial-window.js";
import { reportingMoneyFor, type ReportingMoney } from "../lib/reporting-currency.js";
import { dashboardComparison, snapshotDashboardDaily } from "../services/dashboard-daily.js";
import { fetchMetaAdSetPerformance, judgeAdSets } from "../lib/meta-campaign-spend.js";
import {
  aggregateFinancialLedger,
  dailyFinancialLedger,
  readDailyFinancialCoverage,
  supplierCostForRange,
  persistFinancialLedgerCoverage,
  persistFinancialLedgerEntries,
} from "../lib/financial-ledger.js";

const router = Router();
const shopify = new ShopifyAdminClient();

function sessionToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
}

function reportingCurrencyConverter(reportingCurrency: string | null) {
  const pending = new Map<string, Promise<FxRateResolution>>();
  const applied = new Map<string, FxRateResolution>();

  return {
    async convert(metric: FinancialMetric): Promise<FinancialMetric> {
      const needsRate = Boolean(
        reportingCurrency && metric.currency && metric.currency !== reportingCurrency && metric.amount != null,
      );
      if (!needsRate) return convertFinancialMetric(metric, reportingCurrency, null);

      const key = `${metric.currency}:${reportingCurrency}`;
      if (!pending.has(key)) pending.set(key, resolveFxRate(metric.currency as string, reportingCurrency as string));
      const quote = await pending.get(key)!;
      applied.set(key, quote);
      return convertFinancialMetric(metric, reportingCurrency, quote);
    },
    rates(): FxRateResolution[] {
      return [...applied.values()];
    },
  };
}

async function d1OrderLedger(range: ReturnType<typeof resolveGrowthCockpitRange>) {
  const shopDomain = workerEnvValue("SHOP_DOMAIN").toLowerCase();
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) {
    return {
      rows: 0,
      orders: 0,
      metric: missingFinancialMetric("SHOPIFY_WEBHOOK_D1", "The configured shop has no D1 order ledger."),
      currencies: [] as string[],
      webhookDeliveries: 0,
      linkedToVisitor: 0,
    };
  }
  const paidAt = range.from || range.toExclusive
    ? { ...(range.from ? { gte: new Date(range.from) } : {}), ...(range.toExclusive ? { lt: new Date(range.toExclusive) } : {}) }
    : undefined;
  const orders = await prisma.orderAttribution.findMany({
    where: { shopId: shop.id, isTest: false, ...(paidAt ? { paidAt } : {}) },
    select: { netRevenueAmount: true, currency: true, status: true, checkoutToken: true },
  });
  const orderCheckoutTokens = orders.map(order => order.checkoutToken).filter((token): token is string => Boolean(token));
  const linkedToVisitor = orderCheckoutTokens.length
    ? await prisma.checkoutAttribution.count({ where: { checkoutToken: { in: orderCheckoutTokens }, visitorId: { not: null } } })
    : 0;
  const currencies = [...new Set(orders.map(order => order.currency.toUpperCase()))];
  const amount = currencies.length <= 1
    ? Number(orders.reduce((sum, order) => sum + Number(order.netRevenueAmount || 0), 0).toFixed(2))
    : null;
  const webhookDeliveries = await prisma.shopifyWebhookDelivery.count({
    where: { shopId: shop.id, topic: { in: ["orders/paid", "orders/updated"] } },
  });
  return {
    rows: orders.length,
    linkedToVisitor,
    orders: orders.filter(order => order.status !== "REFUNDED_OR_CANCELLED" && order.netRevenueAmount > 0).length,
    metric: orders.length && amount != null
      ? {
          amount,
          currency: currencies[0] ?? null,
          quality: "PARTIAL" as const,
          source: "SHOPIFY_WEBHOOK_D1",
          note: "A partial shadow of Shopify built from webhook deliveries, not the store's revenue. It covers only the orders whose webhooks this app received, and stands in only while Shopify itself cannot be read.",
        }
      : missingFinancialMetric(
          "SHOPIFY_WEBHOOK_D1",
          currencies.length > 1
            ? "The D1 ledger contains mixed presentment currencies and has no authoritative FX normalization."
            : "No production order rows were observed in D1 for this range; zero cannot be confirmed from webhook coverage alone.",
        ),
    currencies,
    webhookDeliveries,
  };
}

type ShopifyWindowSummary = Awaited<ReturnType<ShopifyAdminClient["orderFinancialSummary"]>>;

interface ShopifyWindowRead {
  value: ShopifyWindowSummary | null;
  error: string | null;
  servedFrom: "LIVE" | "SETTLED_DAYS" | "SETTLED_DAYS_PLUS_TODAY";
  /**
   * Rates this read already applied. The shop's currency changed mid-year, so
   * days are converted before they are summed; without carrying the rates the
   * screen would show a dollar figure it cannot explain on hover.
   */
  fx?: FxRateResolution[];
}

/**
 * Restates a Shopify window in the reporting currency.
 *
 * Shop money is whatever the store's currency was at the time, and this store
 * switched from dollars to shekels partway through the year. A window holding
 * both used to report no amount at all, which quietly dropped the dashboard
 * back onto stale webhook rows.
 */
async function restateSummaryCurrency(summary: ShopifyWindowSummary): Promise<ShopifyWindowSummary> {
  const money = await reportingMoneyFor([
    ...summary.byCurrency.map(entry => entry.currency),
    ...(summary.paymentFees?.byCurrency ?? []).map(entry => entry.currency),
  ]);
  if (!money.currency) return summary;
  const convertAll = (entries: Array<{ currency: string; amount: number }>) => {
    const converted = entries.map(entry => money.convert(entry.amount, entry.currency));
    if (converted.some(value => value == null)) return null;
    return Number(converted.reduce((sum, value) => (sum as number) + (value as number), 0)!.toFixed(2));
  };
  const revenue = convertAll(summary.byCurrency);
  const fees = summary.paymentFees ? convertAll(summary.paymentFees.byCurrency) : null;
  const mixed = summary.byCurrency.length > 1;
  return {
    ...summary,
    amount: revenue,
    currency: revenue == null ? null : money.currency,
    byCurrency: revenue == null ? summary.byCurrency : [{ currency: money.currency, amount: revenue, orders: summary.orders }],
    quality: revenue == null || money.quality !== "ACTUAL" || summary.quality !== "ACTUAL"
      ? "PARTIAL" as const
      : "ACTUAL" as const,
    definition: mixed
      ? `${summary.definition} Converted to ${money.currency} at published daily rates; the window spans a change of store currency.`
      : summary.definition,
    paymentFees: summary.paymentFees
      ? {
          ...summary.paymentFees,
          amount: fees,
          currency: fees == null ? null : money.currency,
          byCurrency: fees == null ? summary.paymentFees.byCurrency : [{ currency: money.currency, amount: fees }],
        }
      : null,
  };
}

function liveShopifyWindow(range: GrowthCockpitDateRange, token: string | undefined): Promise<ShopifyWindowRead> {
  return shopify.orderFinancialSummary({ from: range.from, toExclusive: range.toExclusive, sessionToken: token })
    .then(restateSummaryCurrency)
    .then(value => ({ value, error: null as string | null, servedFrom: "LIVE" as const }))
    .catch(error => ({
      value: null,
      error: String(error?.message || "Shopify order query failed.").slice(0, 300),
      servedFrom: "LIVE" as const,
    }));
}

/**
 * Reads a reporting window without asking Shopify for months of orders.
 *
 * A ninety-day window is nine hundred orders over ten paged calls, which took
 * long enough that the dashboard gave up and showed nothing at all. Every day
 * before today has already been reconciled and stored by the cron, so those
 * days are added up from the ledger and only the current, unfinished day is
 * read live. If even one settled day is missing from the ledger the whole
 * window falls back to the live read: a smaller number presented as the
 * period's total would be worse than a slow one.
 */
async function shopifyWindowFinancials(
  range: GrowthCockpitDateRange,
  token: string | undefined,
): Promise<ShopifyWindowRead> {
  if (!range.localFrom || !range.localTo) return liveShopifyWindow(range, token);

  const todayLabel = resolveGrowthCockpitRange({ preset: "today", timezone: range.timezone }).localFrom;
  if (!todayLabel) return liveShopifyWindow(range, token);
  const lastSettledDay = addCalendarDays(todayLabel, -1);
  const settledTo = range.localTo < lastSettledDay ? range.localTo : lastSettledDay;
  const needsToday = range.localTo >= todayLabel;
  if (range.localFrom > settledTo) return liveShopifyWindow(range, token);

  const [revenueRows, feeRows] = await Promise.all([
    readDailyFinancialCoverage({
      source: "SHOPIFY_ADMIN_ORDERS",
      category: "NET_PAYMENTS",
      localFrom: range.localFrom,
      localTo: settledTo,
    }).catch(() => []),
    readDailyFinancialCoverage({
      source: "SHOPIFY_TRANSACTION_FEES",
      category: "PAYMENT_FEES",
      localFrom: range.localFrom,
      localTo: settledTo,
    }).catch(() => []),
  ]);

  // The shop's currency was switched mid-year, so a long window holds days
  // recorded in two currencies. Each day is converted on its own before the
  // days are added together.
  const dayMoney = await reportingMoneyFor([...revenueRows, ...feeRows].map(row => row.currency));
  const convertRows = (rows: typeof revenueRows) => rows.map(row => {
    const converted = dayMoney.convert(row.amount, row.currency);
    return converted == null ? row : { ...row, amount: converted, currency: dayMoney.currency as string };
  });
  const settledRevenue = sumDailyCoverage(convertRows(revenueRows), range.localFrom, settledTo);
  if (!settledRevenue.complete) return liveShopifyWindow(range, token);
  const settledFees = sumDailyCoverage(convertRows(feeRows), range.localFrom, settledTo);

  let today: ShopifyWindowSummary | null = null;
  if (needsToday) {
    const todayRange = resolveGrowthCockpitRange({ preset: "today", timezone: range.timezone });
    const liveToday = await liveShopifyWindow(todayRange, token);
    // The settled days are still worth serving when the current day fails.
    if (liveToday.value) today = await restateSummaryCurrency(liveToday.value);
  }

  const currencies = [...new Set([settledRevenue.currency, today?.currency].filter(Boolean) as string[])];
  const feeCurrencies = [...new Set([
    settledFees.days ? settledFees.currency : null,
    today?.paymentFees?.currency ?? null,
  ].filter(Boolean) as string[])];

  const amount = currencies.length <= 1
    ? Number((settledRevenue.amount + Number(today?.amount ?? 0)).toFixed(2))
    : null;
  const feesMeasured = settledFees.days > 0 || Boolean(today?.paymentFees);
  const feesCoverSettledDays = settledFees.complete || settledFees.days === 0;
  const todayIncomplete = needsToday && !today;

  return {
    servedFrom: needsToday ? "SETTLED_DAYS_PLUS_TODAY" : "SETTLED_DAYS",
    error: null,
    // Each day was converted here, so the rates used have to travel with the
    // figure; otherwise the screen shows a dollar amount it cannot explain.
    fx: dayMoney.rates,
    value: {
      source: "SHOPIFY_ADMIN_ORDERS",
      rows: settledRevenue.days + Number(today?.rows ?? 0),
      orders: settledRevenue.orders + Number(today?.orders ?? 0),
      amount,
      currency: currencies.length === 1 ? currencies[0] : null,
      byCurrency: currencies.length === 1
        ? [{ currency: currencies[0], amount: Number((settledRevenue.amount + Number(today?.amount ?? 0)).toFixed(2)), orders: settledRevenue.orders + Number(today?.orders ?? 0) }]
        : [],
      quality: todayIncomplete || currencies.length > 1 || settledRevenue.quality !== "ACTUAL" || dayMoney.quality !== "ACTUAL"
        ? "PARTIAL" as const
        : "ACTUAL" as const,
      truncated: Boolean(today?.truncated),
      rangeWithinDefaultOrderWindow: true,
      definition: needsToday
        ? "Reconciled daily Shopify net payments for every finished day in the window, plus a live read of the current day."
        : "Reconciled daily Shopify net payments for every day in the window.",
      paymentFees: feesMeasured && feeCurrencies.length === 1
        ? {
            amount: Number((settledFees.amount + Number(today?.paymentFees?.amount ?? 0)).toFixed(2)),
            currency: feeCurrencies[0] ?? null,
            byCurrency: [{ currency: feeCurrencies[0], amount: Number((settledFees.amount + Number(today?.paymentFees?.amount ?? 0)).toFixed(2)) }],
            quality: feesCoverSettledDays && !todayIncomplete && (today?.paymentFees?.quality ?? "ACTUAL") === "ACTUAL"
              ? "ACTUAL" as const
              : "PARTIAL" as const,
            source: "SHOPIFY_TRANSACTION_FEES",
            rows: settledFees.days + Number(today?.paymentFees?.rows ?? 0),
            definition: "Reconciled Shopify Payments transaction fees and fee tax for the window.",
          }
        : null,
    },
  };
}

/**
 * Repeated loads of the same window are answered from memory.
 *
 * Every visit to the overview recomputed the window and its comparison
 * period from scratch, so moving between screens paid the full cost again.
 * A finished period cannot change, and the current day changes at the pace
 * of orders, so each is held for as long as it can be trusted.
 */
const FINANCE_CACHE_TTL_SETTLED_MS = 5 * 60 * 1000;
const FINANCE_CACHE_TTL_CURRENT_MS = 60 * 1000;
const FINANCE_CACHE_MAX_ENTRIES = 40;
const financeCache = new Map<string, { expiresAt: number; payload: Record<string, unknown> }>();

function readFinanceCache(key: string): Record<string, unknown> | null {
  const hit = financeCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    financeCache.delete(key);
    return null;
  }
  return hit.payload;
}

function writeFinanceCache(key: string, payload: Record<string, unknown>, includesCurrentDay: boolean): void {
  if (financeCache.size >= FINANCE_CACHE_MAX_ENTRIES) {
    for (const [oldest] of financeCache) {
      financeCache.delete(oldest);
      if (financeCache.size < FINANCE_CACHE_MAX_ENTRIES) break;
    }
  }
  financeCache.set(key, {
    payload,
    expiresAt: Date.now() + (includesCurrentDay ? FINANCE_CACHE_TTL_CURRENT_MS : FINANCE_CACHE_TTL_SETTLED_MS),
  });
}

async function financeSnapshot(config: GrowthCockpitConfig, range: GrowthCockpitDateRange, token: string | undefined) {
  const reportingCurrency = reportingCurrencyConverter(config.reportingCurrency);
  const [d1, shopifyResult] = await Promise.all([
    d1OrderLedger(range),
    shopifyWindowFinancials(range, token),
  ]);
  const liveMetric: FinancialMetric = shopifyResult.value
    ? {
        amount: shopifyResult.value.amount,
        currency: shopifyResult.value.currency,
        quality: shopifyResult.value.amount == null ? "MISSING" : shopifyResult.value.quality,
        source: shopifyResult.value.source,
        note: shopifyResult.value.definition,
      }
    : missingFinancialMetric("SHOPIFY_ADMIN_ORDERS", shopifyResult.error || "Shopify order query was unavailable.");
  const observedRevenue = liveMetric.amount != null ? liveMetric : d1.metric;
  const revenue = await reportingCurrency.convert(observedRevenue);
  const cjCosts = await aggregateFinancialLedger({
    source: "CJ_ORDER_COSTS",
    category: "CJ_VARIABLE_COST",
    localFrom: range.localFrom,
    localTo: range.localTo,
    note: "No reviewed CJ cost rows exist for this range.",
  }).catch(() => missingFinancialMetric("CJ_ORDER_COSTS", "The CJ financial ledger is not initialized."))
    .then(metric => reportingCurrency.convert(metric));
  const cjPaidCosts = await aggregateFinancialLedger({
    source: "CJ_PAID_ORDERS",
    category: "ACCOUNT_PAID_ORDER_COST",
    localFrom: range.localFrom,
    localTo: range.localTo,
    note: "No CJ account paid-order costs have been synchronized for this range.",
  }).catch(() => missingFinancialMetric("CJ_PAID_ORDERS", "The CJ paid-order ledger is not initialized."))
    .then(metric => reportingCurrency.convert(metric));
  const cjPaidCostsDaily = await dailyFinancialLedger({
    source: "CJ_PAID_ORDERS",
    category: "ACCOUNT_PAID_ORDER_COST",
    localFrom: range.localFrom,
    localTo: range.localTo,
  }).catch(() => []);
  const paymentFees = shopifyResult.value?.paymentFees
    ? await reportingCurrency.convert({
        amount: shopifyResult.value.paymentFees.amount,
        currency: shopifyResult.value.paymentFees.currency,
        quality: shopifyResult.value.paymentFees.quality,
        source: shopifyResult.value.paymentFees.source,
        note: shopifyResult.value.paymentFees.definition,
      })
    : missingFinancialMetric("SHOPIFY_TRANSACTION_FEES", "Shopify did not return complete transaction fee rows for this period.");
  const metaResult = await fetchMetaSpend({ localFrom: range.localFrom, localTo: range.localTo });
  let metaLedgerSaved = 0;
  let metaLedgerError: string | null = null;
  if (metaResult.amount != null && metaResult.currency && metaResult.accountId) {
    try {
      metaLedgerSaved = await persistFinancialLedgerEntries(metaResult.daily.map(entry => ({
        source: "META_ADS_INSIGHTS",
        category: "AD_SPEND",
        externalKey: `${metaResult.accountId}:${entry.date}`,
        occurredDate: entry.date,
        amount: entry.amount,
        currency: metaResult.currency as string,
        quality: metaResult.quality,
        metadata: { accountId: metaResult.accountId },
      })));
      await persistFinancialLedgerCoverage({
        source: "META_ADS_INSIGHTS",
        category: "AD_SPEND",
        localFrom: range.localFrom,
        localTo: range.localTo,
        amount: metaResult.amount,
        currency: metaResult.currency,
        quality: metaResult.quality,
        rowCount: metaResult.rows,
        metadata: { accountId: metaResult.accountId },
      });
    } catch (error: any) {
      metaLedgerError = String(error?.message || "Meta ledger persistence failed.").slice(0, 180);
    }
  }
  const metaSpend = await reportingCurrency.convert({
    amount: metaResult.amount,
    currency: metaResult.currency,
    quality: metaResult.quality,
    source: metaResult.source,
    note: metaResult.note,
  });
  const orderCount = shopifyResult.value?.orders ?? d1.orders;
  const orders: FinancialMetric = {
    amount: orderCount,
    currency: null,
    quality: observedRevenue.quality,
    source: observedRevenue.source,
    note: "Orders with a positive Shopify net payment in the selected period. Order count remains valid when currency conversion is unavailable.",
  };
  const acceptedCjPaidCosts: FinancialMetric = cjPaidCosts.amount != null && cjPaidCosts.currency
    ? {
        ...cjPaidCosts,
        quality: "ACTUAL",
        note: "CJ paid-order totals, dated by the day CJ charged the account.",
      }
    : cjPaidCosts;
  // Supplier cost is one row per sale at the price CJ charges for it, dated by
  // the sale. The account-level paid totals are dated by CJ's charge day, days
  // after the sale, so they answer a different question and are reported
  // alongside rather than standing in for this one.
  const supplierCost = await supplierCostForRange({ localFrom: range.localFrom, localTo: range.localTo })
    .catch(() => null);
  const pricedOrders = supplierCost?.pricedOrders ?? 0;
  const unpricedOrders = Math.max(0, orderCount - pricedOrders);
  const productCost: FinancialMetric = supplierCost && supplierCost.amount != null
    ? await reportingCurrency.convert({
        amount: supplierCost.amount,
        currency: supplierCost.currency,
        quality: unpricedOrders === 0 ? "ACTUAL" : "PARTIAL",
        source: supplierCost.source,
        note: unpricedOrders === 0
          ? supplierCost.note
          : `${supplierCost.note} ${unpricedOrders} of ${orderCount} sale(s) in this window have no CJ order and no earlier CJ price for their bundle, so their cost is not included.`,
      })
    : missingFinancialMetric("CJ_ORDER_COSTS", "No CJ supplier cost is recorded for the sales in this window.");
  const strictProfit = computeGrowthCockpitProfit({ revenue, cjCosts, paymentFees, metaSpend, orders: orderCount });
  const profit = computeGrowthCockpitProfitBeforePaymentFees({
    revenue,
    cjCosts: productCost,
    metaSpend,
    orders: orderCount,
    acceptIncompleteCosts: true,
    paymentFees,
  });
  const health = computeOperatingHealth({
    netRevenue: revenue.amount,
    adSpend: metaSpend.amount,
    marginPct: profit.marginPct,
    landingPageViews: metaResult.funnel.landingPageViews,
    linkClicks: metaResult.funnel.linkClicks,
    initiateCheckout: metaResult.funnel.initiateCheckout,
    addToCart: metaResult.funnel.addToCart,
    ordersLinkedToVisitor: d1.linkedToVisitor,
    totalOrders: orderCount || null,
  });

  // Every stat answers "better or worse than before?" from settled daily rows,
  // so the comparison costs one D1 read rather than a second pass over Shopify.
  const comparison = range.localFrom && range.localTo
    ? await dashboardComparison({ localFrom: range.localFrom, localTo: range.localTo }).catch(() => null)
    : null;

  return {
    health,
    metaFunnel: metaResult.funnel,
    dailyTrend: comparison,
    // Rates applied here plus the ones the Shopify window already applied.
    fx: [...reportingCurrency.rates(), ...((shopifyResult as any).fx || [])]
      .filter((rate, index, all) => all.findIndex(other => other.base === rate.base && other.quote === rate.quote) === index),
    metrics: {
      revenue,
      shopifySourceRevenue: observedRevenue,
      orders,
      cjCosts,
      cjPaidCosts: acceptedCjPaidCosts,
      productCost,
      paymentFees,
      metaSpend,
    },
    supplierCostCoverage: {
      orders: orderCount,
      pricedOrders,
      exactOrders: supplierCost?.exactOrders ?? 0,
      bundlePricedOrders: supplierCost?.bundlePricedOrders ?? 0,
      unpricedOrders,
    },
    profit: { ...profit, paymentFeesExcluded: !profit.paymentFeesIncluded, strictBlockers: strictProfit.blockers },
    observations: {
      shopifyAdmin: shopifyResult.value
        ? { ...shopifyResult.value, servedFrom: shopifyResult.servedFrom }
        : { source: "SHOPIFY_ADMIN_ORDERS", error: shopifyResult.error, servedFrom: shopifyResult.servedFrom },
      d1OrderLedger: {
        source: "SHOPIFY_WEBHOOK_D1",
        rows: d1.rows,
        orders: d1.orders,
        currencies: d1.currencies,
        webhookDeliveries: d1.webhookDeliveries,
        quality: d1.metric.quality,
      },
      meta: {
        source: metaResult.source,
        rows: metaResult.rows,
        accountId: metaResult.accountId,
        quality: metaResult.quality,
        ledgerRowsSaved: metaLedgerSaved,
        ledgerError: metaLedgerError,
      },
      cjPaidCostsDaily,
    },
  };
}

router.get("/growth-cockpit/config", (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const range = resolveGrowthCockpitRange({
      preset: typeof req.query.preset === "string" ? req.query.preset : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      timezone: config.reportingTimezone,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      contractVersion: "growth_cockpit_batch_7",
      ...config,
      range,
      financialMetrics: "AUTHENTICATED_SOURCE_CONTRACT",
    });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error.message || "Invalid Growth Cockpit configuration." });
  }
});

router.get("/growth-cockpit/cj-status", async (_req, res) => {
  try {
    const result = await testCjReadConnection();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, source: "CJ_OPEN_API", ...result, checkedAt: new Date().toISOString() });
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      source: "CJ_OPEN_API",
      connected: false,
      error: String(error?.message || "CJ connection test failed.").slice(0, 240),
    });
  }
});

router.post("/growth-cockpit/cj-reconcile", async (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const range = resolveGrowthCockpitRange({
      preset: typeof req.body?.preset === "string" ? req.body.preset : undefined,
      from: typeof req.body?.from === "string" ? req.body.from : undefined,
      to: typeof req.body?.to === "string" ? req.body.to : undefined,
      timezone: config.reportingTimezone,
    });
    const result = await reconcileCjCosts({
      from: range.from,
      toExclusive: range.toExclusive,
      timezone: range.timezone,
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      source: "CJ_OPEN_API",
      range: { localFrom: range.localFrom, localTo: range.localTo },
      result,
      note: "Only exact Shopify legacy order ID to CJ platform order ID matches are persisted. CJ orderAmount remains an estimate until a charged-cost source is available.",
    });
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      source: "CJ_OPEN_API",
      error: String(error?.message || "CJ cost reconciliation failed.").slice(0, 240),
    });
  }
});

router.post("/growth-cockpit/cj-paid-costs", async (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const range = resolveGrowthCockpitRange({
      preset: typeof req.body?.preset === "string" ? req.body.preset : undefined,
      from: typeof req.body?.from === "string" ? req.body.from : undefined,
      to: typeof req.body?.to === "string" ? req.body.to : undefined,
      timezone: config.reportingTimezone,
    });
    if (!range.from || !range.toExclusive) {
      return res.status(400).json({ ok: false, error: "Choose a dated reporting range of 90 days or less for CJ paid costs." });
    }
    const result = await reconcileCjPaidCosts({ from: range.from, toExclusive: range.toExclusive });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      source: "CJ_PAID_ORDERS",
      range: { localFrom: range.localFrom, localTo: range.localTo },
      result,
      note: "CJ actualPayment is aggregated by CJ UTC payment date. It is an account-level paid-order total and is not yet reconciled to Shopify orders or used for store profit.",
    });
  } catch (error: any) {
    return res.status(502).json({ ok: false, source: "CJ_PAID_ORDERS", error: String(error?.message || "CJ paid-cost synchronization failed.").slice(0, 240) });
  }
});

router.get("/growth-cockpit/take-rates", async (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const range = resolveGrowthCockpitRange({
      preset: typeof req.query.preset === "string" ? req.query.preset : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      timezone: config.reportingTimezone,
    });
    if (!range.from || !range.toExclusive) {
      return res.status(400).json({ ok: false, error: "Take rates require a bounded reporting window." });
    }
    const result = await computeOfferTakeRates({
      fromIso: range.from,
      toIso: new Date(new Date(range.toExclusive).getTime() - 1000).toISOString(),
      sessionToken: sessionToken(req.get("authorization")),
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, range, ...result });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: String(error?.message || "Take-rate query failed.").slice(0, 240) });
  }
});

router.get("/growth-cockpit/finance", async (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const range = resolveGrowthCockpitRange({
      preset: typeof req.query.preset === "string" ? req.query.preset : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      timezone: config.reportingTimezone,
    });
    const token = sessionToken(req.get("authorization"));
    const todayLabel = resolveGrowthCockpitRange({ preset: "today", timezone: range.timezone }).localFrom;
    const includesCurrentDay = !range.localTo || !todayLabel || range.localTo >= todayLabel;
    const cacheKey = [range.preset, range.localFrom, range.localTo, range.timezone, config.reportingCurrency].join("|");
    const cached = readFinanceCache(cacheKey);
    if (cached) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Finance-Cache", "HIT");
      return res.json(cached);
    }
    const current = await financeSnapshot(config, range, token);
    // "Today" used to refuse a comparison because the day is unfinished. The
    // question the dashboard has to answer is whether today is running better
    // or worse than yesterday, so it is compared with the whole of yesterday
    // and the tile says so rather than leaving the reader with one number.
    const resolvedComparison = previousEquivalentGrowthCockpitRange(range);
    const previousWindow = resolvedComparison.range
      || (range.localFrom && range.localTo === range.localFrom
        ? resolveGrowthCockpitRange({
            preset: "custom",
            from: addCalendarDays(range.localFrom, -1),
            to: addCalendarDays(range.localFrom, -1),
            timezone: range.timezone,
          })
        : null);
    const previous = previousWindow ? await financeSnapshot(config, previousWindow, token) : null;
    // A one-day window is compared with the day before it; anything longer with
    // the same number of days immediately before.
    const previousDayCount = previousWindow?.localFrom && previousWindow?.localTo
      ? Math.round((Date.parse(`${previousWindow.localTo}T00:00:00Z`) - Date.parse(`${previousWindow.localFrom}T00:00:00Z`)) / 86400000) + 1
      : 0;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Finance-Cache", "MISS");
    const payload = {
      ok: true,
      generatedAt: new Date().toISOString(),
      contractVersion: "growth_cockpit_batch_7",
      range,
      reportingCurrency: config.reportingCurrency,
      fx: current.fx,
      health: current.health,
      metaFunnel: current.metaFunnel,
      metrics: current.metrics,
      profit: current.profit,
      supplierCostCoverage: current.supplierCostCoverage,
      comparison: {
        range: previousWindow,
        reason: resolvedComparison.reason,
        revenue: previous ? compareGrowthCockpitMetric(current.metrics.revenue, previous.metrics.revenue) : null,
        orders: previous ? compareGrowthCockpitMetric(current.metrics.orders, previous.metrics.orders) : null,
        // Every stat, measured over the previous window exactly as it is
        // measured now, so a tile can say whether it moved up or down.
        previousLabel: previousDayCount === 1 ? "yesterday" : previousDayCount ? `the previous ${previousDayCount} days` : "the previous period",
        previousMetrics: previous
          ? {
              revenue: previous.metrics.revenue?.amount ?? null,
              orders: previous.metrics.orders?.amount ?? null,
              productCost: previous.metrics.productCost?.amount ?? null,
              paymentFees: previous.metrics.paymentFees?.amount ?? null,
              adSpend: previous.metrics.metaSpend?.amount ?? null,
              profit: previous.profit?.cm2 ?? null,
              breakEvenCpa: previous.profit?.breakEvenCpa ?? null,
            }
          : null,
        // The last seven settled days, for the sparkline beside each stat.
        daily: current.dailyTrend,
      },
      metricDefinitions: GROWTH_COCKPIT_METRIC_DEFINITIONS,
      observations: current.observations,
      sourceOfTruth: {
        revenue: "Shopify Order.netPaymentSet.shopMoney for ranges within the accessible order window; D1 webhook rows are fallback observations only.",
        cjCosts: "One row per Shopify sale at CJ's price for it: the CJ order total, product plus the shipping CJ quoted. A sale CJ has not received yet is priced from the last CJ order of the identical bundle.",
        cjPaidCosts: "CJ actualPayment grouped by CJ payment date; account-level paid-order total, not yet Shopify-order reconciled or used for store profit.",
        productCost: "The cost used for profit: one row per sale at the CJ order total for it. Reported ACTUAL when every sale in the window is priced, PARTIAL when some sale has no CJ order yet, and the note names how many.",
        paymentFees: "Shopify transaction fees are authoritative only when every successful SALE order has returned fee rows.",
        metaSpend: "Meta Insights API for the configured account; a persisted reconciliation ledger remains a Batch 7 requirement.",
        fx: "Amounts reported outside REPORTING_CURRENCY are restated with a published daily rate. Every converted metric carries the rate, its publication date and its source, and is never reported above the quality of that rate.",
      },
    };
    writeFinanceCache(cacheKey, payload, includesCurrentDay);
    return res.json(payload);
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error.message || "Growth Cockpit finance query failed." });
  }
});

/**
 * Settles the daily rows the trend comparisons read, on demand.
 *
 * The cron does this every ten minutes; this exists so a day can be rebuilt
 * immediately after a cost correction instead of waiting for the next tick.
 */
router.post("/growth-cockpit/daily-snapshot", async (_req, res) => {
  try {
    const result = await snapshotDashboardDaily();
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: String(error?.message || error).slice(0, 300) });
  }
});

/**
 * Which ad sets are buying orders above what the business can afford.
 *
 * Blended ROAS hides this: one ad set can be far above break-even while the
 * average still looks healthy.
 */
router.get("/growth-cockpit/ad-sets", async (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const range = resolveGrowthCockpitRange({
      preset: typeof req.query.preset === "string" ? req.query.preset : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      timezone: config.reportingTimezone,
    });
    const token = sessionToken(req.get("authorization"));
    const [performance, finance] = await Promise.all([
      fetchMetaAdSetPerformance({ localFrom: range.localFrom, localTo: range.localTo }),
      financeSnapshot(config, range, token),
    ]);
    const breakEvenCpa = finance.profit?.breakEvenCpa ?? null;
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: performance.ok,
      range,
      breakEvenCpa,
      currency: finance.metrics.revenue?.currency ?? null,
      adSetCurrency: performance.currency,
      note: performance.note,
      adSets: judgeAdSets(performance.adSets, breakEvenCpa),
    });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: String(error?.message || error).slice(0, 200) });
  }
});

/**
 * Repeat purchase and customer value.
 *
 * Every screen measures a window. None of them says whether a customer ever
 * comes back, which is the number that decides what an order is worth buying
 * for. Read from Shopify so it counts every order, not only the attributed ones.
 */
router.get("/growth-cockpit/customer-value", async (req, res) => {
  try {
    const config = getGrowthCockpitConfig(workerEnvValue);
    const days = Math.min(365, Math.max(30, Number(req.query.days) || 180));
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const token = sessionToken(req.get("authorization"));
    const summary = await shopify.customerRepeatSummary({ since, sessionToken: token });
    const reportingCurrency = reportingCurrencyConverter(config.reportingCurrency);
    const revenue = await reportingCurrency.convert({
      amount: summary.totalRevenue, currency: summary.currency, quality: "ACTUAL",
      source: "SHOPIFY_ADMIN_ORDERS", note: "Gross revenue of every paid order in the window.",
    });
    const perCustomer = summary.customers > 0 && revenue.amount != null
      ? Number((revenue.amount / summary.customers).toFixed(2))
      : null;
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      windowDays: days,
      since,
      currency: revenue.currency,
      customers: summary.customers,
      orders: summary.orders,
      repeatCustomers: summary.repeatCustomers,
      repeatRate: summary.customers > 0 ? Number((summary.repeatCustomers / summary.customers).toFixed(4)) : null,
      ordersPerCustomer: summary.customers > 0 ? Number((summary.orders / summary.customers).toFixed(2)) : null,
      revenuePerCustomer: perCustomer,
      revenue: revenue.amount,
      note: summary.truncated
        ? `Counts the most recent ${summary.orders} orders since ${since}; older orders in the window are not included.`
        : `Every paid order since ${since}.`,
      fx: reportingCurrency.rates(),
    });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: String(error?.message || error).slice(0, 200) });
  }
});

export default router;

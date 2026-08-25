import { Router } from "express";
import {
  getGrowthCockpitConfig,
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
  missingFinancialMetric,
  type FinancialMetric,
} from "../lib/growth-cockpit-finance.js";
import prisma from "../lib/db.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { fetchMetaSpend } from "../lib/meta-ads.js";
import { testCjReadConnection } from "../services/novahair-monitor.js";
import {
  aggregateFinancialLedger,
  persistFinancialLedgerCoverage,
  persistFinancialLedgerEntries,
} from "../lib/financial-ledger.js";

const router = Router();
const shopify = new ShopifyAdminClient();

function sessionToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
}

function reportingCurrencyMetric(metric: FinancialMetric, reportingCurrency: string | null): FinancialMetric {
  if (!reportingCurrency) {
    return {
      ...metric,
      quality: metric.quality === "MISSING" ? "MISSING" : "PARTIAL",
      note: `${metric.note} REPORTING_CURRENCY is not configured.`,
    };
  }
  if (metric.currency && metric.currency !== reportingCurrency) {
    return {
      amount: null,
      currency: reportingCurrency,
      quality: "MISSING",
      source: metric.source,
      note: `${metric.source} returned ${metric.currency}; authoritative FX conversion to ${reportingCurrency} is not configured.`,
    };
  }
  return { ...metric, currency: reportingCurrency };
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
    };
  }
  const paidAt = range.from || range.toExclusive
    ? { ...(range.from ? { gte: new Date(range.from) } : {}), ...(range.toExclusive ? { lt: new Date(range.toExclusive) } : {}) }
    : undefined;
  const orders = await prisma.orderAttribution.findMany({
    where: { shopId: shop.id, isTest: false, ...(paidAt ? { paidAt } : {}) },
    select: { netRevenueAmount: true, currency: true, status: true },
  });
  const currencies = [...new Set(orders.map(order => order.currency.toUpperCase()))];
  const amount = currencies.length <= 1
    ? Number(orders.reduce((sum, order) => sum + Number(order.netRevenueAmount || 0), 0).toFixed(2))
    : null;
  const webhookDeliveries = await prisma.shopifyWebhookDelivery.count({
    where: { shopId: shop.id, topic: { in: ["orders/paid", "orders/updated"] } },
  });
  return {
    rows: orders.length,
    orders: orders.filter(order => order.status !== "REFUNDED_OR_CANCELLED" && order.netRevenueAmount > 0).length,
    metric: orders.length && amount != null
      ? {
          amount,
          currency: currencies[0] ?? null,
          quality: "PARTIAL" as const,
          source: "SHOPIFY_WEBHOOK_D1",
          note: "Observed Shopify webhook order totals. Coverage is not authoritative until a Shopify reconciliation watermark exists.",
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

async function financeSnapshot(config: GrowthCockpitConfig, range: GrowthCockpitDateRange, token: string | undefined) {
  const [d1, shopifyResult] = await Promise.all([
    d1OrderLedger(range),
    shopify.orderFinancialSummary({ from: range.from, toExclusive: range.toExclusive, sessionToken: token })
      .then(value => ({ value, error: null as string | null }))
      .catch(error => ({ value: null, error: String(error?.message || "Shopify order query failed.").slice(0, 300) })),
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
  const revenue = reportingCurrencyMetric(observedRevenue, config.reportingCurrency);
  const cjCosts = await aggregateFinancialLedger({
    source: "CJ_ORDER_COSTS",
    category: "CJ_VARIABLE_COST",
    localFrom: range.localFrom,
    localTo: range.localTo,
    note: "No reviewed CJ cost rows exist for this range.",
  }).catch(() => missingFinancialMetric("CJ_ORDER_COSTS", "The CJ financial ledger is not initialized."));
  const paymentFees = shopifyResult.value?.paymentFees
    ? reportingCurrencyMetric({
        amount: shopifyResult.value.paymentFees.amount,
        currency: shopifyResult.value.paymentFees.currency,
        quality: shopifyResult.value.paymentFees.quality,
        source: shopifyResult.value.paymentFees.source,
        note: shopifyResult.value.paymentFees.definition,
      }, config.reportingCurrency)
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
  const metaSpend = reportingCurrencyMetric({
    amount: metaResult.amount,
    currency: metaResult.currency,
    quality: metaResult.quality,
    source: metaResult.source,
    note: metaResult.note,
  }, config.reportingCurrency);
  const orderCount = shopifyResult.value?.orders ?? d1.orders;
  const orders: FinancialMetric = {
    amount: revenue.quality === "MISSING" ? null : orderCount,
    currency: revenue.currency,
    quality: revenue.quality,
    source: revenue.source,
    note: "Orders with a positive Shopify net payment in the selected period.",
  };
  const profit = computeGrowthCockpitProfit({ revenue, cjCosts, paymentFees, metaSpend, orders: orderCount });
  return {
    metrics: { revenue, orders, cjCosts, paymentFees, metaSpend },
    profit,
    observations: {
      shopifyAdmin: shopifyResult.value ?? { source: "SHOPIFY_ADMIN_ORDERS", error: shopifyResult.error },
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
    const current = await financeSnapshot(config, range, token);
    const comparisonWindow = previousEquivalentGrowthCockpitRange(range);
    const previous = comparisonWindow.range ? await financeSnapshot(config, comparisonWindow.range, token) : null;

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      contractVersion: "growth_cockpit_batch_7",
      range,
      reportingCurrency: config.reportingCurrency,
      metrics: current.metrics,
      profit: current.profit,
      comparison: {
        range: comparisonWindow.range,
        reason: comparisonWindow.reason,
        revenue: previous ? compareGrowthCockpitMetric(current.metrics.revenue, previous.metrics.revenue) : null,
        orders: previous ? compareGrowthCockpitMetric(current.metrics.orders, previous.metrics.orders) : null,
      },
      metricDefinitions: GROWTH_COCKPIT_METRIC_DEFINITIONS,
      observations: current.observations,
      sourceOfTruth: {
        revenue: "Shopify Order.netPaymentSet.shopMoney for ranges within the accessible order window; D1 webhook rows are fallback observations only.",
        cjCosts: "MISSING until a reviewed CJ ledger records charged or explicitly labeled estimated costs.",
        paymentFees: "Shopify transaction fees are authoritative only when every successful SALE order has returned fee rows.",
        metaSpend: "Meta Insights API for the configured account; a persisted reconciliation ledger remains a Batch 7 requirement.",
      },
    });
  } catch (error: any) {
    return res.status(400).json({ ok: false, error: error.message || "Growth Cockpit finance query failed." });
  }
});

export default router;

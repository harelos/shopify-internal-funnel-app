import { getGrowthCockpitConfig, resolveGrowthCockpitRange } from "../lib/growth-cockpit-config.js";
import {
  hasRecentFinancialCoverage,
  persistFinancialLedgerCoverage,
  persistFinancialLedgerEntries,
} from "../lib/financial-ledger.js";
import { fetchMetaSpend } from "../lib/meta-ads.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";

const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const shopify = new ShopifyAdminClient();

export async function reconcileGrowthCockpitMetaSpend(): Promise<{
  status: "SKIPPED" | "PERSISTED" | "MISSING";
  rows: number;
  quality?: string;
}> {
  const config = getGrowthCockpitConfig(workerEnvValue);
  const range = resolveGrowthCockpitRange({ preset: "today", timezone: config.reportingTimezone });
  const source = "META_ADS_INSIGHTS";
  const category = "AD_SPEND";
  if (await hasRecentFinancialCoverage({
    source,
    category,
    localFrom: range.localFrom,
    localTo: range.localTo,
    maxAgeMs: REFRESH_INTERVAL_MS,
  })) return { status: "SKIPPED", rows: 0 };

  const result = await fetchMetaSpend({ localFrom: range.localFrom, localTo: range.localTo });
  if (result.amount == null || !result.currency || !result.accountId) {
    console.warn(`[GROWTH COCKPIT] Meta reconciliation unavailable: ${result.note}`);
    return { status: "MISSING", rows: 0, quality: result.quality };
  }
  const rows = await persistFinancialLedgerEntries(result.daily.map(entry => ({
    source,
    category,
    externalKey: `${result.accountId}:${entry.date}`,
    occurredDate: entry.date,
    amount: entry.amount,
    currency: result.currency as string,
    quality: result.quality,
    metadata: { accountId: result.accountId },
  })));
  await persistFinancialLedgerCoverage({
    source,
    category,
    localFrom: range.localFrom,
    localTo: range.localTo,
    amount: result.amount,
    currency: result.currency,
    quality: result.quality,
    rowCount: result.rows,
    metadata: { accountId: result.accountId, trigger: "scheduled" },
  });
  console.log(`[GROWTH COCKPIT] Persisted ${rows} Meta spend row(s) for ${range.localFrom}.`);
  return { status: "PERSISTED", rows, quality: result.quality };
}

export async function reconcileGrowthCockpitShopifyFinancials(): Promise<{
  status: "SKIPPED" | "PERSISTED" | "MISSING";
  rows: number;
  quality?: string;
  paymentFeesPersisted?: boolean;
}> {
  const config = getGrowthCockpitConfig(workerEnvValue);
  const range = resolveGrowthCockpitRange({ preset: "today", timezone: config.reportingTimezone });
  const source = "SHOPIFY_ADMIN_ORDERS";
  const category = "NET_PAYMENTS";
  if (await hasRecentFinancialCoverage({
    source,
    category,
    localFrom: range.localFrom,
    localTo: range.localTo,
    maxAgeMs: REFRESH_INTERVAL_MS,
  })) return { status: "SKIPPED", rows: 0 };

  try {
    const result = await shopify.orderFinancialSummary({ from: range.from, toExclusive: range.toExclusive });
    const currency = result.currency || config.reportingCurrency;
    if (result.amount == null || !currency) {
      console.warn("[GROWTH COCKPIT] Shopify reconciliation returned no single-currency net-payment total.");
      return { status: "MISSING", rows: result.rows, quality: result.quality };
    }

    await persistFinancialLedgerCoverage({
      source,
      category,
      localFrom: range.localFrom,
      localTo: range.localTo,
      amount: result.amount,
      currency,
      quality: result.quality,
      rowCount: result.rows,
      metadata: { orders: result.orders, truncated: result.truncated, trigger: "scheduled" },
    });

    let paymentFeesPersisted = false;
    if (result.paymentFees?.amount != null && result.paymentFees.currency) {
      await persistFinancialLedgerCoverage({
        source: result.paymentFees.source,
        category: "PAYMENT_FEES",
        localFrom: range.localFrom,
        localTo: range.localTo,
        amount: result.paymentFees.amount,
        currency: result.paymentFees.currency,
        quality: result.paymentFees.quality,
        rowCount: result.paymentFees.rows,
        metadata: { trigger: "scheduled" },
      });
      paymentFeesPersisted = true;
    }

    console.log(`[GROWTH COCKPIT] Persisted Shopify financial coverage for ${range.localFrom}.`);
    return { status: "PERSISTED", rows: result.rows, quality: result.quality, paymentFeesPersisted };
  } catch (error: any) {
    console.warn(`[GROWTH COCKPIT] Shopify reconciliation unavailable: ${String(error?.message || error).slice(0, 240)}`);
    return { status: "MISSING", rows: 0 };
  }
}

// Sales arrive all day and each one's CJ order appears minutes later, so the
// cost of a window is only right if it is re-read often.
const CJ_ORDER_COST_REFRESH_INTERVAL_MS = 20 * 60 * 1000;

/**
 * Keeps the per-sale supplier cost for the current week current.
 *
 * A cost keyed by the day CJ charged the account trailed the sale by days and
 * was built on a field CJ's detail endpoint never returns; that stream is
 * retired. This pass matches the week's Shopify orders to CJ's purchased
 * orders and stores CJ's order total — product plus the postage it quoted,
 * paid or not — dated by the sale. It is one list read and at most one detail
 * call per unpriced order, so it runs a few times a day and only when the
 * ledger has no fresh coverage for the window.
 */
export async function reconcileGrowthCockpitCjOrderCosts(): Promise<{
  status: "SKIPPED" | "PERSISTED" | "MISSING";
  entries: number;
  matches?: number;
}> {
  const config = getGrowthCockpitConfig(workerEnvValue);
  const range = resolveGrowthCockpitRange({ preset: "last_7_days", timezone: config.reportingTimezone });
  const source = "CJ_ORDER_COSTS";
  const category = "CJ_VARIABLE_COST";
  if (await hasRecentFinancialCoverage({
    source,
    category,
    localFrom: range.localFrom,
    localTo: range.localTo,
    maxAgeMs: CJ_ORDER_COST_REFRESH_INTERVAL_MS,
  })) return { status: "SKIPPED", entries: 0 };

  if (!range.from || !range.toExclusive) return { status: "MISSING", entries: 0 };

  try {
    const { reconcileCjCosts } = await import("./cj-cost-reconcile.js");
    const result = await reconcileCjCosts({
      from: range.from,
      toExclusive: range.toExclusive,
      timezone: range.timezone,
      maxCjPages: 3,
    });
    // Coverage is recorded even when nothing matched, so a quiet week does not
    // make the job retry on every tick and burn the rate limit.
    await persistFinancialLedgerCoverage({
      source,
      category,
      localFrom: range.localFrom,
      localTo: range.localTo,
      amount: 0,
      currency: "USD",
      quality: result.cjTruncated || result.shopifyTruncated || result.unpricedOrders.length ? "PARTIAL" : "ACTUAL",
      rowCount: result.entriesPersisted,
      metadata: {
        trigger: "scheduled",
        exactOrders: result.exactOrders,
        bundlePricedOrders: result.bundlePricedOrders,
        unpricedOrders: result.unpricedOrders.slice(0, 20),
        shopifyOrdersScanned: result.shopifyOrdersScanned,
        cjRowsScanned: result.cjRowsScanned,
        matches: result.matches,
        detailFailures: result.detailFailures,
      },
    });
    console.log(`[GROWTH COCKPIT] CJ order costs: ${result.entriesPersisted} entr(ies) from ${result.matches} match(es) of ${result.shopifyOrdersScanned} order(s).`);
    return { status: "PERSISTED", entries: result.entriesPersisted, matches: result.matches };
  } catch (error: any) {
    console.warn(`[GROWTH COCKPIT] CJ order cost reconciliation unavailable: ${String(error?.message || error).slice(0, 240)}`);
    return { status: "MISSING", entries: 0 };
  }
}

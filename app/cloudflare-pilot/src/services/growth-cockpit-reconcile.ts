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

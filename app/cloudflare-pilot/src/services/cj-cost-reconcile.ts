import { persistFinancialLedgerEntries } from "../lib/financial-ledger.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { bundleSignature, cjOrderCost, matchCjOrders, type CjCostShopifyOrder, type CjOrderListRow } from "../lib/cj-cost-match.js";
import { getCjOrderDetail, listCjOrders } from "./novahair-monitor.js";

function localDate(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

export interface CjCostReconcileResult {
  shopifyOrdersScanned: number;
  cjRowsScanned: number;
  matches: number;
  entriesPersisted: number;
  detailFailures: number;
  shopifyTruncated: boolean;
  cjTruncated: boolean;
  /** Orders priced from CJ's own order for that sale. */
  exactOrders: number;
  /** Orders CJ has not been sent yet, priced from the last CJ order of the identical bundle. */
  bundlePricedOrders: number;
  /** Orders with neither, which stay out of the ledger rather than booking a zero. */
  unpricedOrders: string[];
}

/**
 * Writes one supplier-cost row per Shopify sale, at the price CJ charges.
 *
 * CJ holds two rows per sale — the unpaid store shadow with no amount and the
 * order the sync worker actually buys — and the cost is the second one's
 * product plus shipping. An order that has not reached CJ yet is priced from
 * the most recent CJ order of the identical bundle, which is the same goods on
 * the same shipping line, not an average of unrelated orders. An order that can
 * be priced neither way is left out: a zero would understate cost and overstate
 * profit, which is what made a nine-order day report $34 of goods.
 */
export async function reconcileCjCosts(input: {
  from?: string | null;
  toExclusive?: string | null;
  timezone: string;
  maxCjPages?: number;
  /** Extra history used only to learn each bundle's CJ price. */
  bundlePriceLookbackDays?: number;
}): Promise<CjCostReconcileResult> {
  const shopify = new ShopifyAdminClient();
  const shopifyResult = await shopify.ordersForCjCosts({ from: input.from, toExclusive: input.toExclusive });
  const maxCjPages = Math.max(1, Math.min(input.maxCjPages ?? 10, 20));
  const cjRows: CjOrderListRow[] = [];
  let cjTruncated = false;

  for (let page = 1; page <= maxCjPages; page += 1) {
    const rows = await listCjOrders(page, 100);
    cjRows.push(...rows);
    if (rows.length < 100) break;
    if (page === maxCjPages) cjTruncated = true;
  }

  // Learn each bundle's CJ price from a wider window than the one being
  // reported, so the first sale of a day can be priced before CJ is called.
  const lookbackDays = Math.max(0, input.bundlePriceLookbackDays ?? 21);
  const priceWindowFrom = lookbackDays && input.from
    ? new Date(new Date(input.from).getTime() - lookbackDays * 86400000).toISOString()
    : input.from;
  const priceHistory = priceWindowFrom && priceWindowFrom !== input.from
    ? await shopify.ordersForCjCosts({ from: priceWindowFrom, toExclusive: input.toExclusive }).catch(() => ({ orders: [] as CjCostShopifyOrder[], truncated: false }))
    : { orders: shopifyResult.orders, truncated: false };

  const bundlePrice = new Map<string, { amount: number; from: string; at: string }>();
  for (const match of matchCjOrders(priceHistory.orders, cjRows)) {
    const amount = cjOrderCost(match.cj);
    const signature = bundleSignature(match.shopify);
    if (amount == null || !signature) continue;
    const existing = bundlePrice.get(signature);
    if (!existing || match.shopify.processedAt > existing.at) {
      bundlePrice.set(signature, { amount, from: String(match.cj.orderNum || ""), at: match.shopify.processedAt });
    }
  }

  const matches = matchCjOrders(shopifyResult.orders, cjRows);
  const costByOrderId = new Map<string, { amount: number; cj: CjOrderListRow }>();
  let detailFailures = 0;
  for (const match of matches) {
    let amount = cjOrderCost(match.cj);
    if (amount == null) {
      // The list omitted the amount; the detail call is only spent here.
      try {
        amount = cjOrderCost(await getCjOrderDetail(String(match.cj.orderId)));
      } catch (error) {
        console.warn(`[GROWTH COCKPIT] CJ cost detail read failed: ${String((error as Error)?.message || error).slice(0, 180)}`);
      }
    }
    if (amount == null) { detailFailures += 1; continue; }
    costByOrderId.set(match.shopify.id, { amount, cj: match.cj });
  }

  const entries = [];
  let exactOrders = 0;
  let bundlePricedOrders = 0;
  const unpricedOrders: string[] = [];
  for (const order of shopifyResult.orders) {
    const occurredDate = localDate(order.processedAt, input.timezone);
    const exact = costByOrderId.get(order.id);
    if (exact) {
      exactOrders += 1;
      entries.push({
        source: "CJ_ORDER_COSTS",
        category: "CJ_VARIABLE_COST",
        externalKey: order.id,
        occurredDate,
        amount: exact.amount,
        currency: "USD",
        quality: "ACTUAL" as const,
        metadata: {
          costBasis: "CJ_ORDER",
          costDetail: "CJ order total: product plus the shipping CJ quoted for this parcel.",
          cjOrderNum: String(exact.cj.orderNum || ""),
          cjOrderStatus: String(exact.cj.orderStatus || ""),
          cjProductAmount: Number(exact.cj.productAmount) || null,
          cjPostageAmount: Number(exact.cj.postageAmount) || null,
        },
      });
      continue;
    }
    const signature = bundleSignature(order);
    const priced = signature ? bundlePrice.get(signature) : undefined;
    if (priced) {
      bundlePricedOrders += 1;
      entries.push({
        source: "CJ_ORDER_COSTS",
        category: "CJ_VARIABLE_COST",
        externalKey: order.id,
        occurredDate,
        amount: priced.amount,
        currency: "USD",
        quality: "ACTUAL" as const,
        metadata: {
          costBasis: "CJ_BUNDLE_PRICE",
          costDetail: `CJ's price for the identical bundle (${signature}), last charged on CJ order ${priced.from}. This sale has not been sent to CJ yet.`,
          bundleSignature: signature,
          pricedFromCjOrderNum: priced.from,
        },
      });
      continue;
    }
    unpricedOrders.push(order.name || order.id);
  }

  const entriesPersisted = await persistFinancialLedgerEntries(entries);
  return {
    shopifyOrdersScanned: shopifyResult.orders.length,
    cjRowsScanned: cjRows.length,
    matches: matches.length,
    entriesPersisted,
    detailFailures,
    shopifyTruncated: shopifyResult.truncated,
    cjTruncated,
    exactOrders,
    bundlePricedOrders,
    unpricedOrders,
  };
}

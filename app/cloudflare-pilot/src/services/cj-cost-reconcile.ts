import { persistFinancialLedgerEntries } from "../lib/financial-ledger.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { matchCjOrders, type CjOrderListRow } from "../lib/cj-cost-match.js";
import { getCjOrderDetail, listCjOrders } from "./novahair-monitor.js";

function localDate(timestamp: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function estimateAmount(detail: any): number | null {
  const amount = Number(detail?.orderAmount);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export async function reconcileCjCosts(input: {
  from?: string | null;
  toExclusive?: string | null;
  timezone: string;
  maxCjPages?: number;
}): Promise<{
  shopifyOrdersScanned: number;
  cjRowsScanned: number;
  matches: number;
  entriesPersisted: number;
  detailFailures: number;
  shopifyTruncated: boolean;
  cjTruncated: boolean;
}> {
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

  const matches = matchCjOrders(shopifyResult.orders, cjRows);
  const entries = [];
  let detailFailures = 0;
  for (const match of matches) {
    try {
      const detail = await getCjOrderDetail(String(match.cj.orderId));
      const amount = estimateAmount(detail);
      if (amount == null) {
        detailFailures += 1;
        continue;
      }
      entries.push({
        source: "CJ_ORDER_COSTS",
        category: "CJ_VARIABLE_COST",
        externalKey: match.shopify.id,
        occurredDate: localDate(match.shopify.processedAt, input.timezone),
        amount,
        currency: "USD",
        quality: "ESTIMATE" as const,
        metadata: {
          costBasis: "CJ orderAmount pre-payment estimate",
          matchedBy: "exact platformOrderId to Shopify legacyResourceId",
        },
      });
    } catch (error) {
      detailFailures += 1;
      console.warn(`[GROWTH COCKPIT] CJ cost detail read failed: ${String((error as Error)?.message || error).slice(0, 180)}`);
    }
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
  };
}

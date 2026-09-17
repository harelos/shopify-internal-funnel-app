export interface CjCostShopifyOrder {
  id: string;
  legacyResourceId: string;
  /** Shopify order name, e.g. "#4452". */
  name?: string;
  processedAt: string;
  netPaymentAmount: number;
  currency: string;
  /** Line item SKUs and quantities, used to price an order CJ has not been sent yet. */
  lineItems?: Array<{ sku: string | null; quantity: number }>;
}

export interface CjOrderListRow {
  orderId?: string | number;
  platformOrderId?: string | number;
  /**
   * CJ's own order number. The store connection files an unpaid shadow as
   * "#4452" with no amount; the order actually purchased is filed by the sync
   * worker as "AUTO-4452", "RESCUE-4452", "MANUAL-4452" or "BACKFILL-4452".
   */
  orderNum?: string;
  orderStatus?: string;
  orderAmount?: number | string | null;
  productAmount?: number | string | null;
  postageAmount?: number | string | null;
  createDate?: string;
  shopName?: string;
}

/** Every prefix the sync worker files a purchased CJ order under. */
const PURCHASE_PREFIX = /^(?:RESCUE|AUTO|MANUAL|BACKFILL)-/i;

/** The Shopify order number a CJ row refers to, taken from its order number. */
export function shopifyOrderNumberOf(cj: CjOrderListRow): string | null {
  const digits = String(cj.orderNum || "").trim().replace(PURCHASE_PREFIX, "").replace(/^#/, "");
  return /^\d+$/.test(digits) ? digits : null;
}

export function isPurchaseRow(cj: CjOrderListRow): boolean {
  return PURCHASE_PREFIX.test(String(cj.orderNum || "").trim());
}

/**
 * What CJ charges for this order: the product cost plus the shipping it quoted.
 * CJ fills `orderAmount` once the order exists; when it is still splitting the
 * two out, their sum is the same number.
 */
export function cjOrderCost(cj: CjOrderListRow): number | null {
  const total = Number(cj.orderAmount);
  if (Number.isFinite(total) && total > 0) return Number(total.toFixed(2));
  const product = Number(cj.productAmount);
  const postage = Number(cj.postageAmount);
  const parts = (Number.isFinite(product) ? product : 0) + (Number.isFinite(postage) ? postage : 0);
  return parts > 0 ? Number(parts.toFixed(2)) : null;
}

export function isCancelledCjRow(cj: CjOrderListRow): boolean {
  return /cancel|trash/i.test(String(cj.orderStatus || ""));
}

/**
 * Pairs Shopify orders with the CJ order that carries their cost.
 *
 * CJ never returns a platformOrderId for this store, and it holds two rows per
 * sale: the store-connected shadow ("#4452", no amount, never paid) and the
 * order the sync worker actually buys ("AUTO-4452" and friends). Matching the
 * shadow is what wrote $0 costs for eight of nine orders in a day, so a row
 * that carries a real amount always outranks one that does not, and a
 * cancelled or trashed row never matches at all. One CJ row per Shopify order.
 */
export function matchCjOrders(
  shopifyOrders: CjCostShopifyOrder[],
  cjOrders: CjOrderListRow[],
): Array<{ shopify: CjCostShopifyOrder; cj: CjOrderListRow }> {
  const shopifyByLegacyId = new Map(shopifyOrders.map(order => [String(order.legacyResourceId), order]));
  const shopifyByNumber = new Map(
    shopifyOrders
      .filter(order => order.name)
      .map(order => [String(order.name).trim().replace(/^#/, ""), order]),
  );
  // An amount is what makes a row usable at all; the purchase prefix breaks ties
  // between two rows that both carry one.
  const rank = (cj: CjOrderListRow) => (cjOrderCost(cj) != null ? 4 : 0) + (isPurchaseRow(cj) ? 2 : 0);
  const ranked = cjOrders
    .filter(cj => cj.orderId && !isCancelledCjRow(cj))
    .sort((a, b) => rank(b) - rank(a));
  const matches: Array<{ shopify: CjCostShopifyOrder; cj: CjOrderListRow }> = [];
  const seenShopifyIds = new Set<string>();
  for (const cj of ranked) {
    const number = shopifyOrderNumberOf(cj);
    const shopify = shopifyByLegacyId.get(String(cj.platformOrderId || ""))
      ?? (number ? shopifyByNumber.get(number) : undefined);
    if (!shopify || seenShopifyIds.has(shopify.id)) continue;
    // A row with no amount is not a cost; leaving the order unmatched lets the
    // bundle price stand in instead of booking a zero.
    if (cjOrderCost(cj) == null) continue;
    seenShopifyIds.add(shopify.id);
    matches.push({ shopify, cj });
  }
  return matches;
}

/**
 * The goods a Shopify order contains, as a stable key.
 *
 * Two orders with the same bundle cost CJ the same, so an order that has not
 * reached CJ yet can be priced from the last CJ order of the identical bundle
 * rather than from an average of unrelated orders.
 */
export function bundleSignature(order: CjCostShopifyOrder): string | null {
  const items = (order.lineItems || [])
    .filter(item => item && item.sku && Number(item.quantity) > 0)
    .map(item => `${String(item.sku).trim().toUpperCase()}x${Number(item.quantity)}`)
    .sort();
  return items.length ? items.join("+") : null;
}

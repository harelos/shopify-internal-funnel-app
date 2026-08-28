export interface CjCostShopifyOrder {
  id: string;
  legacyResourceId: string;
  processedAt: string;
  netPaymentAmount: number;
  currency: string;
}

export interface CjOrderListRow {
  orderId?: string | number;
  platformOrderId?: string | number;
}

export function matchCjOrders(
  shopifyOrders: CjCostShopifyOrder[],
  cjOrders: CjOrderListRow[],
): Array<{ shopify: CjCostShopifyOrder; cj: CjOrderListRow }> {
  const shopifyByLegacyId = new Map(shopifyOrders.map(order => [String(order.legacyResourceId), order]));
  const matches: Array<{ shopify: CjCostShopifyOrder; cj: CjOrderListRow }> = [];
  const seenShopifyIds = new Set<string>();
  for (const cj of cjOrders) {
    const shopify = shopifyByLegacyId.get(String(cj.platformOrderId || ""));
    if (!shopify || seenShopifyIds.has(shopify.id) || !cj.orderId) continue;
    seenShopifyIds.add(shopify.id);
    matches.push({ shopify, cj });
  }
  return matches;
}

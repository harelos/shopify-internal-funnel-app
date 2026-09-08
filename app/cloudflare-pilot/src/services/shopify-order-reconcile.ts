import prisma from "../lib/db.js";
import { resolveGrowthCockpitRange } from "../lib/growth-cockpit-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { getShopifyConfig, normalizeShopDomain } from "../lib/shopify-config.js";
import {
  needsOrderReconciliation,
  normalizeShopifyOrderForAttribution,
  reconciliationCreateFields,
  reconciliationFinancialUpdate,
} from "../lib/shopify-order-reconciliation.js";
import { snapshotOrderElementAssignments } from "./element-attribution.js";

const shopify = new ShopifyAdminClient();

export interface ShopifyOrderReconciliationResult {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  ledgerOrders: number;
  shopifyRevenueOrders: number;
  missingAfterReconciliation: number;
  truncated: boolean;
}

export async function reconcileShopifyOrderAttribution(input: {
  from?: string;
  toExclusive?: string;
  now?: Date;
} = {}): Promise<ShopifyOrderReconciliationResult> {
  const range = input.from && input.toExclusive
    ? { from: input.from, toExclusive: input.toExclusive }
    : resolveGrowthCockpitRange({ preset: "today", timezone: "Asia/Jerusalem", now: input.now });
  if (!range.from || !range.toExclusive) throw new Error("A bounded Shopify reconciliation range is required.");

  const domain = normalizeShopDomain(getShopifyConfig().shopDomain);
  if (!domain) throw new Error("SHOP_DOMAIN is required for Shopify order reconciliation.");
  const shop = await prisma.shop.upsert({ where: { domain }, update: {}, create: { domain } });
  const source = await shopify.ordersForAttributionReconciliation({
    from: range.from,
    toExclusive: range.toExclusive,
  });

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let shopifyRevenueOrders = 0;
  for (const sourceOrder of source.orders) {
    const fields = normalizeShopifyOrderForAttribution(sourceOrder);
    if (!fields) {
      skipped += 1;
      continue;
    }
    const existing = await prisma.orderAttribution.findUnique({
      where: { shopifyOrderGid: fields.shopifyOrderGid },
    });
    if (!fields.isRevenueOrder && !existing) {
      skipped += 1;
      continue;
    }
    if (fields.isRevenueOrder) shopifyRevenueOrders += 1;

    if (!existing) {
      const order = await prisma.orderAttribution.upsert({
        where: { shopifyOrderGid: fields.shopifyOrderGid },
        create: { shopId: shop.id, ...reconciliationCreateFields(fields) },
        update: reconciliationFinancialUpdate(fields),
      });
      await snapshotOrderElementAssignments(order.id, order.checkoutToken);
      created += 1;
      continue;
    }
    if (!needsOrderReconciliation(existing, fields)) {
      unchanged += 1;
      continue;
    }
    const order = await prisma.orderAttribution.update({
      where: { id: existing.id },
      data: reconciliationFinancialUpdate(fields, existing),
    });
    await snapshotOrderElementAssignments(order.id, order.checkoutToken);
    updated += 1;
  }

  const ledgerOrders = await prisma.orderAttribution.count({
    where: {
      shopId: shop.id,
      isTest: false,
      paidAt: { gte: new Date(range.from), lt: new Date(range.toExclusive) },
      netRevenueAmount: { gt: 0 },
      status: { not: "REFUNDED_OR_CANCELLED" },
    },
  });
  const result = {
    scanned: source.orders.length,
    created,
    updated,
    unchanged,
    skipped,
    ledgerOrders,
    shopifyRevenueOrders,
    missingAfterReconciliation: Math.max(0, shopifyRevenueOrders - ledgerOrders),
    truncated: source.truncated,
  };
  console.log(JSON.stringify({ message: "shopify_order_reconciliation_complete", ...result }));
  return result;
}

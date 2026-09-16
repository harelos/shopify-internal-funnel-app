import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { env as cloudflareEnv } from "cloudflare:workers";

const shopify = new ShopifyAdminClient();

export interface OfferTakeRate {
  id: string;
  title: string;
  variantId: string;
  ordersWithOffer: number;
  unitsSold: number;
  takeRatePct: number | null;
}

export interface TakeRateResult {
  paidOrders: number;
  offers: OfferTakeRate[];
  anyOfferOrders: number;
  anyOfferTakeRatePct: number | null;
  denominator: string;
  quality: "ACTUAL" | "MISSING";
  note: string;
}

const ORDER_LINE_ITEMS_QUERY = `query OfferTakeRate($query: String!, $cursor: String) {
  orders(first: 100, query: $query, sortKey: PROCESSED_AT, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        test
        lineItems(first: 50) {
          edges { node { quantity variant { id } } }
        }
      }
    }
  }
}`;

function takeRateDb(): any {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.DB ?? null;
}

/** Reads the published cart-offer configuration so the SKUs are never hard-coded. */
async function publishedBumps(): Promise<Array<{ id: string; title: string; variantId: string }>> {
  const db = takeRateDb();
  if (!db) return [];
  try {
    const row = await db.prepare(`SELECT "publishedJson" FROM "CartOfferConfig" LIMIT 1`).bind().first();
    if (!row?.publishedJson) return [];
    const config = JSON.parse(row.publishedJson);
    const entries = [...(config.bumps ?? []), ...(config.carousel ?? [])];
    return entries
      .filter((entry: any) => entry?.enabled !== false && entry?.variantId)
      .map((entry: any) => ({
        id: String(entry.id || entry.variantId),
        title: String(entry.title || entry.productTitle || entry.id || "Offer"),
        variantId: String(entry.variantId),
      }));
  } catch {
    return [];
  }
}

/**
 * Measures how often a cart offer is actually taken.
 *
 * The denominator is every paid order in the window rather than a recorded
 * impression count, because impressions depend on storefront tracking while the
 * offer is configured to show on every cart. The denominator is stated in the
 * response so the number is never read as something stricter than it is.
 */
export async function computeOfferTakeRates(input: {
  fromIso: string;
  toIso: string;
  sessionToken?: string;
}): Promise<TakeRateResult> {
  const bumps = await publishedBumps();
  if (!bumps.length) {
    return {
      paidOrders: 0, offers: [], anyOfferOrders: 0, anyOfferTakeRatePct: null,
      denominator: "PAID_ORDERS", quality: "MISSING",
      note: "No cart offer is published, so there is nothing to measure.",
    };
  }

  const byVariant = new Map(bumps.map(bump => [bump.variantId, bump]));
  const counters = new Map(bumps.map(bump => [bump.id, { orders: 0, units: 0 }]));
  const searchQuery = `financial_status:paid processed_at:>=${input.fromIso} processed_at:<=${input.toIso}`;

  let cursor: string | null = null;
  let paidOrders = 0;
  let anyOfferOrders = 0;
  try {
    do {
      const body: any = await shopify.graphql(ORDER_LINE_ITEMS_QUERY, { query: searchQuery, cursor }, input.sessionToken);
      const connection = body?.orders;
      if (!connection) break;
      for (const edge of connection.edges || []) {
        if (edge.node.test) continue;
        paidOrders += 1;
        const taken = new Set<string>();
        for (const lineEdge of edge.node.lineItems?.edges || []) {
          const variantId = lineEdge.node?.variant?.id;
          const bump = variantId ? byVariant.get(String(variantId)) : undefined;
          if (!bump) continue;
          const counter = counters.get(bump.id)!;
          counter.units += Number(lineEdge.node.quantity || 0);
          taken.add(bump.id);
        }
        for (const id of taken) counters.get(id)!.orders += 1;
        if (taken.size) anyOfferOrders += 1;
      }
      cursor = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
    } while (cursor);
  } catch (error: any) {
    return {
      paidOrders: 0, offers: [], anyOfferOrders: 0, anyOfferTakeRatePct: null,
      denominator: "PAID_ORDERS", quality: "MISSING",
      note: `Shopify order line items were unavailable: ${String(error?.message || "unknown error").slice(0, 160)}`,
    };
  }

  const rate = (count: number) => (paidOrders > 0 ? Number(((count / paidOrders) * 100).toFixed(1)) : null);
  return {
    paidOrders,
    anyOfferOrders,
    anyOfferTakeRatePct: rate(anyOfferOrders),
    offers: bumps.map(bump => {
      const counter = counters.get(bump.id)!;
      return {
        id: bump.id,
        title: bump.title,
        variantId: bump.variantId,
        ordersWithOffer: counter.orders,
        unitsSold: counter.units,
        takeRatePct: rate(counter.orders),
      };
    }),
    denominator: "PAID_ORDERS",
    quality: "ACTUAL",
    note: paidOrders === 0
      ? "No paid orders in this window."
      : "Share of paid orders that included the offer. The denominator is every paid order, not a recorded impression count.",
  };
}

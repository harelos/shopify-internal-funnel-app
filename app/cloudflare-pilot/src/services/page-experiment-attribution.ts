import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { normalizeLandingPath, pageExperimentDb } from "../lib/page-experiments.js";

const shopify = new ShopifyAdminClient();

interface JourneyVisit {
  landingPage: string | null;
  utmParameters: { campaign: string | null; content: string | null } | null;
}

interface OrderNode {
  id: string;
  name: string;
  processedAt: string;
  test: boolean;
  netPaymentSet: { shopMoney: { amount: string; currencyCode: string } };
  customerJourneySummary: { firstVisit: JourneyVisit | null; lastVisit: JourneyVisit | null } | null;
}

const ORDER_JOURNEY_QUERY = `query PageExperimentOrders($query: String!, $cursor: String) {
  orders(first: 100, query: $query, sortKey: PROCESSED_AT, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        name
        processedAt
        test
        netPaymentSet { shopMoney { amount currencyCode } }
        customerJourneySummary {
          firstVisit { landingPage utmParameters { campaign content } }
          lastVisit { landingPage utmParameters { campaign content } }
        }
      }
    }
  }
}`;

/**
 * Attributes paid orders to page variations using the landing page Shopify
 * itself recorded for the visit.
 *
 * Nothing here depends on storefront JavaScript, so attribution keeps working
 * across theme edits and for buyers who block tracking scripts.
 */
export async function reconcilePageExperimentOrders(input: {
  sinceDays: number;
  sessionToken?: string;
}): Promise<{ scanned: number; matched: number; unmatched: number; experiments: number }> {
  const db = pageExperimentDb();
  if (!db) throw new Error("The experiment store is unavailable.");

  const variantRows = await db
    .prepare(`SELECT v."id", v."experimentId", v."landingPath" FROM "PageExperimentVariant" v
              JOIN "PageExperiment" e ON e."id" = v."experimentId"
              WHERE e."status" IN ('RUNNING', 'STOPPED')`)
    .bind()
    .all();
  const variants = (variantRows.results || []) as Array<{ id: string; experimentId: string; landingPath: string }>;
  if (!variants.length) return { scanned: 0, matched: 0, unmatched: 0, experiments: 0 };

  const byPath = new Map<string, Array<{ id: string; experimentId: string }>>();
  for (const variant of variants) {
    const path = normalizeLandingPath(variant.landingPath);
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path)!.push({ id: variant.id, experimentId: variant.experimentId });
  }

  const since = new Date(Date.now() - input.sinceDays * 86400000).toISOString();
  const searchQuery = `financial_status:paid processed_at:>=${since}`;
  let cursor: string | null = null;
  let scanned = 0;
  let matched = 0;
  let unmatched = 0;

  do {
    const body: any = await shopify.graphql(ORDER_JOURNEY_QUERY, { query: searchQuery, cursor }, input.sessionToken);
    const connection = body?.orders;
    if (!connection) break;
    for (const edge of connection.edges || []) {
      const order: OrderNode = edge.node;
      if (order.test) continue;
      scanned += 1;

      // The first visit is what the buyer actually landed on; the last visit is
      // often a checkout or an email click, so it is only a fallback.
      const candidates: Array<{ visit: JourneyVisit | null; matchedOn: string }> = [
        { visit: order.customerJourneySummary?.firstVisit ?? null, matchedOn: "FIRST_VISIT_LANDING_PAGE" },
        { visit: order.customerJourneySummary?.lastVisit ?? null, matchedOn: "LAST_VISIT_LANDING_PAGE" },
      ];

      let recorded = false;
      for (const candidate of candidates) {
        const path = normalizeLandingPath(candidate.visit?.landingPage || "");
        const targets = path ? byPath.get(path) : undefined;
        if (!targets?.length) continue;
        for (const target of targets) {
          await db
            .prepare(`
              INSERT INTO "PageExperimentOrder"
                ("id", "experimentId", "variantId", "shopifyOrderGid", "orderName", "netAmount", "currency", "landingPage", "matchedOn", "utmCampaign", "utmContent", "processedAt")
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT("experimentId", "shopifyOrderGid") DO NOTHING
            `)
            .bind(
              `${target.experimentId}:${order.id}`,
              target.experimentId,
              target.id,
              order.id,
              order.name,
              Number(order.netPaymentSet?.shopMoney?.amount || 0),
              order.netPaymentSet?.shopMoney?.currencyCode || "",
              path,
              candidate.matchedOn,
              candidate.visit?.utmParameters?.campaign ?? null,
              candidate.visit?.utmParameters?.content ?? null,
              order.processedAt,
            )
            .run();
        }
        recorded = true;
        break;
      }
      if (recorded) matched += 1; else unmatched += 1;
    }
    cursor = connection.pageInfo?.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);

  return { scanned, matched, unmatched, experiments: new Set(variants.map(v => v.experimentId)).size };
}

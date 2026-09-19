import { Router } from "express";
import { randomUUID } from "node:crypto";
import { supportD1 } from "../lib/support-d1.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import {
  FUNNELS, type DayInput, type DayRow, type FunnelDefinition, type Grouping,
  composeDay, daysBetween, funnelByKey, groupRows, israelDay, orderBelongsToFunnel, sumRows, todayInIsrael,
} from "../lib/funnel-stats.js";

const router = Router();
const shopify = new ShopifyAdminClient();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 190;
/** Orders for the last two days are re-read this often; older days are settled. */
const FRESH_MS = 10 * 60_000;

type StatRow = { day: string; source: string; sessions: number | null; addedToCart: number | null; reachedCheckout: number | null; purchases: number | null; revenue: number | null; currency: string | null; updatedAt: string };

function dayParam(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return DAY.test(text) ? text : fallback;
}
function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function statRows(funnelKey: string, from: string, to: string): Promise<StatRow[]> {
  const result = await supportD1().prepare(`SELECT "day","source","sessions","addedToCart","reachedCheckout","purchases","revenue","currency","updatedAt"
    FROM "FunnelDailyStat" WHERE "funnelKey" = ? AND "day" >= ? AND "day" <= ?`).bind(funnelKey, from, to).all<StatRow>();
  return result.results || [];
}

async function upsertStat(funnelKey: string, day: string, source: string, values: Partial<Pick<StatRow, "sessions" | "addedToCart" | "reachedCheckout" | "purchases" | "revenue" | "currency">>) {
  const now = new Date().toISOString();
  await supportD1().prepare(`INSERT INTO "FunnelDailyStat" ("id","funnelKey","day","source","sessions","addedToCart","reachedCheckout","purchases","revenue","currency","updatedAt")
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT("funnelKey","day","source") DO UPDATE SET
      "sessions" = excluded."sessions", "addedToCart" = excluded."addedToCart", "reachedCheckout" = excluded."reachedCheckout",
      "purchases" = excluded."purchases", "revenue" = excluded."revenue", "currency" = excluded."currency", "updatedAt" = excluded."updatedAt"`)
    .bind(randomUUID(), funnelKey, day, source, values.sessions ?? null, values.addedToCart ?? null, values.reachedCheckout ?? null,
      values.purchases ?? null, values.revenue ?? null, values.currency ?? null, now).run();
}

/** Visitors the page reported itself, per Israel day, from the assignment rows. */
async function firstPartyByDay(funnel: FunnelDefinition, from: string, to: string): Promise<Map<string, { visitors: number; addedToCart: number; reachedCheckout: number }>> {
  const out = new Map<string, { visitors: number; addedToCart: number; reachedCheckout: number }>();
  if (!funnel.firstPartyExperimentKey) return out;
  // Group by UTC hour, then place each hour on its Israel day here, so daylight-saving
  // changes never shift a day's numbers.
  const rows = await supportD1().prepare(`SELECT substr("firstSeenAt", 1, 13) AS "hour", COUNT(*) AS "visitors",
      SUM("addedToCart") AS "atc", SUM("reachedCheckout") AS "co"
    FROM "CroAssignment" WHERE "experimentKey" = ? AND "isInternal" = 0 AND "firstSeenAt" >= ? AND "firstSeenAt" < ?
    GROUP BY 1`).bind(funnel.firstPartyExperimentKey, `${shiftDay(from, -1)}T00:00:00`, `${shiftDay(to, 2)}T00:00:00`).all<{ hour: string; visitors: number; atc: number; co: number }>();
  for (const row of rows.results || []) {
    const day = israelDay(`${row.hour}:00:00Z`);
    if (day < from || day > to) continue;
    const bucket = out.get(day) || { visitors: 0, addedToCart: 0, reachedCheckout: 0 };
    bucket.visitors += Number(row.visitors) || 0;
    bucket.addedToCart += Number(row.atc) || 0;
    bucket.reachedCheckout += Number(row.co) || 0;
    out.set(day, bucket);
  }
  return out;
}

type OrderNode = {
  id: string; createdAt: string; cancelledAt: string | null; test: boolean;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customerJourneySummary: { firstVisit: { landingPage: string | null } | null; lastVisit: { landingPage: string | null } | null } | null;
  lineItems: { nodes: Array<{ product: { handle: string } | null }> };
};

/** Paid orders in the span, from Shopify, attributed to each funnel and written to the cache per day. */
async function refreshOrders(from: string, to: string): Promise<void> {
  const totals = new Map<string, { purchases: number; revenue: number; currency: string | null }>();
  const key = (funnelKey: string, day: string) => `${funnelKey}|${day}`;
  for (const funnel of FUNNELS) for (const day of daysBetween(from, to)) totals.set(key(funnel.key, day), { purchases: 0, revenue: 0, currency: null });

  // Israel days start and end three (or two) hours before UTC; ask for a little more and filter here.
  const sinceIso = `${shiftDay(from, -1)}T00:00:00Z`;
  const untilIso = `${shiftDay(to, 2)}T00:00:00Z`;
  let cursor: string | null = null;
  for (let page = 0; page < 12; page += 1) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } = await shopify.adminGraphql(`
      query FunnelOrders($query: String!, $cursor: String) {
        orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id createdAt cancelledAt test
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            customerJourneySummary { firstVisit { landingPage } lastVisit { landingPage } }
            lineItems(first: 10) { nodes { product { handle } } }
          }
        }
      }`, { query: `created_at:>='${sinceIso}' created_at:<'${untilIso}' financial_status:paid`, cursor });
    for (const node of data.orders.nodes) {
      if (node.cancelledAt || node.test) continue;
      const day = israelDay(node.createdAt);
      if (day < from || day > to) continue;
      const order = {
        landingPages: [node.customerJourneySummary?.lastVisit?.landingPage, node.customerJourneySummary?.firstVisit?.landingPage],
        productHandles: node.lineItems.nodes.map(line => line.product?.handle ?? null),
      };
      for (const funnel of FUNNELS) {
        if (!orderBelongsToFunnel(funnel, order)) continue;
        const bucket = totals.get(key(funnel.key, day))!;
        bucket.purchases += 1;
        bucket.revenue += Number(node.currentTotalPriceSet.shopMoney.amount) || 0;
        bucket.currency = node.currentTotalPriceSet.shopMoney.currencyCode;
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  for (const [composite, bucket] of totals) {
    const [funnelKey, day] = composite.split("|");
    await upsertStat(funnelKey, day, "shopify_orders", { purchases: bucket.purchases, revenue: Number(bucket.revenue.toFixed(2)), currency: bucket.currency });
  }
}

/** Which days need a fresh read of orders: missing from the cache, or recent and stale. */
function staleOrderDays(cached: StatRow[], days: string[], today: string): string[] {
  const byDay = new Map(cached.filter(row => row.source === "shopify_orders").map(row => [row.day, row]));
  const now = Date.now();
  return days.filter(day => {
    const row = byDay.get(day);
    if (!row) return true;
    const recent = day >= shiftDay(today, -1);
    return recent && now - new Date(row.updatedAt).getTime() > FRESH_MS;
  });
}

export async function funnelStats(funnel: FunnelDefinition, from: string, to: string): Promise<{ days: DayRow[]; sources: Record<string, string>; refreshedOrders: boolean }> {
  const today = todayInIsrael();
  const days = daysBetween(from, to);
  let cached = await statRows(funnel.key, from, to);
  const stale = staleOrderDays(cached, days, today);
  let refreshedOrders = false;
  if (stale.length) {
    try {
      await refreshOrders(stale[0], stale[stale.length - 1]);
      cached = await statRows(funnel.key, from, to);
      refreshedOrders = true;
    } catch (error) {
      console.error("[FUNNEL STATS] orders refresh failed", String((error as Error)?.message || error).slice(0, 300));
    }
  }
  const firstParty = await firstPartyByDay(funnel, from, to);
  const analytics = new Map(cached.filter(row => row.source === "shopify_analytics").map(row => [row.day, row]));
  const orders = new Map(cached.filter(row => row.source === "shopify_orders").map(row => [row.day, row]));
  const rows = days.map(day => {
    const sh = analytics.get(day);
    const fp = firstParty.get(day);
    const od = orders.get(day);
    const input: DayInput = {
      day,
      shopify: sh ? { sessions: Number(sh.sessions) || 0, addedToCart: Number(sh.addedToCart) || 0, reachedCheckout: Number(sh.reachedCheckout) || 0, purchases: Number(sh.purchases) || 0 } : null,
      firstParty: fp ?? null,
      orders: od ? { purchases: Number(od.purchases) || 0, revenue: Number(od.revenue) || 0 } : null,
    };
    return composeDay(input);
  });
  const currency = cached.find(row => row.currency)?.currency || "ILS";
  return {
    days: rows,
    refreshedOrders,
    sources: {
      currency,
      first_party: funnel.firstPartyExperimentKey ? "Visitors, add to cart and checkout reported by the sales page itself (every visitor, no cookie consent needed) — from 18 Sept 2026." : "Not available for this page.",
      shopify_analytics: "Shopify's Sessions report for the landing page, seeded from the store's own analytics for the days before the page counted visitors itself.",
      shopify_orders: "Paid orders whose landing page or product belongs to this funnel, from the Shopify Admin API; the last two days refresh every ten minutes.",
    },
  };
}

router.get("/funnel-stats/funnels", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ funnels: FUNNELS.map(funnel => ({ key: funnel.key, name: funnel.name, path: funnel.path, firstParty: Boolean(funnel.firstPartyExperimentKey) })) });
});

router.get("/funnel-stats", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const funnel = funnelByKey(req.query.funnel) ?? FUNNELS[0];
  const today = todayInIsrael();
  const to = dayParam(req.query.to, today) > today ? today : dayParam(req.query.to, today);
  const from = dayParam(req.query.from, shiftDay(to, -29));
  if (from > to) return res.status(400).json({ error: "The start day is after the end day." });
  if (daysBetween(from, to).length > MAX_DAYS) return res.status(400).json({ error: `At most ${MAX_DAYS} days at a time.` });
  const grouping: Grouping = ["day", "week", "month"].includes(String(req.query.group)) ? String(req.query.group) as Grouping : "day";
  try {
    const stats = await funnelStats(funnel, from, to);
    const periods = groupRows(stats.days, grouping);
    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      timezone: "Asia/Jerusalem",
      funnel: { key: funnel.key, name: funnel.name, path: funnel.path },
      range: { from, to, days: stats.days.length },
      grouping,
      totals: sumRows(stats.days),
      periods,
      days: stats.days,
      sources: stats.sources,
      refreshedOrders: stats.refreshedOrders,
    });
  } catch (error: any) {
    console.error("[FUNNEL STATS]", String(error?.message || error).slice(0, 300));
    return res.status(502).json({ error: "The funnel table could not be built right now." });
  }
});

export default router;

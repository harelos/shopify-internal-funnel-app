import { Router } from "express";
import { randomUUID } from "node:crypto";
import { env as cloudflareEnv } from "cloudflare:workers";
import { getShopifyConfig, workerEnvValue } from "../lib/shopify-config.js";
import { verifyShopifyAppProxyRequest } from "../middleware/shopify-auth.js";
import { looksLikeBot, requestLimited } from "../lib/request-limit.js";
import { looksLikeInternalTraffic } from "../lib/internal-traffic.js";
import { CRO_EXPERIMENT_KEY, countersFromEvents, weightsFromFlag } from "../lib/cro-assignment.js";
import { getFlagByKey, postHogConfigured } from "../lib/posthog-admin.js";
import {
  LIVE_RETENTION_HOURS,
  deviceClass,
  normalizeBeaconBatch,
  summarizeSessions,
  type LiveRow,
} from "../lib/live-activity.js";

/**
 * Live funnel action.
 *
 * The sales page posts what a shopper does as it happens (through the Shopify
 * app proxy, so every request is signed) and the admin page reads it back a
 * few seconds later. Checkout steps and paid orders come from the sources
 * the app already trusts for them — the Shopify pixel and the order webhook —
 * so the feed never invents a purchase.
 */
export const liveRuntimeRouter = Router();
export const liveAdminRouter = Router();

type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all<T = any>(): Promise<{ results?: T[] }>; first<T = any>(): Promise<T | null> } };
  batch(statements: unknown[]): Promise<unknown>;
};

function db(): D1Like {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  const handle = envObj?.DB ?? (globalThis as any).__SHOPIFY_WORKER_ENV__?.DB;
  if (!handle) throw new Error("Cloudflare D1 binding DB is unavailable in the current request context.");
  return handle as D1Like;
}

async function shopId(): Promise<string | null> {
  const domain = workerEnvValue("SHOP_DOMAIN").toLowerCase();
  const row = await db().prepare(`SELECT "id" FROM "Shop" WHERE "domain" = ? LIMIT 1`).bind(domain).first<{ id: string }>();
  return row?.id ?? null;
}

liveRuntimeRouter.post("/live", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (getShopifyConfig().requireEmbeddedAuth && !verifyShopifyAppProxyRequest(req)) {
      return res.status(401).json({ ok: false, error: "Shopify app proxy signature required." });
    }
    if (looksLikeBot(req.get("user-agent"))) return res.json({ ok: true, ignored: "automated_client" });
    if (requestLimited(req, "live_beacon", 120, 60_000)) return res.status(429).json({ ok: false, error: "Too many requests." });

    const batch = normalizeBeaconBatch(req.body);
    const shop = await shopId();
    if (!shop) return res.status(503).json({ ok: false, error: "Shop is not configured." });
    const device = deviceClass(req.get("user-agent"));
    const isInternal = batch.isInternal || looksLikeInternalTraffic({ query: req.query as Record<string, unknown> });
    const receivedAt = new Date().toISOString();
    const handle = db();
    const insert = handle.prepare(`
      INSERT INTO "LiveActivity" ("id","shopId","sessionKey","visitorKey","occurredAt","receivedAt","kind","label","page","detail","device","source","variant","isInternal")
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    await handle.batch(batch.events.map(event => insert.bind(
      randomUUID(), shop, batch.sessionKey, batch.visitorKey, new Date(event.at).toISOString(), receivedAt,
      event.kind, event.label, batch.page, JSON.stringify(event.detail), device, batch.source, batch.variant, isInternal ? 1 : 0,
    )));
    // The live feed is pruned after two days, so the test's denominator cannot
    // live in it. One durable row per visitor, raised as they go.
    if (batch.variant) {
      const counters = countersFromEvents(batch.events as Array<{ kind?: unknown }>);
      try {
        await handle.prepare(`
          INSERT INTO "CroAssignment" ("id","experimentKey","variant","visitorKey","firstSeenAt","lastSeenAt","addedToCart","reachedCheckout","isInternal")
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT("experimentKey","visitorKey") DO UPDATE SET
            "lastSeenAt" = excluded."lastSeenAt",
            "addedToCart" = max("CroAssignment"."addedToCart", excluded."addedToCart"),
            "reachedCheckout" = max("CroAssignment"."reachedCheckout", excluded."reachedCheckout")`)
          .bind(randomUUID(), CRO_EXPERIMENT_KEY, batch.variant, batch.visitorKey, receivedAt, receivedAt,
                counters.addedToCart ? 1 : 0, counters.reachedCheckout ? 1 : 0, isInternal ? 1 : 0).run();
      } catch (error) {
        console.warn("cro_assignment_write_failed", String((error as Error)?.message || error).slice(0, 120));
      }
    }

    // keep two days; one request in fifty pays for the sweep
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - LIVE_RETENTION_HOURS * 3600 * 1000).toISOString();
      await handle.prepare(`DELETE FROM "LiveActivity" WHERE "receivedAt" < ?`).bind(cutoff).run();
    }
    return res.json({ ok: true, stored: batch.events.length });
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 200);
    if (/required|No recognised|must be a path/.test(message)) return res.status(400).json({ ok: false, error: message });
    console.error(JSON.stringify({ message: "live_beacon_failed", error: message }));
    return res.status(500).json({ ok: false });
  }
});

function isoParam(value: unknown, fallbackMs: number): string {
  const text = String(value ?? "");
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(Date.now() - fallbackMs).toISOString();
}

liveAdminRouter.get("/live/feed", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const handle = db();
    const now = Date.now();
    const since = isoParam(req.query.since, 30 * 60_000);
    const page = String(req.query.page ?? "").trim().slice(0, 160);
    const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 300));

    const [feed, recent, purchases, checkouts] = await Promise.all([
      handle.prepare(`SELECT * FROM "LiveActivity" WHERE "receivedAt" > ? ${page ? 'AND "page" = ?' : ""} ORDER BY "receivedAt" ASC LIMIT ?`)
        .bind(...(page ? [since, page, limit] : [since, limit])).all<LiveRow>(),
      handle.prepare(`SELECT * FROM "LiveActivity" WHERE "occurredAt" > ? ${page ? 'AND "page" = ?' : ""} ORDER BY "occurredAt" ASC LIMIT 4000`)
        .bind(...(page ? [new Date(now - 30 * 60_000).toISOString(), page] : [new Date(now - 30 * 60_000).toISOString()])).all<LiveRow>(),
      handle.prepare(`SELECT "shopifyOrderGid" AS id, "netRevenueAmount" AS amount, "currency", "paidAt", "status" FROM "OrderAttribution" WHERE "isTest" = 0 AND "paidAt" > ? ORDER BY "paidAt" DESC LIMIT 50`)
        .bind(new Date(now - 6 * 3600 * 1000).toISOString()).all<{ id: string; amount: number; currency: string; paidAt: string; status: string }>(),
      handle.prepare(`SELECT "name", "occurredAt", "checkoutToken", "utmSource" FROM "Event" WHERE "source" = 'PIXEL' AND "isTest" = 0 AND "occurredAt" > ? ORDER BY "occurredAt" DESC LIMIT 100`)
        .bind(new Date(now - 60 * 60_000).toISOString()).all<{ name: string; occurredAt: string; checkoutToken: string | null; utmSource: string | null }>(),
    ]);

    const recentRows = recent.results || [];
    const sessions = summarizeSessions(recentRows, now);
    const tenMinutes = new Date(now - 10 * 60_000).toISOString();
    const lastTen = recentRows.filter(row => row.occurredAt > tenMinutes && !row.isInternal);
    const counters = {
      activeNow: sessions.filter(session => session.active && !session.isInternal).length,
      views10m: new Set(lastTen.filter(row => row.kind === "view").map(row => row.sessionKey)).size,
      addToCart10m: new Set(lastTen.filter(row => row.kind === "cart_add").map(row => row.sessionKey)).size,
      checkout10m: new Set(lastTen.filter(row => row.kind === "checkout_click").map(row => row.sessionKey)).size,
      paid60m: (purchases.results || []).filter(order => order.paidAt > new Date(now - 60 * 60_000).toISOString()).length,
    };
    const events = (feed.results || []).map(row => ({ ...row, detail: safeJson(row.detail), isInternal: Boolean(row.isInternal) }));
    res.json({
      now: new Date(now).toISOString(),
      cursor: events.length ? events[events.length - 1].receivedAt : since,
      events,
      sessions,
      counters,
      purchases: purchases.results || [],
      checkouts: checkouts.results || [],
    });
  } catch (error: any) {
    res.status(500).json({ error: String(error?.message || error).slice(0, 200) });
  }
});

function safeJson(value: string): Record<string, unknown> {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

/**
 * GET /apps/funnels/cro-split
 *
 * The sales page buckets the visitor itself rather than waiting for PostHog,
 * so it needs to know the split. PostHog stays the place the split is edited;
 * this just publishes it. Cached briefly so a burst of visitors is one call.
 */
let splitCache: { at: number; body: unknown } | null = null;
const SPLIT_CACHE_MS = 60_000;

liveRuntimeRouter.get("/cro-split", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=60");
  try {
    if (splitCache && Date.now() - splitCache.at < SPLIT_CACHE_MS) return res.json(splitCache.body);
    const flag = postHogConfigured() ? await getFlagByKey(CRO_EXPERIMENT_KEY) : null;
    const body = {
      flag: CRO_EXPERIMENT_KEY,
      active: flag ? Boolean(flag.active) : false,
      variants: weightsFromFlag(flag),
    };
    splitCache = { at: Date.now(), body };
    return res.json(body);
  } catch (error) {
    // A page that cannot reach us still has to test something, so it falls back on its own.
    console.warn("cro_split_unavailable", String((error as Error)?.message || error).slice(0, 120));
    return res.status(503).json({ error: "split unavailable" });
  }
});

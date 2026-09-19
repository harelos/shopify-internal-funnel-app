import { hogql, postHogConfigured } from "../lib/posthog-admin.js";
import { resolveFxRate } from "../lib/fx.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  EXPERIMENT_KEY_PATTERN,
  VISITOR_COOKIE,
  chooseVariant,
  experimentStatus,
  findRunningExperiment,
  newVisitorKey,
  normalizeLandingPath,
  normalizeNewExperiment,
  normalizeWeights,
  pageExperimentDb,
  recordAssignment,
  redirectTarget,
  reuseVisitorKey,
  visitorCookie,
} from "../lib/page-experiments.js";
import { reconcilePageExperimentOrders } from "../services/page-experiment-attribution.js";
import { workerEnvValue } from "../lib/shopify-config.js";

export const pageExperimentRuntimeRouter = Router();
export const pageExperimentAdminRouter = Router();

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function queryString(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 200) : undefined;
}

/**
 * Splits storefront traffic between whole pages.
 *
 * The decision is made here rather than in the storefront so no theme snippet
 * has to exist, nothing flickers, and removing a theme section cannot silently
 * stop the experiment.
 */
pageExperimentRuntimeRouter.get("/go/:experimentKey", async (req, res) => {
  const key = String(req.params.experimentKey || "").toLowerCase();
  if (!EXPERIMENT_KEY_PATTERN.test(key)) return res.status(400).json({ error: "Unknown experiment." });

  const found = await findRunningExperiment(key).catch(() => null);
  if (!found || !found.variants.length) return res.status(404).json({ error: "Unknown experiment." });

  const { experiment, variants } = found;

  // A stopped experiment still has to send its traffic somewhere sensible.
  if (experiment.status !== "RUNNING") {
    const settled = variants.find(variant => variant.id === experiment.promotedVariantId)
      || variants.find(variant => variant.isControl)
      || variants[0];
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(302, redirectTarget(settled.landingPath, req.originalUrl.split("?")[1] || ""));
  }

  const cookieHeader = req.get("cookie");
  const visitorKey = reuseVisitorKey([
    readCookie(cookieHeader, VISITOR_COOKIE),
    readCookie(cookieHeader, "_shopify_y"),
  ]) || newVisitorKey();
  const variant = chooseVariant(variants, visitorKey);
  if (!variant) return res.status(503).json({ error: "The experiment has no eligible variation." });

  const isInternal = String(req.query.fc_internal || "") === "1";
  await recordAssignment({
    experimentId: experiment.id,
    variantId: variant.id,
    visitorKey,
    utm: {
      source: queryString(req.query.utm_source),
      medium: queryString(req.query.utm_medium),
      campaign: queryString(req.query.utm_campaign),
      content: queryString(req.query.utm_content),
    },
    isInternal,
  }).catch(() => { /* a lost assignment must not cost the visitor their page */ });

  const already = res.getHeader("Set-Cookie");
  const cookie = visitorCookie(visitorKey);
  res.setHeader("Set-Cookie", already ? (Array.isArray(already) ? [...already, cookie] : [String(already), cookie]) : cookie);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, redirectTarget(variant.landingPath, req.originalUrl.split("?")[1] || ""));
});

pageExperimentAdminRouter.get("/page-experiments", async (_req, res) => {
  const db = pageExperimentDb();
  if (!db) return res.status(503).json({ error: "The experiment store is unavailable." });
  const rows = await db
    .prepare(`SELECT "id", "key", "name", "hypothesis", "status", "startedAt", "stoppedAt", "promotedVariantId" FROM "PageExperiment" ORDER BY "createdAt" DESC`)
    .bind()
    .all();
  return res.json({ experiments: rows.results || [] });
});

pageExperimentAdminRouter.get("/page-experiments/:id/results", async (req, res) => {
  const db = pageExperimentDb();
  if (!db) return res.status(503).json({ error: "The experiment store is unavailable." });
  const experimentId = String(req.params.id);
  const variants = await db
    .prepare(`SELECT "id", "key", "label", "landingPath", "weight", "isControl" FROM "PageExperimentVariant" WHERE "experimentId" = ? ORDER BY "isControl" DESC, "key" ASC`)
    .bind(experimentId)
    .all();
  const assignments = await db
    .prepare(`SELECT "variantId", COUNT(*) AS visitors FROM "PageExperimentAssignment" WHERE "experimentId" = ? AND "isInternal" = 0 GROUP BY "variantId"`)
    .bind(experimentId)
    .all();
  const orders = await db
    .prepare(`SELECT "variantId", COUNT(*) AS orders, SUM("netAmount") AS revenue, "currency" FROM "PageExperimentOrder" WHERE "experimentId" = ? GROUP BY "variantId", "currency"`)
    .bind(experimentId)
    .all();

  const visitorsByVariant = new Map((assignments.results || []).map((row: any) => [row.variantId, Number(row.visitors)]));
  const ordersByVariant = new Map((orders.results || []).map((row: any) => [row.variantId, row]));
  const experimentRow = (await db.prepare(`SELECT "startedAt", "createdAt" FROM "PageExperiment" WHERE "id" = ?`).bind(experimentId).first()) as { startedAt: string | null; createdAt: string } | null;
  const since = new Date(experimentRow?.startedAt || experimentRow?.createdAt || Date.now() - 14 * 86400000).toISOString();
  const paths = (variants.results || []).map((variant: any) => String(variant.landingPath));
  const [funnel, spend] = await Promise.all([pageFunnelFromPostHog(paths, since), pageSpendSince(since)]);
  const totalVisitors = [...visitorsByVariant.values()].reduce((sum, n) => sum + n, 0);

  return res.json({
    experimentId,
    since,
    spend,
    measurement: {
      visitors: "Server-side assignments made by the traffic splitter, excluding internal traffic.",
      orders: "Paid Shopify orders whose recorded landing page matches the variation's page.",
      funnel: "Add-to-cart and checkout clicks come from PostHog, which only sees shoppers who accepted cookies; read them as rates, not totals.",
      caveat: "A visitor who reaches a variation page without passing the splitter is counted as an order but not as a visitor.",
    },
    variants: (variants.results || []).map((variant: any) => {
      const visitors = visitorsByVariant.get(variant.id) || 0;
      const orderRow: any = ordersByVariant.get(variant.id);
      const orderCount = Number(orderRow?.orders || 0);
      const revenue = orderRow?.revenue != null ? Number(Number(orderRow.revenue).toFixed(2)) : 0;
      const steps = funnel?.get(String(variant.landingPath)) || null;
      const spendShare = spend && totalVisitors > 0 && visitors > 0 && (!orderRow?.currency || spend.currency === orderRow.currency)
        ? Number((spend.amount * visitors / totalVisitors).toFixed(2)) : null;
      return {
        ...variant,
        isControl: Boolean(variant.isControl),
        visitors,
        orders: orderCount,
        revenue,
        currency: orderRow?.currency ?? null,
        conversionRate: visitors > 0 ? Number(((orderCount / visitors) * 100).toFixed(2)) : null,
        revenuePerVisitor: visitors > 0 ? Number((revenue / visitors).toFixed(2)) : null,
        addToCart: steps?.addToCart ?? null,
        checkout: steps?.checkout ?? null,
        addToCartRate: steps && steps.viewers > 0 ? Number((steps.addToCart / steps.viewers).toFixed(4)) : null,
        checkoutRate: steps && steps.viewers > 0 ? Number((steps.checkout / steps.viewers).toFixed(4)) : null,
        spendShare,
        roas: spendShare && spendShare > 0 ? Number((revenue / spendShare).toFixed(2)) : null,
      };
    }),
  });
});

/**
 * What PostHog saw happen on each page since the test began. Consent gates
 * PostHog, so these are a sample of the visitors; the splitter's count is the
 * denominator that matters, and these give the rates between the steps.
 */
async function pageFunnelFromPostHog(paths: string[], since: string): Promise<Map<string, { viewers: number; addToCart: number; checkout: number }> | null> {
  if (!paths.length || !postHogConfigured()) return null;
  try {
    const list = paths.map(path => `'${path.replace(/'/g, "''")}'`).join(",");
    const from = since.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", "");
    const rows = await hogql<[string, number, number, number]>(`
      SELECT properties.$pathname AS path,
             uniqIf(distinct_id, event = '$pageview') AS viewers,
             uniqIf(distinct_id, event IN ('add_to_cart_succeeded', 'cart_line_added', 'nova_add_to_cart', 'oceaura_add_to_cart')) AS add_to_cart,
             uniqIf(distinct_id, event IN ('checkout_clicked', 'nova_checkout_clicked', 'oceaura_checkout_click')) AS checkout
      FROM events
      WHERE timestamp >= toDateTime('${from}') AND properties.$pathname IN (${list})
      GROUP BY path`);
    return new Map(rows.map((row) => [String(row[0]), { viewers: Number(row[1]) || 0, addToCart: Number(row[2]) || 0, checkout: Number(row[3]) || 0 }]));
  } catch (error) {
    console.warn("page_experiment_funnel_unavailable", String((error as Error)?.message || error).slice(0, 120));
    return null;
  }
}

/** Meta spend booked since the test began, in the store's currency; null when nothing is booked. */
async function pageSpendSince(since: string): Promise<{ amount: number; currency: string; note: string } | null> {
  const db = pageExperimentDb();
  if (!db) return null;
  try {
    const row: any = await db.prepare(`SELECT SUM("amount") AS usd FROM "FinancialLedgerEntry"
      WHERE "source" = 'META_ADS_INSIGHTS' AND "category" = 'AD_SPEND' AND "currency" = 'USD' AND "occurredDate" >= ?`).bind(since.slice(0, 10)).first();
    const usd = Number(row?.usd) || 0;
    if (!usd) return null;
    const reporting = (workerEnvValue("REPORTING_CURRENCY") || "ILS").toUpperCase();
    const quote = await resolveFxRate("USD", reporting).catch(() => null);
    if (!quote?.rate) return { amount: Number(usd.toFixed(2)), currency: "USD", note: "Meta spend in USD; no exchange rate available, so ROAS is not shown." };
    return { amount: Number((usd * quote.rate).toFixed(2)), currency: reporting, note: `Meta spend since ${since.slice(0, 10)}, converted at ${quote.rate} USD/${reporting}; each page's share follows its share of visitors.` };
  } catch {
    return null;
  }
}

pageExperimentAdminRouter.post("/page-experiments/reconcile", async (req, res) => {
  try {
    const sinceDays = Number(req.body?.sinceDays);
    const result = await reconcilePageExperimentOrders({
      sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? Math.min(sinceDays, 60) : 7,
      sessionToken: req.get("authorization")?.startsWith("Bearer ") ? req.get("authorization")!.slice(7).trim() : undefined,
    });
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: String(error?.message || "Attribution reconciliation failed.").slice(0, 240) });
  }
});

export { normalizeLandingPath };

/* ------------------------------------------------------------------ admin edits */

function failEdit(res: import("express").Response, error: unknown) {
  const message = String((error as Error)?.message || error).slice(0, 240);
  res.status(/add up|whole number|not part of|listed twice|needs a share|at least|short name|storefront path|variation|already/i.test(message) ? 400 : 500).json({ error: message });
}

async function variantIds(db: NonNullable<ReturnType<typeof pageExperimentDb>>, experimentId: string): Promise<string[]> {
  const rows = await db.prepare(`SELECT "id" FROM "PageExperimentVariant" WHERE "experimentId" = ? ORDER BY "isControl" DESC, "key" ASC`).bind(experimentId).all();
  return (rows.results || []).map((row: any) => String(row.id));
}

/** Change how traffic is shared between the pages. Takes effect on the next visitor. */
pageExperimentAdminRouter.patch("/page-experiments/:id/weights", async (req, res) => {
  const db = pageExperimentDb();
  if (!db) return res.status(503).json({ error: "The experiment store is unavailable." });
  try {
    const experimentId = String(req.params.id);
    const ids = await variantIds(db, experimentId);
    if (!ids.length) return res.status(404).json({ error: "No such page test." });
    const weights = normalizeWeights(req.body?.variants, ids);
    for (const row of weights) {
      await db.prepare(`UPDATE "PageExperimentVariant" SET "weight" = ? WHERE "id" = ? AND "experimentId" = ?`)
        .bind(row.weight, row.id, experimentId).run();
    }
    await db.prepare(`UPDATE "PageExperiment" SET "updatedAt" = ? WHERE "id" = ?`).bind(new Date().toISOString(), experimentId).run();
    return res.json({ ok: true, variants: weights });
  } catch (error) { return failEdit(res, error); }
});

/** Start or stop the split. A stopped test sends everyone to the control page. */
pageExperimentAdminRouter.post("/page-experiments/:id/status", async (req, res) => {
  const db = pageExperimentDb();
  if (!db) return res.status(503).json({ error: "The experiment store is unavailable." });
  try {
    const experimentId = String(req.params.id);
    const status = experimentStatus(req.body?.status);
    const now = new Date().toISOString();
    const existing = await db.prepare(`SELECT "startedAt" FROM "PageExperiment" WHERE "id" = ?`).bind(experimentId).first();
    if (!existing) return res.status(404).json({ error: "No such page test." });
    await db.prepare(`UPDATE "PageExperiment" SET "status" = ?, "startedAt" = ?, "stoppedAt" = ?, "updatedAt" = ? WHERE "id" = ?`)
      .bind(status, status === "RUNNING" ? (existing.startedAt || now) : existing.startedAt, status === "STOPPED" ? now : null, now, experimentId).run();
    return res.json({ ok: true, status });
  } catch (error) { return failEdit(res, error); }
});

/** Add a new whole-page test. The pages must already exist on the storefront. */
pageExperimentAdminRouter.post("/page-experiments", async (req, res) => {
  const db = pageExperimentDb();
  if (!db) return res.status(503).json({ error: "The experiment store is unavailable." });
  try {
    const draft = normalizeNewExperiment(req.body, workerEnvValue("SHOPIFY_STOREFRONT_DOMAIN") || workerEnvValue("SHOP_DOMAIN"));
    const clash = await db.prepare(`SELECT "id" FROM "PageExperiment" WHERE "key" = ?`).bind(draft.key).first();
    if (clash) return res.status(400).json({ error: `A page test called "${draft.key}" already exists.` });
    const shop = await db.prepare(`SELECT "id" FROM "Shop" WHERE lower("domain") = ? LIMIT 1`).bind(String(workerEnvValue("SHOP_DOMAIN")).toLowerCase()).first();
    if (!shop) return res.status(503).json({ error: "This shop is not set up yet." });

    const experimentId = randomUUID();
    const now = new Date().toISOString();
    await db.prepare(`INSERT INTO "PageExperiment" ("id","shopId","key","name","hypothesis","status","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)`)
      .bind(experimentId, shop.id, draft.key, draft.name, draft.hypothesis, "DRAFT", now, now).run();
    for (const variant of draft.variants) {
      await db.prepare(`INSERT INTO "PageExperimentVariant" ("id","experimentId","key","label","landingPath","weight","isControl","createdAt") VALUES (?,?,?,?,?,?,?,?)`)
        .bind(randomUUID(), experimentId, variant.key, variant.label, variant.landingPath, variant.weight, variant.isControl, now).run();
    }
    return res.json({ ok: true, id: experimentId, key: draft.key });
  } catch (error) { return failEdit(res, error); }
});

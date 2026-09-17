import { Router } from "express";
import {
  VISITOR_COOKIE,
  chooseVariant,
  findRunningExperiment,
  isValidVisitorKey,
  newVisitorKey,
  normalizeLandingPath,
  pageExperimentDb,
  recordAssignment,
  redirectTarget,
} from "../lib/page-experiments.js";
import { reconcilePageExperimentOrders } from "../services/page-experiment-attribution.js";

export const pageExperimentRuntimeRouter = Router();
export const pageExperimentAdminRouter = Router();

const EXPERIMENT_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

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

  const existingKey = readCookie(req.get("cookie"), VISITOR_COOKIE);
  const visitorKey = isValidVisitorKey(existingKey) ? existingKey : newVisitorKey();
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

  res.cookie?.(VISITOR_COOKIE, visitorKey, {
    maxAge: 180 * 86400 * 1000,
    httpOnly: false,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
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

  return res.json({
    experimentId,
    measurement: {
      visitors: "Server-side assignments made by the traffic splitter, excluding internal traffic.",
      orders: "Paid Shopify orders whose recorded landing page matches the variation's page.",
      caveat: "A visitor who reaches a variation page without passing the splitter is counted as an order but not as a visitor.",
    },
    variants: (variants.results || []).map((variant: any) => {
      const visitors = visitorsByVariant.get(variant.id) || 0;
      const orderRow: any = ordersByVariant.get(variant.id);
      const orderCount = Number(orderRow?.orders || 0);
      return {
        ...variant,
        isControl: Boolean(variant.isControl),
        visitors,
        orders: orderCount,
        revenue: orderRow?.revenue != null ? Number(Number(orderRow.revenue).toFixed(2)) : 0,
        currency: orderRow?.currency ?? null,
        conversionRate: visitors > 0 ? Number(((orderCount / visitors) * 100).toFixed(2)) : null,
      };
    }),
  });
});

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

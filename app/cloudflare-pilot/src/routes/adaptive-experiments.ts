import { Router } from "express";
import { env as cloudflareEnv } from "cloudflare:workers";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import {
  PostHogConfigurationError,
  getFlagByKey,
  hogql,
  listExperiments,
  postHogAppUrl,
  postHogConfigured,
  updateExperiment,
  updateFlag,
  type PostHogExperiment,
  type PostHogFlag,
} from "../lib/posthog-admin.js";
import {
  buildAdaptiveResults,
  normalizeAllocations,
  variantFromOrder,
  type ExposureRow,
  type OrderLike,
  type OrderRow,
} from "../lib/adaptive-experiments.js";
import { EXPERIMENTS } from "../lib/cro-assignment.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { resolveFxRate } from "../lib/fx.js";

/**
 * The adaptive page tests, as the merchant sees them: which experiences are
 * running, who gets how much traffic, and what each one earned. PostHog owns
 * the assignment; Shopify owns the money; this router only reads both and
 * forwards the two controls that matter (the split and the switch).
 */
export const adaptiveExperimentAdminRouter = Router();

const shopify = new ShopifyAdminClient();
const RESULTS_TTL_MS = 60_000;
const resultsCache = new Map<string, { at: number; value: unknown }>();

function fail(res: import("express").Response, error: unknown, status = 500) {
  const message = String((error as Error)?.message || error).slice(0, 300);
  if (error instanceof PostHogConfigurationError) {
    return res.status(503).json({ error: message, nextAction: "Add POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID to the Worker (wrangler secret put / vars) and redeploy." });
  }
  return res.status(status).json({ error: message });
}

function flagKey(value: unknown): string {
  const key = String(value ?? "").trim();
  if (!/^[a-z0-9_-]{3,80}$/i.test(key)) throw new Error("That is not a feature flag key.");
  return key;
}

function variantsOf(flag: PostHogFlag) {
  return (flag.filters?.multivariate?.variants || []).map(variant => ({
    key: variant.key,
    name: variant.name || variant.key,
    percentage: Number(variant.rollout_percentage) || 0,
  }));
}

function sinceFor(experiment: PostHogExperiment | null): string {
  if (experiment?.start_date) return new Date(experiment.start_date).toISOString();
  return new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
}

function toClickHouseTime(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "").replace("Z", "");
}

/**
 * Who was in the test, counted from the page's own reports.
 *
 * PostHog only ever saw the shoppers who accepted cookies, which on the first
 * night was a small minority, so the table it produced was empty next to real
 * orders. These rows are written by the sales page itself for every visitor.
 */
async function exposuresFromFirstParty(key: string, since: string): Promise<ExposureRow[]> {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  const db = envObj?.DB;
  if (!db) return [];
  const rows = await db.prepare(`
    SELECT "variant",
           COUNT(*) AS visitors,
           SUM("addedToCart") AS add_to_cart,
           SUM("reachedCheckout") AS checkout
    FROM "CroAssignment"
    WHERE "experimentKey" = ? AND "isInternal" = 0 AND "firstSeenAt" >= ?
    GROUP BY "variant"`).bind(key, since).all();
  return ((rows.results || []) as any[]).map(row => ({
    variant: String(row.variant),
    visitors: Number(row.visitors) || 0,
    addToCart: Number(row.add_to_cart) || 0,
    checkout: Number(row.checkout) || 0,
  }));
}

/** Kept for reference: what PostHog alone can see, which is only consenting shoppers. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function exposuresFromPostHog(key: string, since: string): Promise<ExposureRow[]> {
  const feature = `properties['$feature/${key}']`;
  const rows = await hogql<[string, number, number, number]>(`
    SELECT ${feature} AS variant,
           uniqIf(distinct_id, event = '$feature_flag_called' AND properties['$feature_flag'] = '${key}') AS visitors,
           uniqIf(distinct_id, event = 'nova_add_to_cart') AS add_to_cart,
           uniqIf(distinct_id, event = 'nova_checkout_clicked') AS checkout
    FROM events
    WHERE timestamp >= toDateTime('${toClickHouseTime(since)}')
      AND ${feature} IS NOT NULL
      AND (properties.qa_ghost IS NULL OR toString(properties.qa_ghost) != 'true')
    GROUP BY variant`);
  return rows.map(([variant, visitors, addToCart, checkout]) => ({
    variant: String(variant), visitors: Number(visitors) || 0, addToCart: Number(addToCart) || 0, checkout: Number(checkout) || 0,
  }));
}

interface OrderNode extends OrderLike {
  id: string;
  name: string;
  cancelledAt: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
}

async function ordersFromShopify(since: string, experimentKey: string): Promise<OrderRow[]> {
  const orders: OrderRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 8; page += 1) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } = await shopify.adminGraphql(`
      query AdaptiveOrders($query: String!, $cursor: String) {
        orders(first: 250, after: $cursor, query: $query, sortKey: CREATED_AT) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id name cancelledAt
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            customAttributes { key value }
            lineItems(first: 25) { nodes { customAttributes { key value } } }
          }
        }
      }`, { query: `created_at:>='${since}' financial_status:paid`, cursor });
    for (const node of data.orders.nodes) {
      orders.push({
        orderId: node.id,
        variant: variantFromOrder(node, experimentKey),
        amount: Number(node.currentTotalPriceSet.shopMoney.amount) || 0,
        currency: node.currentTotalPriceSet.shopMoney.currencyCode,
        cancelled: Boolean(node.cancelledAt),
      });
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return orders;
}

/**
 * Meta spend booked for the window, restated in the store's currency so it can
 * sit next to revenue. The ledger holds one USD row per day; the FX quote is
 * the same one the growth cockpit uses. Null when nothing is booked yet.
 */
async function adSpendSince(since: string): Promise<{ amount: number; currency: string; note: string } | null> {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  const db = envObj?.DB;
  if (!db) return null;
  const row = await db.prepare(`SELECT SUM("amount") AS usd FROM "FinancialLedgerEntry"
    WHERE "source" = 'META_ADS_INSIGHTS' AND "category" = 'AD_SPEND' AND "currency" = 'USD' AND "occurredDate" >= ?`)
    .bind(since.slice(0, 10)).first();
  const usd = Number(row?.usd) || 0;
  if (!usd) return null;
  const reporting = (workerEnvValue("REPORTING_CURRENCY") || "ILS").toUpperCase();
  const quote = await resolveFxRate("USD", reporting).catch(() => null);
  if (!quote?.rate) return { amount: Number(usd.toFixed(2)), currency: "USD", note: "Meta spend in USD; no exchange rate available, so ROAS is not shown." };
  return {
    amount: Number((usd * quote.rate).toFixed(2)),
    currency: reporting,
    note: `Meta spend since ${since.slice(0, 10)}, converted at ${quote.rate} USD/${reporting}. Each variant's share follows its share of visitors, so ROAS is an estimate.`,
  };
}

async function describe(key: string, experiments: PostHogExperiment[] | null) {
  const flag = await getFlagByKey(key);
  if (!flag) throw new Error(`No PostHog feature flag called "${key}".`);
  const experiment = (experiments ?? await listExperiments()).find(item => item.feature_flag_key === key) || null;
  const since = sinceFor(experiment);
  const variants = variantsOf(flag);
  const cacheKey = `${key}:${since}`;
  const cached = resultsCache.get(cacheKey);
  let results: unknown;
  let resultErrors: Record<string, string> = {};
  if (cached && Date.now() - cached.at < RESULTS_TTL_MS) {
    results = cached.value;
  } else {
    const [exposures, orders, spend] = await Promise.allSettled([exposuresFromFirstParty(key, since), ordersFromShopify(since, key), adSpendSince(since)]);
    if (exposures.status === "rejected") resultErrors.visitors = String(exposures.reason?.message || exposures.reason).slice(0, 200);
    if (orders.status === "rejected") resultErrors.shopify = String(orders.reason?.message || orders.reason).slice(0, 200);
    results = buildAdaptiveResults({
      variants,
      exposures: exposures.status === "fulfilled" ? exposures.value : [],
      orders: orders.status === "fulfilled" ? orders.value : [],
      controlKey: EXPERIMENTS[key]?.control,
      spend: spend.status === "fulfilled" ? spend.value : null,
    });
    if (!Object.keys(resultErrors).length) resultsCache.set(cacheKey, { at: Date.now(), value: results });
  }
  return {
    key,
    name: experiment?.name || flag.name || key,
    description: experiment?.description || "",
    flagId: flag.id,
    experimentId: experiment?.id ?? null,
    active: Boolean(flag.active),
    startedAt: experiment?.start_date || null,
    endedAt: experiment?.end_date || null,
    since,
    variants,
    results,
    sources: {
      visitors: { name: "Sales page", state: resultErrors.visitors ? "ERROR" : "ACTUAL", error: resultErrors.visitors || null },
      orders: { name: "Shopify orders", state: resultErrors.shopify ? "ERROR" : "ACTUAL", error: resultErrors.shopify || null },
    },
    links: {
      experiment: experiment ? postHogAppUrl(`/experiments/${experiment.id}`) : null,
      flag: postHogAppUrl(`/feature_flags/${flag.id}`),
    },
  };
}

adaptiveExperimentAdminRouter.get("/adaptive-experiments", async (_req, res) => {
  try {
    if (!postHogConfigured()) throw new PostHogConfigurationError("PostHog is not connected.");
    const experiments = await listExperiments();
    const keys = [...new Set(experiments.map(item => item.feature_flag_key).filter(Boolean))];
    const items = await Promise.all(keys.map(async key => {
      try { return await describe(key, experiments); }
      catch (error) { return { key, error: String((error as Error)?.message || error).slice(0, 200) }; }
    }));
    res.json({ experiments: items, connected: true });
  } catch (error) { fail(res, error); }
});

adaptiveExperimentAdminRouter.get("/adaptive-experiments/:key", async (req, res) => {
  try {
    res.json(await describe(flagKey(req.params.key), null));
  } catch (error) { fail(res, error, /not a feature flag|No PostHog/.test(String((error as Error)?.message)) ? 404 : 500); }
});

adaptiveExperimentAdminRouter.patch("/adaptive-experiments/:key/allocations", async (req, res) => {
  try {
    const key = flagKey(req.params.key);
    const flag = await getFlagByKey(key);
    if (!flag) return res.status(404).json({ error: `No PostHog feature flag called "${key}".` });
    const known = variantsOf(flag);
    const allocations = normalizeAllocations(req.body?.variants, known.map(variant => variant.key));
    const variants = (flag.filters.multivariate?.variants || []).map(variant => ({
      ...variant, rollout_percentage: allocations.find(row => row.key === variant.key)!.percentage,
    }));
    await updateFlag(flag.id, { filters: { ...flag.filters, multivariate: { variants } } });
    resultsCache.clear();
    // Read back rather than trust the write: a split the owner set and never
    // saw take effect is worse than an error.
    const confirmed = await getFlagByKey(key);
    const saved = confirmed ? variantsOf(confirmed) : [];
    const matches = saved.length === allocations.length && allocations.every(row => saved.find(v => v.key === row.key)?.percentage === row.percentage);
    if (!matches) return res.status(502).json({ error: "PostHog did not keep the new split. Nothing changed for visitors; try again.", variants: saved });
    res.json({ ok: true, variants: saved });
  } catch (error) { fail(res, error, /add up|Unknown|missing|whole number|twice|Send one/.test(String((error as Error)?.message)) ? 400 : 500); }
});

for (const action of ["pause", "resume"] as const) {
  adaptiveExperimentAdminRouter.post(`/adaptive-experiments/:key/${action}`, async (req, res) => {
    try {
      const key = flagKey(req.params.key);
      const flag = await getFlagByKey(key);
      if (!flag) return res.status(404).json({ error: `No PostHog feature flag called "${key}".` });
      const updated = await updateFlag(flag.id, { active: action === "resume" });
      res.json({ ok: true, active: Boolean(updated.active) });
    } catch (error) { fail(res, error); }
  });
}

adaptiveExperimentAdminRouter.post("/adaptive-experiments/:key/reset", async (req, res) => {
  try {
    const key = flagKey(req.params.key);
    const experiment = (await listExperiments()).find(item => item.feature_flag_key === key);
    if (!experiment) return res.status(404).json({ error: `No PostHog experiment uses the flag "${key}".` });
    const startedAt = new Date().toISOString();
    await updateExperiment(experiment.id, { start_date: startedAt });
    resultsCache.clear();
    res.json({ ok: true, startedAt });
  } catch (error) { fail(res, error); }
});

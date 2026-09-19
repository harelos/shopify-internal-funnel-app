import { lifecycleConfig, lifecycleMode } from "./config";
import { hashEmail } from "./crypto";
import { healthValue, isoNow, recordLifecycleError, setHealth } from "./db";
import type { ConsentState, D1Database, LifecycleEnv, ShopifyCustomerNode } from "./types";

const NOVAHAIR_HANDLE = /novahair|novasale|novaextra/i;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Engagement score. Pure, deterministic, bounded 0..100. Three independent
// signals, each capped, so a single very active customer cannot exceed 100 and
// a lapsed heavy buyer still scores on frequency.
//
//   recency of last order   0..40   ≤30d 40 | ≤90d 30 | ≤180d 20 | ≤365d 10
//   order frequency         0..30   1 → 10 | 2 → 20 | ≥3 → 30
//   email engagement        0..30   click ≤30d 30 | open ≤30d 20 | open ≤90d 10
// ---------------------------------------------------------------------------
export interface ScoreInput {
  lastOrderAt: string | null;
  orderCount: number;
  lastOpenAt: string | null;
  lastClickAt: string | null;
}

function ageDays(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / DAY;
}

export function engagementScore(input: ScoreInput, now = new Date()): number {
  let score = 0;

  const orderAge = ageDays(input.lastOrderAt, now);
  if (orderAge !== null) {
    if (orderAge <= 30) score += 40;
    else if (orderAge <= 90) score += 30;
    else if (orderAge <= 180) score += 20;
    else if (orderAge <= 365) score += 10;
  }

  if (input.orderCount >= 3) score += 30;
  else if (input.orderCount === 2) score += 20;
  else if (input.orderCount === 1) score += 10;

  const clickAge = ageDays(input.lastClickAt, now);
  const openAge = ageDays(input.lastOpenAt, now);
  if (clickAge !== null && clickAge <= 30) score += 30;
  else if (openAge !== null && openAge <= 30) score += 20;
  else if (openAge !== null && openAge <= 90) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------------------------------------------------------------------
// Product helpers
// ---------------------------------------------------------------------------
function mergeHandles(existingJson: string | null, incoming: string[]): string[] {
  let existing: string[] = [];
  try { existing = JSON.parse(existingJson ?? "[]"); } catch { existing = []; }
  const merged = new Set<string>(existing.map(h => String(h).toLowerCase()));
  for (const h of incoming) if (h) merged.add(String(h).toLowerCase());
  return [...merged].sort();
}

function isNovaHairBuyer(handles: string[]): 0 | 1 {
  return handles.some(h => NOVAHAIR_HANDLE.test(h)) ? 1 : 0;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function allowedInMode(env: LifecycleEnv, email: string): boolean {
  const mode = lifecycleMode(env);
  if (mode === "disabled") return false;
  if (mode === "test") return email === lifecycleConfig(env).testEmail;
  return true;
}

// ---------------------------------------------------------------------------
// Upsert from a Shopify customer node (GraphQL). Used by both the one-time
// backfill and the incremental consent sync, so the row keeps converging on
// Shopify's truth for identity, consent and order totals.
// ---------------------------------------------------------------------------
export async function upsertCustomerFromShopify(
  env: LifecycleEnv,
  node: ShopifyCustomerNode,
  now: Date,
  source: "SHOPIFY_BACKFILL" | "SHOPIFY_SYNC",
): Promise<boolean> {
  const address = node.defaultEmailAddress;
  const email = address?.validFormat === false ? null : normalizedEmail(address?.emailAddress);
  if (!email || !allowedInMode(env, email)) return false;

  const config = lifecycleConfig(env);
  const emailHash = await hashEmail(email, config.hashKey);
  const current = isoNow(now);
  const consent: ConsentState = address?.marketingState ?? "UNKNOWN";
  const orderCount = Math.max(0, Number(node.numberOfOrders ?? 0) || 0);
  const ltv = Number(node.amountSpent?.amount ?? 0) || 0;
  const currency = node.amountSpent?.currencyCode ?? null;
  const lastOrderAt = node.lastOrder?.createdAt ?? null;

  await env.DB.prepare(
    `INSERT INTO customers (
       email_hash, email, shopify_customer_id, first_name, consent_state, consent_updated_at,
       customer_since, last_order_at, order_count, lifetime_value, lifetime_currency,
       source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email_hash) DO UPDATE SET
       email = excluded.email,
       shopify_customer_id = COALESCE(excluded.shopify_customer_id, customers.shopify_customer_id),
       first_name = COALESCE(excluded.first_name, customers.first_name),
       consent_state = excluded.consent_state,
       consent_updated_at = COALESCE(excluded.consent_updated_at, customers.consent_updated_at),
       customer_since = COALESCE(customers.customer_since, excluded.customer_since),
       -- Shopify's aggregate wins over our incremental count: it sees every channel.
       last_order_at = CASE
         WHEN excluded.last_order_at IS NULL THEN customers.last_order_at
         WHEN customers.last_order_at IS NULL THEN excluded.last_order_at
         WHEN excluded.last_order_at > customers.last_order_at THEN excluded.last_order_at
         ELSE customers.last_order_at END,
       order_count = MAX(excluded.order_count, customers.order_count),
       lifetime_value = MAX(excluded.lifetime_value, customers.lifetime_value),
       lifetime_currency = COALESCE(excluded.lifetime_currency, customers.lifetime_currency),
       updated_at = excluded.updated_at`,
  ).bind(
    emailHash,
    email,
    node.id,
    node.firstName ?? null,
    consent,
    address?.marketingUpdatedAt ?? null,
    node.createdAt ?? null,
    lastOrderAt,
    orderCount,
    ltv,
    currency,
    source,
    current,
    current,
  ).run();
  return true;
}

// ---------------------------------------------------------------------------
// Webhook path: a paid order. Increments locally so the row is fresh before
// the next Shopify sync catches up.
// ---------------------------------------------------------------------------
export async function touchCustomerOnOrder(
  env: LifecycleEnv,
  input: {
    email: string;
    emailHash: string;
    shopifyCustomerId: string | null;
    firstName: string | null;
    consentState: ConsentState;
    completedAt: string;
    total: number | null;
    currency: string | null;
    productHandles: string[];
  },
  now: Date,
): Promise<void> {
  const current = isoNow(now);
  const existing = await env.DB.prepare(
    "SELECT products_json FROM customers WHERE email_hash = ?",
  ).bind(input.emailHash).first<{ products_json: string }>();
  const handles = mergeHandles(existing?.products_json ?? null, input.productHandles);
  const nova = isNovaHairBuyer(handles);

  await env.DB.prepare(
    `INSERT INTO customers (
       email_hash, email, shopify_customer_id, first_name, consent_state,
       first_order_at, last_order_at, order_count, lifetime_value, lifetime_currency,
       products_json, novahair_buyer, source, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 'SHOPIFY_WEBHOOK', ?, ?)
     ON CONFLICT(email_hash) DO UPDATE SET
       email = excluded.email,
       shopify_customer_id = COALESCE(excluded.shopify_customer_id, customers.shopify_customer_id),
       first_name = COALESCE(excluded.first_name, customers.first_name),
       consent_state = excluded.consent_state,
       first_order_at = COALESCE(customers.first_order_at, excluded.first_order_at),
       last_order_at = CASE
         WHEN customers.last_order_at IS NULL OR excluded.last_order_at > customers.last_order_at
         THEN excluded.last_order_at ELSE customers.last_order_at END,
       order_count = customers.order_count + 1,
       lifetime_value = customers.lifetime_value + excluded.lifetime_value,
       lifetime_currency = COALESCE(excluded.lifetime_currency, customers.lifetime_currency),
       products_json = excluded.products_json,
       novahair_buyer = excluded.novahair_buyer,
       updated_at = excluded.updated_at`,
  ).bind(
    input.emailHash,
    input.email,
    input.shopifyCustomerId,
    input.firstName,
    input.consentState,
    input.completedAt,
    input.completedAt,
    input.total ?? 0,
    input.currency,
    JSON.stringify(handles),
    nova,
    current,
    current,
  ).run();
}

// ---------------------------------------------------------------------------
// Resend webhook path: engagement counters. Only rows that already exist are
// touched; an email event never creates a customer.
// ---------------------------------------------------------------------------
export async function touchCustomerOnEmailEvent(
  env: LifecycleEnv,
  recipientHash: string,
  eventType: string,
  occurredAt: string,
  now: Date,
): Promise<void> {
  const current = isoNow(now);
  const kind = eventType.replace(/^email\./, "");
  if (kind === "sent") {
    await env.DB.prepare(
      `UPDATE customers SET emails_sent = emails_sent + 1,
         last_email_at = CASE WHEN last_email_at IS NULL OR ? > last_email_at THEN ? ELSE last_email_at END,
         updated_at = ? WHERE email_hash = ?`,
    ).bind(occurredAt, occurredAt, current, recipientHash).run();
  } else if (kind === "opened") {
    await env.DB.prepare(
      `UPDATE customers SET emails_opened = emails_opened + 1,
         last_open_at = CASE WHEN last_open_at IS NULL OR ? > last_open_at THEN ? ELSE last_open_at END,
         updated_at = ? WHERE email_hash = ?`,
    ).bind(occurredAt, occurredAt, current, recipientHash).run();
  } else if (kind === "clicked") {
    await env.DB.prepare(
      `UPDATE customers SET emails_clicked = emails_clicked + 1,
         last_click_at = CASE WHEN last_click_at IS NULL OR ? > last_click_at THEN ? ELSE last_click_at END,
         updated_at = ? WHERE email_hash = ?`,
    ).bind(occurredAt, occurredAt, current, recipientHash).run();
  }
}

// ---------------------------------------------------------------------------
// Consent sync path: keep the cached consent in step with the live one.
// ---------------------------------------------------------------------------
export async function touchCustomerConsent(
  env: LifecycleEnv,
  emailHash: string,
  consentState: ConsentState,
  consentUpdatedAt: string | null,
  now: Date,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE customers SET consent_state = ?, consent_updated_at = COALESCE(?, consent_updated_at), updated_at = ?
     WHERE email_hash = ?`,
  ).bind(consentState, consentUpdatedAt, isoNow(now), emailHash).run();
}

// ---------------------------------------------------------------------------
// Periodic score refresh. Pulls every row, recomputes in JS so the formula
// lives in exactly one place, writes back in batches.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// One-time seed of email engagement from automation_tracking.
//
// The live counters are fed by Resend webhooks, which only started landing on
// customer rows when this table was created. Everything sent before that is
// recorded in automation_tracking, so without this the engagement score would
// read every past opener and clicker as cold.
//
// automation_tracking has no opened_at column: its status is a progression
// (SENT -> DELIVERED -> OPENED -> CLICKED), so the row's updated_at is used as
// the open time, which is when the open moved it to that status.
// ---------------------------------------------------------------------------
export async function backfillEmailEngagement(
  env: LifecycleEnv,
  now: Date,
): Promise<{ people: number; updated: boolean }> {
  if ((await healthValue(env.DB, "customers_engagement_backfill_done")) === "true") {
    return { people: 0, updated: false };
  }
  const current = isoNow(now);
  try {
    const rows = await env.DB.prepare(
      `SELECT recipient_hash AS hash,
              SUM(CASE WHEN status IN ('SENT', 'DELIVERED', 'OPENED', 'CLICKED') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status IN ('OPENED', 'CLICKED') THEN 1 ELSE 0 END) AS opened,
              SUM(CASE WHEN status = 'CLICKED' THEN 1 ELSE 0 END) AS clicked,
              -- A scheduled row can carry a due time in sent_at, so the last
              -- send must come only from rows that actually went out.
              MAX(CASE WHEN status IN ('SENT', 'DELIVERED', 'OPENED', 'CLICKED') THEN sent_at END) AS last_sent,
              MAX(CASE WHEN status IN ('OPENED', 'CLICKED') THEN updated_at END) AS last_open,
              MAX(clicked_at) AS last_click
       FROM automation_tracking
       WHERE recipient_hash IS NOT NULL
       GROUP BY recipient_hash`,
    ).all<{
      hash: string;
      sent: number;
      opened: number;
      clicked: number;
      last_sent: string | null;
      last_open: string | null;
      last_click: string | null;
    }>();

    let people = 0;
    for (const row of rows.results ?? []) {
      // max() never lowers a counter the webhook has already moved past.
      const result = await env.DB.prepare(
        `UPDATE customers SET
           emails_sent = max(emails_sent, ?),
           emails_opened = max(emails_opened, ?),
           emails_clicked = max(emails_clicked, ?),
           last_email_at = CASE WHEN ? IS NOT NULL AND (last_email_at IS NULL OR ? > last_email_at) THEN ? ELSE last_email_at END,
           last_open_at = CASE WHEN ? IS NOT NULL AND (last_open_at IS NULL OR ? > last_open_at) THEN ? ELSE last_open_at END,
           last_click_at = CASE WHEN ? IS NOT NULL AND (last_click_at IS NULL OR ? > last_click_at) THEN ? ELSE last_click_at END,
           updated_at = ?
         WHERE email_hash = ?`,
      ).bind(
        Number(row.sent ?? 0),
        Number(row.opened ?? 0),
        Number(row.clicked ?? 0),
        row.last_sent, row.last_sent, row.last_sent,
        row.last_open, row.last_open, row.last_open,
        row.last_click, row.last_click, row.last_click,
        current,
        row.hash,
      ).run();
      if (result.meta?.changes) people += 1;
    }

    await setHealth(env.DB, "customers_engagement_backfill_done", "true", "OK", current);
    await setHealth(
      env.DB,
      "customers_engagement_backfill_status",
      JSON.stringify({ candidates: rows.results?.length ?? 0, people }),
      "OK",
      current,
    );
    // Scores computed before the seed are stale, so force one recompute.
    await env.DB.prepare("DELETE FROM health_state WHERE key = 'last_customer_score_refresh'").run();
    return { people, updated: true };
  } catch (error) {
    await recordLifecycleError(env.DB, {
      component: "customers_engagement_backfill",
      code: error instanceof Error ? error.message.slice(0, 100) : "engagement_backfill_failed",
      safeMessage: "Seeding email engagement from automation tracking failed; it will retry.",
      retryable: true,
      now: current,
    });
    return { people: 0, updated: false };
  }
}

export async function recomputeEngagementScores(env: LifecycleEnv, now: Date): Promise<number> {
  const current = isoNow(now);
  const rows = await env.DB.prepare(
    `SELECT email_hash, last_order_at, order_count, last_open_at, last_click_at, engagement_score FROM customers`,
  ).all<{
    email_hash: string;
    last_order_at: string | null;
    order_count: number;
    last_open_at: string | null;
    last_click_at: string | null;
    engagement_score: number;
  }>();

  const statements: ReturnType<D1Database["prepare"]>[] = [];
  let changed = 0;
  for (const row of rows.results ?? []) {
    const next = engagementScore({
      lastOrderAt: row.last_order_at,
      orderCount: Number(row.order_count ?? 0),
      lastOpenAt: row.last_open_at,
      lastClickAt: row.last_click_at,
    }, now);
    if (next === Number(row.engagement_score)) continue;
    changed += 1;
    statements.push(env.DB.prepare(
      "UPDATE customers SET engagement_score = ?, score_computed_at = ?, updated_at = ? WHERE email_hash = ?",
    ).bind(next, current, current, row.email_hash));
    if (statements.length === 100) { await env.DB.batch(statements.splice(0)); }
  }
  if (statements.length) await env.DB.batch(statements);
  await setHealth(env.DB, "last_customer_score_refresh", current, "OK", current);
  await setHealth(env.DB, "customer_score_refresh_status", JSON.stringify({ rows: rows.results?.length ?? 0, changed }), "OK", current);
  return changed;
}

// ---------------------------------------------------------------------------
// One-time full backfill from Shopify, resumable across cron ticks. Walks the
// customers connection with no date filter, storing the cursor between ticks.
// Once hasNextPage is false it marks itself done and becomes a no-op; the
// incremental consent sync carries changes from then on.
// ---------------------------------------------------------------------------
interface CustomerPage {
  customers: {
    nodes: ShopifyCustomerNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const CUSTOMERS_BACKFILL_QUERY = `query NovaHairCustomerBackfill($first: Int!, $after: String) {
  customers(first: $first, after: $after, sortKey: ID) {
    nodes {
      id
      firstName
      createdAt
      updatedAt
      numberOfOrders
      amountSpent { amount currencyCode }
      lastOrder { createdAt }
      defaultEmailAddress {
        emailAddress
        marketingState
        marketingOptInLevel
        marketingUpdatedAt
        validFormat
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function syncCustomerBackfill(
  env: LifecycleEnv,
  now: Date,
  graphql: <T>(env: LifecycleEnv, query: string, variables: Record<string, unknown>) => Promise<T>,
): Promise<{ pages: number; upserted: number; done: boolean }> {
  const config = lifecycleConfig(env);
  const current = isoNow(now);
  if ((await healthValue(env.DB, "customers_backfill_done")) === "true") {
    return { pages: 0, upserted: 0, done: true };
  }
  let after = await healthValue(env.DB, "customers_backfill_cursor");
  let pages = 0;
  let upserted = 0;
  let done = false;
  try {
    for (let page = 0; page < config.maxPages; page += 1) {
      const data = await graphql<CustomerPage>(env, CUSTOMERS_BACKFILL_QUERY, { first: 100, after });
      pages += 1;
      for (const node of data.customers.nodes) {
        if (await upsertCustomerFromShopify(env, node, now, "SHOPIFY_BACKFILL")) upserted += 1;
      }
      after = data.customers.pageInfo.endCursor;
      if (!data.customers.pageInfo.hasNextPage) { done = true; break; }
    }
    if (done) {
      await setHealth(env.DB, "customers_backfill_done", "true", "OK", current);
    } else if (after) {
      await setHealth(env.DB, "customers_backfill_cursor", after, "RUNNING", current);
    }
    await setHealth(env.DB, "customers_backfill_status", JSON.stringify({ pages, upserted, done }), "OK", current);
  } catch (error) {
    const code = error instanceof Error ? error.message : "customers_backfill_failed";
    await recordLifecycleError(env.DB, {
      component: "customers_backfill",
      code,
      safeMessage: "Customer backfill from Shopify stopped; it will resume on the next tick.",
      retryable: true,
      now: current,
    });
  }
  return { pages, upserted, done };
}

// ---------------------------------------------------------------------------
// Products bought, aggregated from the orders connection by customer id. Also
// resumable. Only needs customer.id and product handles, neither of which is
// PII, so it works with the plain Admin token.
// ---------------------------------------------------------------------------
interface OrderProductsPage {
  orders: {
    nodes: Array<{
      id: string;
      customer: { id: string } | null;
      lineItems: { nodes: Array<{ product: { handle: string } | null }> };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

const ORDER_PRODUCTS_QUERY = `query NovaHairOrderProducts($first: Int!, $after: String) {
  orders(first: $first, after: $after, sortKey: ID) {
    nodes {
      id
      customer { id }
      lineItems(first: 25) { nodes { product { handle } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function syncCustomerProducts(
  env: LifecycleEnv,
  now: Date,
  graphql: <T>(env: LifecycleEnv, query: string, variables: Record<string, unknown>) => Promise<T>,
): Promise<{ pages: number; customersTouched: number; done: boolean }> {
  const config = lifecycleConfig(env);
  const current = isoNow(now);
  if ((await healthValue(env.DB, "customers_products_done")) === "true") {
    return { pages: 0, customersTouched: 0, done: true };
  }
  // Orders are joined to customers by Shopify id, and an order whose customer
  // row does not exist yet is skipped for good once the cursor moves past it.
  // So this must not start until every customer row is in place.
  if ((await healthValue(env.DB, "customers_backfill_done")) !== "true") {
    await setHealth(env.DB, "customers_products_status", JSON.stringify({ pages: 0, customersTouched: 0, done: false, waitingFor: "customers_backfill" }), "OK", current);
    return { pages: 0, customersTouched: 0, done: false };
  }
  let after = await healthValue(env.DB, "customers_products_cursor");
  let pages = 0;
  let done = false;
  const handlesByCustomer = new Map<string, Set<string>>();
  try {
    for (let page = 0; page < config.maxPages; page += 1) {
      const data = await graphql<OrderProductsPage>(env, ORDER_PRODUCTS_QUERY, { first: 100, after });
      pages += 1;
      for (const order of data.orders.nodes) {
        const cid = order.customer?.id;
        if (!cid) continue;
        const set = handlesByCustomer.get(cid) ?? new Set<string>();
        for (const li of order.lineItems.nodes) {
          const h = li.product?.handle?.trim().toLowerCase();
          if (h) set.add(h);
        }
        handlesByCustomer.set(cid, set);
      }
      after = data.orders.pageInfo.endCursor;
      if (!data.orders.pageInfo.hasNextPage) { done = true; break; }
    }

    let customersTouched = 0;
    for (const [cid, set] of handlesByCustomer) {
      const existing = await env.DB.prepare(
        "SELECT email_hash, products_json FROM customers WHERE shopify_customer_id = ?",
      ).bind(cid).first<{ email_hash: string; products_json: string }>();
      if (!existing) continue;
      const merged = mergeHandles(existing.products_json, [...set]);
      await env.DB.prepare(
        "UPDATE customers SET products_json = ?, novahair_buyer = ?, updated_at = ? WHERE email_hash = ?",
      ).bind(JSON.stringify(merged), isNovaHairBuyer(merged), current, existing.email_hash).run();
      customersTouched += 1;
    }

    if (done) {
      await setHealth(env.DB, "customers_products_done", "true", "OK", current);
    } else if (after) {
      await setHealth(env.DB, "customers_products_cursor", after, "RUNNING", current);
    }
    await setHealth(env.DB, "customers_products_status", JSON.stringify({ pages, customersTouched, done }), "OK", current);
    return { pages, customersTouched, done };
  } catch (error) {
    const code = error instanceof Error ? error.message : "customers_products_failed";
    await recordLifecycleError(env.DB, {
      component: "customers_products",
      code,
      safeMessage: "Customer product history sync stopped; it will resume on the next tick.",
      retryable: true,
      now: current,
    });
    return { pages, customersTouched: 0, done: false };
  }
}

// ---------------------------------------------------------------------------
// Admin read model. Never returns the raw email.
// ---------------------------------------------------------------------------
function maskEmail(email: string): string {
  const [local = "", domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function customerDirectory(env: LifecycleEnv, url: URL): Promise<unknown> {
  const consent = url.searchParams.get("consent");
  const minScore = Number(url.searchParams.get("min_score") ?? "");
  const novahair = url.searchParams.get("novahair");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? "100") || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (consent) { where.push("consent_state = ?"); binds.push(consent.toUpperCase()); }
  if (Number.isFinite(minScore) && url.searchParams.has("min_score")) { where.push("engagement_score >= ?"); binds.push(minScore); }
  if (novahair === "1") where.push("novahair_buyer = 1");
  if (novahair === "0") where.push("novahair_buyer = 0");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [total, rows, byConsent, backfill, products, scoreRefresh] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM customers ${whereSql}`).bind(...binds).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT email, email_hash, first_name, consent_state, order_count, lifetime_value, lifetime_currency,
              first_order_at, last_order_at, products_json, novahair_buyer,
              emails_sent, emails_opened, emails_clicked, last_open_at, last_click_at, engagement_score
       FROM customers ${whereSql}
       ORDER BY engagement_score DESC, last_order_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(...binds, limit, offset).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT consent_state, COUNT(*) AS n FROM customers GROUP BY consent_state").all<{ consent_state: string; n: number }>(),
    healthValue(env.DB, "customers_backfill_status"),
    healthValue(env.DB, "customers_products_status"),
    healthValue(env.DB, "last_customer_score_refresh"),
  ]);

  const marketingReachable = (byConsent.results ?? [])
    .filter(r => r.consent_state !== "UNSUBSCRIBED" && r.consent_state !== "REDACTED")
    .reduce((s, r) => s + Number(r.n), 0);

  return {
    total: Number(total?.n ?? 0),
    limit,
    offset,
    summary: {
      byConsent: Object.fromEntries((byConsent.results ?? []).map(r => [r.consent_state, Number(r.n)])),
      marketingReachable,
      backfill: backfill ? JSON.parse(backfill) : null,
      products: products ? JSON.parse(products) : null,
      lastScoreRefresh: scoreRefresh,
    },
    rows: (rows.results ?? []).map(r => ({
      emailMasked: maskEmail(String(r.email)),
      emailHash: r.email_hash,
      firstName: r.first_name,
      consent: r.consent_state,
      orders: Number(r.order_count),
      ltv: Number(r.lifetime_value),
      currency: r.lifetime_currency,
      firstOrderAt: r.first_order_at,
      lastOrderAt: r.last_order_at,
      products: JSON.parse(String(r.products_json ?? "[]")),
      novahair: Number(r.novahair_buyer) === 1,
      emails: { sent: Number(r.emails_sent), opened: Number(r.emails_opened), clicked: Number(r.emails_clicked) },
      lastOpenAt: r.last_open_at,
      lastClickAt: r.last_click_at,
      score: Number(r.engagement_score),
    })),
  };
}

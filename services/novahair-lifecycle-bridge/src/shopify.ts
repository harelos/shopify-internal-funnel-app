import { lifecycleConfig, lifecycleMode } from "./config";
import {
  healthValue,
  isoNow,
  recordLifecycleError,
  scheduleLifecycleEvent,
  setHealth,
} from "./db";
import { FLOW_SPECS, dueAt } from "./flow-specs";
import { encryptSensitive, hashEmail, hashPayload, hmacSha256Hex } from "./crypto";
import { queueResendUnsubscribe } from "./resend";
import { processFulfillmentObservation, processPaidOrder } from "./webhooks";
import type {
  AbandonedCheckoutRow,
  ConsentState,
  LifecycleEnv,
  ShopifyAbandonedCheckout,
  ShopifyCustomerNode,
  ShopifyOrderNode,
  ShopifyOrderWebhook,
} from "./types";

const ABANDONED_CHECKOUT_QUERY = `query NovaHairAbandonedCheckouts(
  $first: Int!
  $after: String
  $query: String
) {
  abandonedCheckouts(
    first: $first
    after: $after
    query: $query
    sortKey: CREATED_AT
    reverse: false
  ) {
    nodes {
      id
      createdAt
      updatedAt
      completedAt
      abandonedCheckoutUrl
      customer {
        id
        firstName
        defaultEmailAddress {
          emailAddress
          marketingState
          marketingOptInLevel
          marketingUpdatedAt
          validFormat
        }
      }
      lineItems(first: 20) {
        nodes {
          id
          title
          variantTitle
          sku
          quantity
          image { url altText }
        }
        pageInfo { hasNextPage endCursor }
      }
      totalPriceSet {
        presentmentMoney { amount currencyCode }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PAID_ORDERS_QUERY = `query NovaHairPaidOrders(
  $first: Int!
  $after: String
  $query: String
) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: false) {
    nodes {
      id
      createdAt
      updatedAt
      processedAt
      checkoutToken
      displayFinancialStatus
      test
      email
      customer {
        id
        firstName
        defaultEmailAddress {
          emailAddress
          marketingState
          marketingOptInLevel
          marketingUpdatedAt
          validFormat
        }
      }
      lineItems(first: 20) {
        nodes { id title variantTitle sku quantity image { url altText } product { id handle } }
        pageInfo { hasNextPage endCursor }
      }
      shippingAddress {
        countryCode
        countryCodeV2
        country
      }
      fulfillments(first: 20) {
        id
        displayStatus
        inTransitAt
        deliveredAt
        estimatedDeliveryAt
        trackingInfo(first: 10) { company number url }
        events(first: 50) {
          nodes { id status happenedAt }
          pageInfo { hasNextPage endCursor }
        }
      }
      currentTotalPriceSet { presentmentMoney { amount currencyCode } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CUSTOMERS_QUERY = `query NovaHairCustomerConsent(
  $first: Int!
  $after: String
  $query: String
) {
  customers(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: false) {
    nodes {
      id
      firstName
      updatedAt
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

const WEBHOOK_SUBSCRIPTIONS_QUERY = `query NovaHairWebhookSubscriptions {
  webhookSubscriptions(first: 250) {
    nodes { id topic uri }
  }
}`;

const CREATE_WEBHOOK_SUBSCRIPTION_MUTATION = `mutation NovaHairCreateWebhook(
  $topic: WebhookSubscriptionTopic!
  $uri: String!
) {
  webhookSubscriptionCreate(
    topic: $topic
    webhookSubscription: { uri: $uri, format: JSON }
  ) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message?: string; extensions?: { code?: string } }>;
}

interface AbandonedPage {
  abandonedCheckouts: {
    nodes: ShopifyAbandonedCheckout[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface OrderPage {
  orders: {
    nodes: ShopifyOrderNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface CustomerPage {
  customers: {
    nodes: ShopifyCustomerNode[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface ShopifyWebhookSubscription {
  id: string;
  topic: string;
  uri: string;
}

interface ShopifyWebhookSubscriptionsResult {
  webhookSubscriptions: { nodes: ShopifyWebhookSubscription[] };
}

interface ShopifyWebhookCreateResult {
  webhookSubscriptionCreate: {
    webhookSubscription: ShopifyWebhookSubscription | null;
    userErrors: Array<{ field?: string[]; message: string }>;
  };
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function shopifyGraphql<T>(
  env: LifecycleEnv,
  query: string,
  variables: Record<string, unknown>,
  dependencies: { fetcher?: typeof fetch; sleeper?: (milliseconds: number) => Promise<void> } = {},
): Promise<T> {
  const config = lifecycleConfig(env);
  if (!config.shopDomain || !config.shopifyAccessToken) throw new Error("shopify_credentials_unavailable");
  const endpoint = `https://${config.shopDomain}/admin/api/${config.shopifyApiVersion}/graphql.json`;
  let lastCode = "shopify_request_failed";
  const fetcher = dependencies.fetcher ?? fetch;
  const sleeper = dependencies.sleeper ?? wait;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": config.shopifyAccessToken,
          "User-Agent": "novahair-lifecycle-worker/1.0",
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      lastCode = "shopify_network_error";
      if (attempt === 4) break;
      await sleeper(300 * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      lastCode = `shopify_http_${response.status}`;
      if (!retryableStatus(response.status) || attempt === 4) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleeper(Number.isFinite(retryAfter) ? retryAfter * 1000 : 300 * 2 ** attempt);
      continue;
    }

    const envelope = await response.json() as GraphqlEnvelope<T>;
    if (envelope.errors?.length || !envelope.data) {
      const code = envelope.errors?.[0]?.extensions?.code;
      throw new Error(code ? `shopify_graphql_${code.toLowerCase()}` : "shopify_graphql_error");
    }
    return envelope.data;
  }
  throw new Error(lastCode);
}

export async function ensureLifecycleWebhooks(env: LifecycleEnv): Promise<{
  endpoint: string;
  created: number;
  subscriptions: ShopifyWebhookSubscription[];
}> {
  const config = lifecycleConfig(env);
  const endpoint = `${config.appUrl}/api/lifecycle/webhooks/shopify`;
  if (!config.appUrl.startsWith("https://")) throw new Error("shopify_webhook_https_required");
  const requiredTopics = [
    "ORDERS_CREATE",
    "ORDERS_PAID",
    "FULFILLMENT_EVENTS_CREATE",
    "FULFILLMENTS_CREATE",
    "FULFILLMENTS_UPDATE",
  ];
  const existing = await shopifyGraphql<ShopifyWebhookSubscriptionsResult>(
    env,
    WEBHOOK_SUBSCRIPTIONS_QUERY,
    {},
  );
  const subscriptions = existing.webhookSubscriptions.nodes.filter(
    item => requiredTopics.includes(item.topic) && item.uri === endpoint,
  );
  let created = 0;
  for (const topic of requiredTopics) {
    if (subscriptions.some(item => item.topic === topic)) continue;
    const result = await shopifyGraphql<ShopifyWebhookCreateResult>(
      env,
      CREATE_WEBHOOK_SUBSCRIPTION_MUTATION,
      { topic, uri: endpoint },
    );
    const payload = result.webhookSubscriptionCreate;
    if (payload.userErrors.length || !payload.webhookSubscription) {
      throw new Error("shopify_webhook_create_failed");
    }
    subscriptions.push(payload.webhookSubscription);
    created += 1;
  }
  await setHealth(
    env.DB,
    "shopify_webhooks_status",
    JSON.stringify({ endpoint, topics: subscriptions.map(item => item.topic).sort() }),
    subscriptions.length === requiredTopics.length ? "OK" : "ERROR",
  );
  await setHealth(env.DB, "last_shopify_webhooks_ensure", isoNow(), "OK");
  return { endpoint, created, subscriptions };
}

function normalizedEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function recoveryCheckoutToken(value: string): string | null {
  try {
    const pathname = new URL(value).pathname.split("/").filter(Boolean);
    const index = pathname.findIndex(segment => segment.toLowerCase() === "checkouts");
    const token = index >= 0 ? pathname[index + 1] : null;
    return token && token.length <= 512 ? decodeURIComponent(token) : null;
  } catch {
    return null;
  }
}

function deriveMerchandise(checkout: ShopifyAbandonedCheckout) {
  const first = checkout.lineItems.nodes[0];
  const combined = [first?.variantTitle, first?.sku, first?.title].filter(Boolean).join(" ");
  const shadeMatch = combined.match(/(?:shade|גוון)[:\s-]*([^,|/]+)/i);
  const bundleMatch = combined.match(/(?:bundle|pack|חבילה)[:\s-]*(\d+|[^,|/]+)/i);
  return {
    productName: first?.title ?? null,
    productImage: first?.image?.url ?? null,
    variant: first?.variantTitle ?? null,
    shade: shadeMatch?.[1]?.trim() ?? null,
    bundle: bundleMatch?.[1]?.trim() ?? first?.variantTitle ?? null,
    quantity: checkout.lineItems.nodes.reduce((sum, item) => sum + Math.max(0, item.quantity), 0),
  };
}

async function locallySuppressed(env: LifecycleEnv, emailHash: string | null): Promise<boolean> {
  if (!emailHash) return false;
  const row = await env.DB.prepare(
    "SELECT active FROM suppressions WHERE email_hash = ? AND active = 1",
  ).bind(emailHash).first<{ active: number }>();
  return row?.active === 1;
}

function activationEligible(env: LifecycleEnv, email: string | null, createdAt: string): boolean {
  const config = lifecycleConfig(env);
  const mode = lifecycleMode(env);
  if (!config.enabled || mode === "disabled") return false;
  const activation = new Date(config.activatedAt).getTime();
  const occurred = new Date(createdAt).getTime();
  if (!Number.isFinite(activation) || !Number.isFinite(occurred) || occurred < activation) return false;
  if (mode === "test") return Boolean(email) && email === config.testEmail;
  return mode === "production"
    && occurred >= activation;
}

export async function upsertCheckout(env: LifecycleEnv, checkout: ShopifyAbandonedCheckout, now: Date): Promise<{
  state: AbandonedCheckoutRow["state"];
  transitionedToRecovered: boolean;
}> {
  const config = lifecycleConfig(env);
  const current = isoNow(now);
  const emailAddress = checkout.customer?.defaultEmailAddress;
  const email = emailAddress?.validFormat === false ? null : normalizedEmail(emailAddress?.emailAddress);
  const emailHash = email ? await hashEmail(email, config.hashKey) : null;
  const checkoutToken = recoveryCheckoutToken(checkout.abandonedCheckoutUrl);
  const checkoutTokenHash = checkoutToken ? await hmacSha256Hex(config.hashKey, checkoutToken) : null;
  const consentState: ConsentState = emailAddress?.marketingState ?? "UNKNOWN";
  const existing = await env.DB.prepare(
    "SELECT state, completed_at FROM abandoned_checkouts WHERE shopify_checkout_id = ?",
  ).bind(checkout.id).first<{ state: AbandonedCheckoutRow["state"]; completed_at: string | null }>();
  const laterPurchase = emailHash
    ? await env.DB.prepare(
      `SELECT shopify_order_id FROM lifecycle_orders
       WHERE email_hash = ? AND completed_at >= ?
       ORDER BY completed_at ASC LIMIT 1`,
    ).bind(emailHash, checkout.createdAt).first<{ shopify_order_id: string }>()
    : null;
  const completed = Boolean(checkout.completedAt);
  const transitionedToRecovered = completed && !existing?.completed_at;
  const purchased = existing?.state === "PURCHASED" || Boolean(laterPurchase);
  const inactive = existing && ["SUPPRESSED", "EXHAUSTED"].includes(existing.state);
  const suppressed = await locallySuppressed(env, emailHash);
  const eligible = Boolean(email)
    && consentState === "SUBSCRIBED"
    && activationEligible(env, email, checkout.createdAt)
    && !suppressed;
  const state: AbandonedCheckoutRow["state"] = purchased
    ? "PURCHASED"
    : completed
      ? "RECOVERED"
      : inactive
        ? existing.state
        : suppressed
          ? "SUPPRESSED"
          : eligible
            ? "ABANDONED"
            : config.enabled && lifecycleMode(env) !== "disabled"
              ? "INELIGIBLE"
              : "PENDING";
  const merchandise = deriveMerchandise(checkout);
  const total = Number(checkout.totalPriceSet.presentmentMoney.amount);
  const safeTotal = Number.isFinite(total) ? total : null;
  const payloadHash = await hashPayload({
    id: checkout.id,
    createdAt: checkout.createdAt,
    updatedAt: checkout.updatedAt,
    completedAt: checkout.completedAt,
    emailHash,
    checkoutTokenHash,
    consentState,
    lineItems: checkout.lineItems.nodes,
    total: safeTotal,
    currency: checkout.totalPriceSet.presentmentMoney.currencyCode,
  });
  const encryptedUrl = await encryptSensitive(checkout.abandonedCheckoutUrl, config.dataKey);
  const firstDue = dueAt(checkout.createdAt, FLOW_SPECS.abandoned_checkout.emails[0]?.offsetMinutes ?? 60);

  await env.DB.prepare(
    `INSERT INTO abandoned_checkouts (
       shopify_checkout_id, shop_domain, customer_id, email, email_hash, first_name,
       checkout_url, checkout_token_hash, created_at, updated_at, completed_at, first_seen_at, last_seen_at,
       consent_state, state, next_email_number, next_due_at, payload_hash,
       product_name, product_image, variant, shade, bundle, quantity, total, currency,
       created_record_at, updated_record_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shopify_checkout_id) DO UPDATE SET
       customer_id = excluded.customer_id,
       email = excluded.email,
       email_hash = excluded.email_hash,
       first_name = excluded.first_name,
       checkout_url = excluded.checkout_url,
       checkout_token_hash = COALESCE(excluded.checkout_token_hash, abandoned_checkouts.checkout_token_hash),
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at,
       last_seen_at = excluded.last_seen_at,
       consent_state = excluded.consent_state,
       state = CASE
         WHEN abandoned_checkouts.state = 'PURCHASED' THEN 'PURCHASED'
         WHEN excluded.completed_at IS NOT NULL THEN 'RECOVERED'
         WHEN abandoned_checkouts.state IN ('SUPPRESSED', 'EXHAUSTED') THEN abandoned_checkouts.state
         ELSE excluded.state
       END,
       payload_hash = excluded.payload_hash,
       product_name = excluded.product_name,
       product_image = excluded.product_image,
       variant = excluded.variant,
       shade = excluded.shade,
       bundle = excluded.bundle,
       quantity = excluded.quantity,
       total = excluded.total,
       currency = excluded.currency,
       updated_record_at = excluded.updated_record_at`,
  ).bind(
    checkout.id,
    config.shopDomain,
    checkout.customer?.id ?? null,
    email,
    emailHash,
    checkout.customer?.firstName ?? null,
    encryptedUrl,
    checkoutTokenHash,
    checkout.createdAt,
    checkout.updatedAt,
    checkout.completedAt,
    current,
    current,
    consentState,
    state,
    firstDue,
    payloadHash,
    merchandise.productName,
    merchandise.productImage,
    merchandise.variant,
    merchandise.shade,
    merchandise.bundle,
    merchandise.quantity,
    safeTotal,
    checkout.totalPriceSet.presentmentMoney.currencyCode,
    current,
    current,
  ).run();

  if (state === "ABANDONED" && existing?.state !== "ABANDONED") {
    for (const emailSpec of FLOW_SPECS.abandoned_checkout.emails) {
      await scheduleLifecycleEvent(env.DB, {
        idempotencyKey: `checkout:${checkout.id}:email:${emailSpec.number}`,
        eventName: "shopify.checkout_abandoned",
        flow: "abandoned_checkout",
        emailNumber: emailSpec.number,
        entityType: "checkout",
        entityId: checkout.id,
        dueAt: dueAt(checkout.createdAt, emailSpec.offsetMinutes),
        now: current,
      });
    }
  }

  // Reaching checkout advances the lifecycle regardless of whether this
  // particular checkout is eligible for marketing. These idempotent stop
  // events prevent an already-running browse/cart sequence from continuing.
  if (email && activationEligible(env, email, checkout.createdAt)) {
    for (const stop of [
      { eventName: "lifecycle.browse_stop", flow: "browse_abandonment" },
      { eventName: "lifecycle.cart_stop", flow: "abandoned_cart" },
    ] as const) {
      await scheduleLifecycleEvent(env.DB, {
        idempotencyKey: `checkout:${checkout.id}:${stop.eventName}`,
        eventName: stop.eventName,
        flow: stop.flow,
        emailNumber: 0,
        entityType: "checkout",
        entityId: checkout.id,
        dueAt: current,
        now: current,
      });
    }
  }

  if (completed && !purchased) {
    await env.DB.prepare(
      `UPDATE scheduled_lifecycle_events
       SET status = 'CANCELLED', lease_until = NULL,
           last_error_code = 'checkout_recovered', updated_at = ?
       WHERE entity_type = 'checkout' AND entity_id = ?
         AND event_name = 'shopify.checkout_abandoned'
         AND status IN ('PENDING', 'RETRY', 'LEASED')`,
    ).bind(current, checkout.id).run();
    if (transitionedToRecovered && email) {
      await scheduleLifecycleEvent(env.DB, {
        idempotencyKey: `checkout:${checkout.id}:recovered:${checkout.completedAt}`,
        eventName: "shopify.checkout_recovered",
        flow: "abandoned_checkout",
        emailNumber: 0,
        entityType: "checkout",
        entityId: checkout.id,
        dueAt: current,
        now: current,
      });
    }
  }
  return { state, transitionedToRecovered };
}

export interface ShopifySyncResult {
  ok: boolean;
  fetched: number;
  tracked: number;
  recovered: number;
  pages: number;
  since: string;
}

export async function syncAbandonedCheckouts(
  env: LifecycleEnv,
  now = new Date(),
  dependencies: { fetcher?: typeof fetch; sleeper?: (milliseconds: number) => Promise<void> } = {},
): Promise<ShopifySyncResult> {
  const config = lifecycleConfig(env);
  const lastSuccess = await healthValue(env.DB, "last_shopify_sync");
  const fallback = new Date(now.getTime() - 30 * 86_400_000);
  const previous = lastSuccess ? new Date(lastSuccess) : fallback;
  const safePrevious = Number.isFinite(previous.getTime()) ? previous : fallback;
  const since = new Date(safePrevious.getTime() - config.syncOverlapMinutes * 60_000).toISOString();
  const filter = `updated_at:>='${since}'`;
  let after: string | null = null;
  let fetched = 0;
  let tracked = 0;
  let recovered = 0;
  let pages = 0;
  await setHealth(env.DB, "last_shopify_api_attempt", isoNow(now), "RUNNING");

  try {
    for (let page = 0; page < config.maxPages; page += 1) {
      const data: AbandonedPage = await shopifyGraphql<AbandonedPage>(
        env,
        ABANDONED_CHECKOUT_QUERY,
        { first: 50, after, query: filter },
        dependencies,
      );
      pages += 1;
      const connection: AbandonedPage["abandonedCheckouts"] = data.abandonedCheckouts;
      for (const checkout of connection.nodes) {
        fetched += 1;
        const outcome = await upsertCheckout(env, checkout, now);
        if (outcome.state !== "PENDING") tracked += 1;
        if (outcome.transitionedToRecovered) recovered += 1;
      }
      after = connection.pageInfo.endCursor;
      if (!connection.pageInfo.hasNextPage || !after) break;
      if (page === config.maxPages - 1) throw new Error("shopify_pagination_limit_reached");
    }
    const current = isoNow(now);
    await Promise.all([
      setHealth(env.DB, "last_shopify_sync", current),
      setHealth(env.DB, "last_successful_shopify_api_call", current),
      setHealth(env.DB, "shopify_sync_status", JSON.stringify({ fetched, tracked, recovered, pages }), "OK", current),
    ]);
    return { ok: true, fetched, tracked, recovered, pages, since };
  } catch (error) {
    const code = error instanceof Error ? error.message : "shopify_sync_failed";
    const current = isoNow(now);
    await Promise.all([
      setHealth(env.DB, "shopify_sync_status", code, "ERROR", current),
      recordLifecycleError(env.DB, {
        component: "shopify_sync",
        code,
        safeMessage: "Shopify abandoned checkout synchronization failed.",
        retryable: true,
        now: current,
      }),
    ]);
    throw error;
  }
}

function syncWindowStart(
  lastSuccess: string | null,
  activatedAt: string,
  now: Date,
  overlapMinutes: number,
): string {
  const activation = new Date(activatedAt).getTime();
  const fallback = Number.isFinite(activation) ? activation : now.getTime();
  const previousValue = lastSuccess ? new Date(lastSuccess).getTime() : fallback;
  const previous = Number.isFinite(previousValue) ? previousValue : fallback;
  return new Date(Math.max(fallback, previous - overlapMinutes * 60_000)).toISOString();
}

function orderPayload(node: ShopifyOrderNode): ShopifyOrderWebhook {
  const emailAddress = node.customer?.defaultEmailAddress;
  return {
    admin_graphql_api_id: node.id,
    checkout_token: node.checkoutToken,
    email: node.email ?? emailAddress?.emailAddress ?? null,
    customer: node.customer ? {
      admin_graphql_api_id: node.customer.id,
      first_name: node.customer.firstName,
      email: emailAddress?.emailAddress ?? node.email,
    } : null,
    created_at: node.createdAt,
    processed_at: node.processedAt ?? node.createdAt,
    presentment_currency: node.currentTotalPriceSet.presentmentMoney.currencyCode,
    current_total_price: node.currentTotalPriceSet.presentmentMoney.amount,
    financial_status: node.displayFinancialStatus?.toLowerCase() ?? null,
    marketing_consent_state: emailAddress?.marketingState ?? "UNKNOWN",
    test: node.test,
    shipping_country_code: node.shippingAddress?.countryCode ?? null,
    shipping_country_code_v2: node.shippingAddress?.countryCodeV2 ?? null,
    shipping_country: node.shippingAddress?.country ?? null,
    line_items: node.lineItems.nodes.map(item => ({
      product_id: item.product?.id ?? null,
      product_handle: item.product?.handle ?? null,
      title: item.title,
      variant_title: item.variantTitle,
      quantity: item.quantity,
      sku: item.sku,
    })),
  };
}

async function observeOrderFulfillments(env: LifecycleEnv, order: ShopifyOrderNode, now: Date): Promise<void> {
  for (const fulfillment of order.fulfillments ?? []) {
    if (fulfillment.events.pageInfo.hasNextPage) {
      throw new Error("shopify_fulfillment_events_pagination_limit_reached");
    }
    const tracking = fulfillment.trackingInfo[0];
    const events = [...fulfillment.events.nodes].sort(
      (left, right) => new Date(left.happenedAt).getTime() - new Date(right.happenedAt).getTime(),
    );
    for (const event of events) {
      await processFulfillmentObservation(env, {
        eventKey: `shopify-fulfillment-poll:${event.id}`,
        shopifyOrderId: order.id,
        shopifyFulfillmentId: fulfillment.id,
        status: event.status,
        happenedAt: event.happenedAt,
        trackingCompany: tracking?.company ?? null,
        trackingNumber: tracking?.number ?? null,
        estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
        source: "POLL",
        payload: { order_id: order.id, fulfillment, event },
      }, now);
    }
    await processFulfillmentObservation(env, {
      eventKey: `shopify-fulfillment-summary:${fulfillment.id}:${order.updatedAt}`,
      shopifyOrderId: order.id,
      shopifyFulfillmentId: fulfillment.id,
      status: fulfillment.displayStatus,
      happenedAt: fulfillment.deliveredAt ?? fulfillment.inTransitAt ?? order.updatedAt,
      trackingCompany: tracking?.company ?? null,
      trackingNumber: tracking?.number ?? null,
      estimatedDeliveryAt: fulfillment.estimatedDeliveryAt,
      source: "POLL",
      payload: { order_id: order.id, fulfillment },
    }, now);
  }
}

export interface ShopifyOrderSyncResult {
  ok: boolean;
  fetched: number;
  paid: number;
  processed: number;
  ignored: number;
  pages: number;
  since: string;
}

export async function syncPaidOrders(
  env: LifecycleEnv,
  now = new Date(),
  dependencies: { fetcher?: typeof fetch; sleeper?: (milliseconds: number) => Promise<void> } = {},
): Promise<ShopifyOrderSyncResult> {
  const config = lifecycleConfig(env);
  const mode = lifecycleMode(env);
  const lastSuccess = await healthValue(env.DB, "last_shopify_orders_sync");
  const since = syncWindowStart(lastSuccess, config.activatedAt, now, config.syncOverlapMinutes);
  const filter = `updated_at:>='${since}'`;
  let after: string | null = null;
  let fetched = 0;
  let paid = 0;
  let processed = 0;
  let ignored = 0;
  let pages = 0;
  const current = isoNow(now);
  await setHealth(env.DB, "last_shopify_orders_api_attempt", current, "RUNNING", current);

  try {
    for (let page = 0; page < config.maxPages; page += 1) {
      const data: OrderPage = await shopifyGraphql<OrderPage>(
        env,
        PAID_ORDERS_QUERY,
        { first: 50, after, query: filter },
        dependencies,
      );
      pages += 1;
      const connection = data.orders;
      for (const order of connection.nodes) {
        fetched += 1;
        const payload = orderPayload(order);
        const email = normalizedEmail(payload.email ?? payload.customer?.email);
        const isPaid = ["paid", "partially_paid"].includes(payload.financial_status ?? "");
        if (isPaid) paid += 1;
        const occurredAt = payload.processed_at ?? payload.created_at ?? current;
        const occurredTime = new Date(occurredAt).getTime();
        const activationTime = new Date(config.activatedAt).getTime();
        const allowed = isPaid
          && Boolean(email)
          && Number.isFinite(occurredTime)
          && Number.isFinite(activationTime)
          && occurredTime >= activationTime
          && (mode === "test"
            ? email === config.testEmail
            : mode === "production" && order.test !== true);
        const eventId = `shopify-order-poll:${order.id}:${order.updatedAt}`;
        const existing = await env.DB.prepare(
          "SELECT status FROM shopify_event_receipts WHERE event_id = ?",
        ).bind(eventId).first<{ status: string }>();
        if (existing?.status === "PROCESSED" || existing?.status === "IGNORED") {
          ignored += 1;
          continue;
        }
        await env.DB.prepare(
          `INSERT OR IGNORE INTO shopify_event_receipts
            (event_id, topic, shop_domain, payload_hash, occurred_at, received_at, status)
           VALUES (?, 'orders/poll', ?, ?, ?, ?, 'RECEIVED')`,
        ).bind(eventId, config.shopDomain, await hashPayload(order), occurredAt, current).run();
        if (!allowed) {
          await env.DB.prepare(
            `UPDATE shopify_event_receipts
             SET status = 'IGNORED', processed_at = ?, error_code = NULL WHERE event_id = ?`,
          ).bind(current, eventId).run();
          ignored += 1;
          continue;
        }
        try {
          await processPaidOrder(env, payload, eventId, now);
          await observeOrderFulfillments(env, order, now);
          processed += 1;
        } catch (error) {
          const code = error instanceof Error ? error.message : "shopify_order_poll_processing_failed";
          await env.DB.prepare(
            "UPDATE shopify_event_receipts SET status = 'FAILED', error_code = ? WHERE event_id = ?",
          ).bind(code.slice(0, 100), eventId).run();
          throw error;
        }
      }
      after = connection.pageInfo.endCursor;
      if (!connection.pageInfo.hasNextPage || !after) break;
      if (page === config.maxPages - 1) throw new Error("shopify_orders_pagination_limit_reached");
    }
    await Promise.all([
      setHealth(env.DB, "last_shopify_orders_sync", current),
      setHealth(env.DB, "last_successful_shopify_api_call", current),
      setHealth(
        env.DB,
        "shopify_orders_sync_status",
        JSON.stringify({ fetched, paid, processed, ignored, pages }),
        "OK",
        current,
      ),
    ]);
    return { ok: true, fetched, paid, processed, ignored, pages, since };
  } catch (error) {
    const code = error instanceof Error ? error.message : "shopify_orders_sync_failed";
    await Promise.all([
      setHealth(env.DB, "shopify_orders_sync_status", code, "ERROR", current),
      recordLifecycleError(env.DB, {
        component: "shopify_orders_sync",
        code,
        safeMessage: "Shopify paid-order synchronization failed.",
        retryable: true,
        now: current,
      }),
    ]);
    throw error;
  }
}

async function suppressForShopifyConsent(
  env: LifecycleEnv,
  input: { customerId: string; email: string; emailHash: string; occurredAt: string; now: string },
): Promise<void> {
  const identityId = `identity:${input.emailHash}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO suppressions
        (email_hash, source, reason, occurred_at, shopify_customer_id, active, created_at, updated_at)
       VALUES (?, 'SHOPIFY_CONSENT', 'marketing_unsubscribed', ?, ?, 1, ?, ?)
       ON CONFLICT(email_hash) DO UPDATE SET
         source = excluded.source, reason = excluded.reason, occurred_at = excluded.occurred_at,
         shopify_customer_id = excluded.shopify_customer_id, active = 1, updated_at = excluded.updated_at`,
    ).bind(input.emailHash, input.occurredAt, input.customerId, input.now, input.now),
    env.DB.prepare(
      `UPDATE abandoned_checkouts SET state = 'SUPPRESSED', consent_state = 'UNSUBSCRIBED', updated_record_at = ?
       WHERE email_hash = ? AND state IN ('PENDING', 'ABANDONED', 'INELIGIBLE')`,
    ).bind(input.now, input.emailHash),
    env.DB.prepare(
      `UPDATE lifecycle_orders SET consent_state = 'UNSUBSCRIBED', updated_at = ? WHERE email_hash = ?`,
    ).bind(input.now, input.emailHash),
    env.DB.prepare(
      `UPDATE lifecycle_identity_links SET lifecycle_stage = 'SUPPRESSED', updated_at = ?
       WHERE email_hash = ?`,
    ).bind(input.now, input.emailHash),
    env.DB.prepare(
      `UPDATE scheduled_lifecycle_events
       SET status = 'CANCELLED', lease_until = NULL, last_error_code = 'shopify_marketing_unsubscribed', updated_at = ?
       WHERE status IN ('PENDING', 'RETRY', 'LEASED') AND (
         (entity_type = 'identity' AND entity_id = ?)
         OR (entity_type = 'checkout' AND entity_id IN (
           SELECT shopify_checkout_id FROM abandoned_checkouts WHERE email_hash = ?
         ))
         OR (entity_type = 'order' AND entity_id IN (
           SELECT shopify_order_id FROM lifecycle_orders WHERE email_hash = ?
         ))
       )`,
    ).bind(input.now, identityId, input.emailHash, input.emailHash),
  ]);
  await queueResendUnsubscribe(env, {
    email: input.email,
    emailHash: input.emailHash,
    idempotencyKey: `shopify-consent:${input.customerId}:${input.occurredAt}:unsubscribed`,
    now: input.now,
  });
}

export interface ShopifyConsentSyncResult {
  ok: boolean;
  fetched: number;
  updated: number;
  unsubscribed: number;
  welcomeScheduled: number;
  ignored: number;
  pages: number;
  since: string;
}

export async function syncCustomerConsent(
  env: LifecycleEnv,
  now = new Date(),
  dependencies: { fetcher?: typeof fetch; sleeper?: (milliseconds: number) => Promise<void> } = {},
): Promise<ShopifyConsentSyncResult> {
  const config = lifecycleConfig(env);
  const mode = lifecycleMode(env);
  const lastSuccess = await healthValue(env.DB, "last_shopify_consent_sync");
  const since = syncWindowStart(lastSuccess, config.activatedAt, now, config.syncOverlapMinutes);
  const filter = `updated_at:>='${since}'`;
  const current = isoNow(now);
  let after: string | null = null;
  let fetched = 0;
  let updated = 0;
  let unsubscribed = 0;
  let welcomeScheduled = 0;
  let ignored = 0;
  let pages = 0;
  await setHealth(env.DB, "last_shopify_consent_api_attempt", current, "RUNNING", current);

  try {
    for (let page = 0; page < config.maxPages; page += 1) {
      const data: CustomerPage = await shopifyGraphql<CustomerPage>(
        env,
        CUSTOMERS_QUERY,
        { first: 50, after, query: filter },
        dependencies,
      );
      pages += 1;
      const connection = data.customers;
      for (const customer of connection.nodes) {
        fetched += 1;
        const address = customer.defaultEmailAddress;
        const email = address?.validFormat === false ? null : normalizedEmail(address?.emailAddress);
        if (!email || (mode === "test" && email !== config.testEmail) || mode === "disabled") {
          ignored += 1;
          continue;
        }
        const emailHash = await hashEmail(email, config.hashKey);
        const identityId = `identity:${emailHash}`;
        const previous = await env.DB.prepare(
          "SELECT consent_state FROM lifecycle_identity_links WHERE email_hash = ?",
        ).bind(emailHash).first<{ consent_state: ConsentState }>();
        const consentState = address?.marketingState ?? "UNKNOWN";
        const consentUpdatedAt = address?.marketingUpdatedAt ?? customer.updatedAt;
        await env.DB.prepare(
          `INSERT INTO lifecycle_identity_links (
             identity_id, shopify_customer_id, email, email_hash, first_name, consent_state,
             consent_updated_at, identity_source, verified_at, lifecycle_stage, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'SHOPIFY_ADMIN', ?, 'WELCOME', ?, ?)
           ON CONFLICT(email_hash) DO UPDATE SET
             shopify_customer_id = excluded.shopify_customer_id,
             email = excluded.email,
             first_name = COALESCE(excluded.first_name, lifecycle_identity_links.first_name),
             consent_state = excluded.consent_state,
             consent_updated_at = excluded.consent_updated_at,
             updated_at = excluded.updated_at`,
        ).bind(
          identityId,
          customer.id,
          email,
          emailHash,
          customer.firstName,
          consentState,
          consentUpdatedAt,
          consentUpdatedAt,
          current,
          current,
        ).run();
        await env.DB.prepare(
          `UPDATE abandoned_checkouts SET consent_state = ?, updated_record_at = ? WHERE email_hash = ?`,
        ).bind(consentState, current, emailHash).run();
        updated += 1;

        if (["UNSUBSCRIBED", "NOT_SUBSCRIBED", "REDACTED"].includes(consentState)) {
          await suppressForShopifyConsent(env, {
            customerId: customer.id,
            email,
            emailHash,
            occurredAt: consentUpdatedAt,
            now: current,
          });
          unsubscribed += 1;
          continue;
        }
        if (consentState !== "SUBSCRIBED" || previous?.consent_state === "SUBSCRIBED") continue;
        const consentTime = new Date(consentUpdatedAt).getTime();
        const activationTime = new Date(config.activatedAt).getTime();
        if (!Number.isFinite(consentTime) || !Number.isFinite(activationTime) || consentTime < activationTime) continue;
        const purchase = await env.DB.prepare(
          "SELECT shopify_order_id FROM lifecycle_orders WHERE email_hash = ? LIMIT 1",
        ).bind(emailHash).first<{ shopify_order_id: string }>();
        const suppression = await env.DB.prepare(
          "SELECT active FROM suppressions WHERE email_hash = ? AND active = 1",
        ).bind(emailHash).first<{ active: number }>();
        if (purchase || suppression?.active === 1) continue;
        await scheduleLifecycleEvent(env.DB, {
          idempotencyKey: `welcome:${identityId}`,
          eventName: "shopify.marketing_subscribed",
          flow: "welcome",
          emailNumber: 0,
          entityType: "identity",
          entityId: identityId,
          dueAt: current,
          now: current,
        });
        welcomeScheduled += 1;
      }
      after = connection.pageInfo.endCursor;
      if (!connection.pageInfo.hasNextPage || !after) break;
      if (page === config.maxPages - 1) throw new Error("shopify_consent_pagination_limit_reached");
    }
    await Promise.all([
      setHealth(env.DB, "last_shopify_consent_sync", current),
      setHealth(env.DB, "last_successful_shopify_api_call", current),
      setHealth(
        env.DB,
        "shopify_consent_sync_status",
        JSON.stringify({ fetched, updated, unsubscribed, welcomeScheduled, ignored, pages }),
        "OK",
        current,
      ),
    ]);
    return { ok: true, fetched, updated, unsubscribed, welcomeScheduled, ignored, pages, since };
  } catch (error) {
    const code = error instanceof Error ? error.message : "shopify_consent_sync_failed";
    await Promise.all([
      setHealth(env.DB, "shopify_consent_sync_status", code, "ERROR", current),
      recordLifecycleError(env.DB, {
        component: "shopify_consent_sync",
        code,
        safeMessage: "Shopify customer-consent synchronization failed.",
        retryable: true,
        now: current,
      }),
    ]);
    throw error;
  }
}

export { ABANDONED_CHECKOUT_QUERY, CUSTOMERS_QUERY, PAID_ORDERS_QUERY };

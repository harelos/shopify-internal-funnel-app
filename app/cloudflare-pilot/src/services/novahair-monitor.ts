import { env as cloudflareEnv } from "cloudflare:workers";
// Re-exported so existing callers keep importing it from the monitor.
export { decodeBundleSku } from "../lib/novahair-cj-auto-order.js";

const EXCLUDED_ORDER_NUMBERS = new Set(["4359", "4360", "4361", "4362"]);
const EXCLUDED_TAG_KEYWORDS = ["INTERNAL_", "TEST", "CANARY", "BOOTSTRAP", "DO_NOT_FULFILL"];
const PRODUCT_ID = "gid://shopify/Product/10341269274919";
const SHOP_DOMAIN = "jacobfelipe.myshopify.com";
const CJ_AUTH_URL = "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken";
const CJ_API_ROOT = "https://developers.cjdropshipping.com/api2.0/v1";

let cjTokenCache: { token: string; expiresAt: number } | null = null;

function getEnvVar(key: string, fallback: string = ""): string {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.[key] || process.env[key] || fallback;
}

export function getD1(): any {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  if (!envObj?.DB) {
    throw new Error("Cloudflare D1 binding DB is unavailable.");
  }
  return envObj.DB;
}

export async function getNovaHairState(db: any): Promise<NovaHairState> {
  const row = await db.prepare('SELECT * FROM "NovaHairMonitorState" WHERE id = ?').bind("singleton").first();
  if (!row) {
    const defaultState: NovaHairState = {
      id: "singleton",
      releaseState: "PRODUCTION_ACTIVE_UNDER_MONITORING",
      deploymentTimestamp: "2026-08-23T08:06:02Z",
      passedCount: 0,
      failedCount: 0,
      circuitBreakerTriggered: false,
      purchaseKillSwitchActive: false,
      transformActive: true,
      monitoredOrders: [],
      seenOrderIds: [],
      incidentData: null,
      lastWebhookTimestamp: null,
      lastCjSyncTimestamp: null,
      updatedAt: new Date().toISOString()
    };
    await db.prepare(`
      INSERT INTO "NovaHairMonitorState" (id, releaseState, deploymentTimestamp, passedCount, failedCount, circuitBreakerTriggered, purchaseKillSwitchActive, transformActive, monitoredOrders, seenOrderIds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      defaultState.id, defaultState.releaseState, defaultState.deploymentTimestamp,
      defaultState.passedCount, defaultState.failedCount, 0, 0, 1, "[]", "[]"
    ).run();
    return defaultState;
  }

  return {
    id: row.id,
    releaseState: row.releaseState,
    deploymentTimestamp: row.deploymentTimestamp,
    passedCount: Number(row.passedCount || 0),
    failedCount: Number(row.failedCount || 0),
    circuitBreakerTriggered: Boolean(row.circuitBreakerTriggered),
    purchaseKillSwitchActive: Boolean(row.purchaseKillSwitchActive),
    transformActive: Boolean(row.transformActive),
    monitoredOrders: JSON.parse(row.monitoredOrders || "[]"),
    seenOrderIds: JSON.parse(row.seenOrderIds || "[]"),
    incidentData: row.incidentData ? JSON.parse(row.incidentData) : null,
    lastWebhookTimestamp: row.lastWebhookTimestamp,
    lastCjSyncTimestamp: row.lastCjSyncTimestamp,
    updatedAt: row.updatedAt
  };
}

export async function saveNovaHairState(db: any, state: NovaHairState): Promise<void> {
  await db.prepare(`
    UPDATE "NovaHairMonitorState"
    SET releaseState = ?,
        deploymentTimestamp = ?,
        passedCount = ?,
        failedCount = ?,
        circuitBreakerTriggered = ?,
        purchaseKillSwitchActive = ?,
        transformActive = ?,
        monitoredOrders = ?,
        seenOrderIds = ?,
        incidentData = ?,
        lastWebhookTimestamp = ?,
        lastCjSyncTimestamp = ?,
        updatedAt = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(
    state.releaseState,
    state.deploymentTimestamp,
    state.passedCount,
    state.failedCount,
    state.circuitBreakerTriggered ? 1 : 0,
    state.purchaseKillSwitchActive ? 1 : 0,
    state.transformActive ? 1 : 0,
    JSON.stringify(state.monitoredOrders),
    JSON.stringify(state.seenOrderIds),
    state.incidentData ? JSON.stringify(state.incidentData) : null,
    state.lastWebhookTimestamp,
    state.lastCjSyncTimestamp,
    "singleton"
  ).run();
}
import { readCachedToken, writeCachedToken } from "../lib/service-token-cache.js";
import { persistFinancialLedgerEntries } from "../lib/financial-ledger.js";
import {
  buildNovaHairCjCreateOrderPayload,
  CJ_ADDON_MAPPINGS,
  CJ_PHYSICAL_MAPPINGS,
  novaHairAutoCjOrderNumber,
  type ExpectedBundle,
  type NovaHairComponentKey,
} from "../lib/novahair-cj-auto-order.js";
import { planSupplierOrder } from "../lib/supplier-order-plan.js";
import { purchasedCjOrdersByNumber, readCjOrderIndex } from "../lib/cj-order-index.js";
import { cjOrderCost } from "../lib/cj-cost-match.js";

export interface NovaHairState {
  id: string;
  releaseState: string;
  deploymentTimestamp: string;
  passedCount: number;
  failedCount: number;
  circuitBreakerTriggered: boolean;
  purchaseKillSwitchActive: boolean;
  transformActive: boolean;
  monitoredOrders: any[];
  seenOrderIds: string[];
  incidentData: any | null;
  lastWebhookTimestamp: string | null;
  lastCjSyncTimestamp: string | null;
  updatedAt: string;
}


async function shopifyGql(query: string, variables: any = {}): Promise<any> {
  const token = getEnvVar("SHOPIFY_ADMIN_ACCESS_TOKEN", getEnvVar("SHOPIFY_ACCESS_TOKEN"));
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2024-04/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });
  return res.json();
}

const CJ_TOKEN_CACHE_ID = "cj:access_token";

async function getCjToken(): Promise<string> {
  // CJ issues long-lived access tokens directly as well as exchangeable API
  // keys. The account's API keys are currently rejected while its issued token
  // works, so a configured token is used as-is and the exchange is skipped.
  const issued = getEnvVar("CJ_ACCESS_TOKEN");
  if (issued) return issued;
  if (cjTokenCache && cjTokenCache.expiresAt > Date.now() + 60_000) return cjTokenCache.token;
  // A recycled isolate loses the in-memory token, and CJ rate-limits
  // authentication to roughly one call every five minutes, so the token is also
  // kept in D1. Without this a frequent schedule locks the account out.
  const persisted = await readCachedToken(CJ_TOKEN_CACHE_ID);
  if (persisted) {
    cjTokenCache = { token: persisted, expiresAt: Date.now() + 10 * 60 * 1000 };
    return persisted;
  }
  const apiKey = getEnvVar("CJ_API_KEY");
  if (!apiKey) throw new Error("CJ_API_KEY is not configured.");
  const res = await fetch(CJ_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json();
  const token = data?.data?.accessToken;
  if (!res.ok || !token || data?.result === false) {
    throw new Error(`CJ authentication failed: ${String(data?.message || `HTTP ${res.status}`).slice(0, 180)}`);
  }
  const documentedExpiry = Date.parse(String(data?.data?.accessTokenExpiryDate || ""));
  const expiresAt = Number.isFinite(documentedExpiry) ? documentedExpiry : Date.now() + 23 * 60 * 60 * 1000;
  cjTokenCache = { token, expiresAt };
  await writeCachedToken(CJ_TOKEN_CACHE_ID, token, expiresAt);
  return token;
}

async function cjGet(endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const token = await getCjToken();
  const url = new URL(`${CJ_API_ROOT}/${endpoint}`);
  Object.keys(params).forEach(k => url.searchParams.append(k, String(params[k])));
  const res = await fetch(url.toString(), {
    headers: {
      "CJ-Access-Token": token,
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(10_000),
  });
  const data: any = await res.json();
  if (!res.ok || data?.result === false) {
    throw new Error(`CJ ${endpoint} failed: ${String(data?.message || `HTTP ${res.status}`).slice(0, 180)}`);
  }
  return data;
}

async function cjPost(endpoint: string, payload: Record<string, any>): Promise<any> {
  const token = await getCjToken();
  const res = await fetch(`${CJ_API_ROOT}/${endpoint}`, {
    method: "POST",
    headers: {
      "CJ-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const data: any = await res.json();
  if (!res.ok || data?.result === false) {
    throw new Error(`CJ ${endpoint} failed: ${String(data?.message || `HTTP ${res.status}`).slice(0, 180)}`);
  }
  return data;
}

function envFlag(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(getEnvVar(name)).toLowerCase());
}

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(getEnvVar(name, String(fallback))), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shopifyOrderNumberValue(orderNum: string): number | null {
  const digits = String(orderNum || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNovaHairAutoCreateEligible(orderNum: string): boolean {
  const minOrderNumber = envInt("NOVAHAIR_CJ_AUTO_CREATE_MIN_ORDER_NUMBER", 0);
  if (minOrderNumber <= 0) return true;
  const currentOrderNumber = shopifyOrderNumberValue(orderNum);
  return currentOrderNumber !== null && currentOrderNumber >= minOrderNumber;
}

/**
 * The CJ order already purchased for a sale, under any prefix, or null.
 *
 * Only page one used to be searched, and only for AUTO-: a RESCUE- order the
 * Railway worker had placed, or an AUTO- order pushed past the first hundred
 * rows, was invisible, and a second order went out for a parcel already on
 * its way. The list is now read back to the sale itself, and a read that
 * fails or stops short throws, so nothing is created on a half-read list.
 * The store's own shadow ("#4470", never purchased) is never an answer.
 */
async function findPurchasedCjOrder(orderNum: string, orderPayload: any): Promise<any | null> {
  const saleAt = new Date(String(orderPayload?.processed_at || orderPayload?.created_at || "")).getTime();
  // An hour of slack for clocks; nothing for this sale was created before it.
  // A payload with no sale date reads two weeks back.
  const since = new Date((Number.isFinite(saleAt) ? saleAt : Date.now() - 14 * 86400000) - 3600000).toISOString();
  const index = await readCjOrderIndex({ list: listCjOrders, since, maxPages: 10 });
  if (!index.complete) {
    throw new Error(`CJ order list could not be read back to ${since}; refusing to create an order on a partial list.`);
  }
  const candidates = purchasedCjOrdersByNumber(index.rows).get(String(orderNum).replace(/^#/, "")) || [];
  if (!candidates.length) return null;
  const autoOrderNumber = novaHairAutoCjOrderNumber(orderNum);
  const own = candidates.find(row => String(row.orderNum || "") === autoOrderNumber);
  return own ?? { ...candidates[0], adopted: true };
}

async function ensureAutoCjOrder(orderPayload: any, expected: ExpectedBundle, orderNum: string): Promise<any | null> {
  const existing = await findPurchasedCjOrder(orderNum, orderPayload);
  if (existing) return existing;

  const payload = buildNovaHairCjCreateOrderPayload(orderPayload, expected, {
    orderNumber: novaHairAutoCjOrderNumber(orderNum),
    isSandbox: envFlag("NOVAHAIR_CJ_AUTO_CREATE_SANDBOX"),
  });
  const response = await cjPost("shopping/order/createOrderV2", payload as unknown as Record<string, any>);
  const createdOrderId = response?.data?.orderId;
  if (!createdOrderId) {
    throw new Error("CJ createOrderV2 returned no orderId for NovaHair auto order.");
  }
  return { orderId: createdOrderId, orderNum: payload.orderNumber, autoCreated: true };
}

export async function testCjReadConnection(): Promise<{
  connected: true;
  orderRead: true;
  firstPageRows: number;
  tokenCached: boolean;
}> {
  const hadCachedToken = Boolean(cjTokenCache && cjTokenCache.expiresAt > Date.now() + 60_000);
  const response = await cjGet("shopping/order/list", { pageNum: 1, pageSize: 1 });
  const rows = response?.data?.list;
  if (!Array.isArray(rows)) throw new Error("CJ order list returned an unexpected response shape.");
  return { connected: true, orderRead: true, firstPageRows: rows.length, tokenCached: hadCachedToken };
}

export async function listCjOrders(pageNum: number, pageSize: number, filters: Record<string, string> = {}): Promise<any[]> {
  const response = await cjGet("shopping/order/list", { pageNum, pageSize, ...filters });
  const rows = response?.data?.list;
  if (!Array.isArray(rows)) throw new Error("CJ order list returned an unexpected response shape.");
  return rows;
}

/**
 * CJ's tracking events for one parcel — the only source that knows whether a
 * parcel is still in China or already released from Israeli customs.
 */
export async function cjTrackInfo(trackNumber: string): Promise<{
  trackingNumber: string;
  trackingStatus: string | null;
  cjMailNo: string | null;
  logisticName: string | null;
  deliveryDay: number | null;
  lastMileCarrier: string | null;
  routes: Array<{ acceptTime: string | null; acceptAddress: string | null; remark: string }>;
} | null> {
  const number = String(trackNumber || "").trim();
  if (!number) return null;
  const response = await cjGet("logistic/trackInfo", { trackNumber: number });
  const rows = Array.isArray(response?.data) ? response.data : [];
  const row = rows[0];
  if (!row || typeof row !== "object") return null;
  const deliveryDay = Number(row.deliveryDay);
  return {
    trackingNumber: String(row.trackingNumber || number),
    trackingStatus: row.trackingStatus ? String(row.trackingStatus) : null,
    cjMailNo: row.cjMailNo ? String(row.cjMailNo) : null,
    logisticName: row.logisticName ? String(row.logisticName) : null,
    deliveryDay: Number.isFinite(deliveryDay) ? deliveryDay : null,
    lastMileCarrier: row.lastMileCarrier ? String(row.lastMileCarrier) : null,
    routes: (Array.isArray(row.routes) ? row.routes : []).map((route: any) => ({
      acceptTime: route?.acceptTime ? String(route.acceptTime) : null,
      acceptAddress: route?.acceptAddress ? String(route.acceptAddress) : null,
      remark: String(route?.remark || ""),
    })).filter((route: any) => route.remark),
  };
}

export async function getCjOrderDetail(orderId: string): Promise<any> {
  if (!orderId) throw new Error("CJ order detail requires an order ID.");
  const response = await cjGet("shopping/order/getOrderDetail", { orderId });
  if (!response?.data || typeof response.data !== "object") {
    throw new Error("CJ order detail returned an unexpected response shape.");
  }
  return response.data;
}

export async function snapshotProductState(): Promise<any> {
  const q = `
    query getProductSnapshot($id: ID!) {
      product(id: $id) {
        id
        title
        status
        tracksInventory
        resourcePublicationsV2(first: 10) {
          edges {
            node {
              publication { id name }
              publishDate
              isPublished
            }
          }
        }
      }
    }
  `;
  const res = await shopifyGql(q, { id: PRODUCT_ID });
  return res?.data?.product || {};
}

export async function setShopifyProductStatus(status: "ACTIVE" | "DRAFT"): Promise<boolean> {
  const m = `
    mutation productUpdate($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id status }
        userErrors { field message }
      }
    }
  `;
  const res = await shopifyGql(m, { input: { id: PRODUCT_ID, status } });
  const updatedStatus = res?.data?.productUpdate?.product?.status;
  return updatedStatus === status;
}

export async function triggerCloudCircuitBreaker(
  reason: string,
  orderData: any,
  expected: any,
  actual: any,
  db: any
): Promise<void> {
  console.error(`🚨 [CLOUD CIRCUIT BREAKER TRIGGERED] ${reason}`);
  const state = await getNovaHairState(db);

  // STEP 1: Snapshot product state
  const snapshot = await snapshotProductState();

  // STEP 2: Engage kill switch (ACTIVE -> DRAFT)
  await setShopifyProductStatus("DRAFT");

  // STEP 3: Verify kill switch
  const verifyRes = await shopifyGql(`query { product(id: "${PRODUCT_ID}") { status } }`);
  const currentStatus = verifyRes?.data?.product?.status;

  // STEP 4: Persist incident
  const incident = {
    timestamp: new Date().toISOString(),
    runtime: "CLOUDFLARE_WORKER",
    reason,
    killSwitchStatus: currentStatus,
    productSnapshot: snapshot,
    expected,
    actual,
    order: orderData,
    recoveryProtocol: [
      "1. Verify and fix root cause of fulfillment mismatch.",
      "2. Verify Cart Transform is active and correct.",
      "3. Restore Product 10341269274919 status to ACTIVE.",
      "4. Verify sales channel publications (Online Store, Facebook & Instagram).",
      "5. Run 1 isolated test cart.",
      "6. Resume sales and reset state in NovaHairMonitorState."
    ],
    emergencyFallbackNote: "100 Combined Products architecture is EMERGENCY_FALLBACK_ONLY and requires explicit human authorization."
  };

  // STEP 5: Mark system state
  state.circuitBreakerTriggered = true;
  state.purchaseKillSwitchActive = true;
  state.releaseState = "CIRCUIT_BREAKER_TRIGGERED";
  state.failedCount += 1;
  state.incidentData = incident;

  await saveNovaHairState(db, state);
}

export async function enqueuePendingOrder(
  orderPayload: any,
  expected: ExpectedBundle,
  db: any,
  options: { syncState?: string; result?: string } = {},
): Promise<void> {
  const orderId = String(orderPayload.admin_graphql_api_id || `gid://shopify/Order/${orderPayload.id}`);
  const orderNum = String(orderPayload.name || orderPayload.order_number || "").replace("#", "");
  const rawId = String(orderPayload.id || orderId.replace(/^gid:\/\/shopify\/Order\//, ""));
  const syncState = options.syncState || "WAITING_FOR_CJ_SYNC";

  await db.prepare(`
    INSERT OR REPLACE INTO "NovaHairPendingOrder" (orderId, orderNum, rawId, syncState, expectedData, orderPayload, attempts, firstSeenAt, lastAttemptAt, result)
    VALUES (?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
  `).bind(orderId, orderNum, rawId, syncState, JSON.stringify(expected), JSON.stringify(orderPayload), options.result ? options.result.slice(0, 240) : null).run();

  console.log(`[D1 QUEUE] Enqueued Order #${orderNum} as ${syncState}.`);
}

/**
 * Books the sale's supplier cost the moment CJ quotes it, dated by the sale.
 *
 * The cost used to be dated by the moment of verification whenever the
 * replayed payload carried no sale date, which moved six week-old orders onto
 * the day a sweep re-queued them. A payload with no sale date is left to the
 * reconciler, which dates it from Shopify; nothing is dated by when this code
 * happened to run. The row is shaped exactly as the reconciler's, so the two
 * writers hold one definition: CJ's order total, product plus the postage it
 * quoted, whether or not the order has been paid.
 */
async function recordSupplierCost(orderId: string, orderNum: string, orderPayload: any, cj: any): Promise<void> {
  const amount = cjOrderCost(cj);
  const saleAt = new Date(String(orderPayload?.processed_at || orderPayload?.created_at || ""));
  if (amount == null || Number.isNaN(saleAt.getTime())) {
    console.warn(`[CJ COST] Order #${orderNum}: ${amount == null ? "CJ has not priced the order yet" : "the payload carries no sale date"}; leaving the cost to the reconciler.`);
    return;
  }
  const occurredDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: getEnvVar("REPORTING_TIMEZONE", "Asia/Jerusalem"),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(saleAt);
  await persistFinancialLedgerEntries([{
    source: "CJ_ORDER_COSTS",
    category: "CJ_VARIABLE_COST",
    externalKey: orderId,
    occurredDate,
    amount,
    currency: "USD",
    quality: "ACTUAL",
    metadata: {
      costBasis: "CJ_ORDER",
      costDetail: "CJ order total: product plus the shipping CJ quoted for this parcel.",
      cjOrderNum: String(cj?.orderNum || ""),
      cjOrderStatus: String(cj?.orderStatus || ""),
      cjProductAmount: Number(cj?.productAmount) || null,
      cjPostageAmount: Number(cj?.postageAmount) || null,
      bookedBy: "novahair-monitor",
    },
  }]);
}

/** CJ rejected the address itself; a person can fix it and the order can go. */
function isAddressRejection(message: string): boolean {
  return /postcode|post code|postal|zip|address/i.test(message);
}

/**
 * Re-reads the shipping address from Shopify.
 *
 * The queue stores the order payload as it arrived, so a retry would resend the
 * same empty postcode forever. Reading the address again means the order goes
 * through by itself the moment the postcode is filled in.
 */
async function refreshedShippingAddress(rawId: string): Promise<Record<string, unknown> | null> {
  try {
    const data = await shopifyGql(`query($id: ID!) { order(id: $id) {
      shippingAddress { zip city province provinceCode country countryCodeV2 address1 address2 phone firstName lastName }
    } }`, { id: `gid://shopify/Order/${rawId}` });
    const address = data?.order?.shippingAddress;
    if (!address) return null;
    return {
      zip: address.zip, city: address.city, province: address.province, province_code: address.provinceCode,
      country: address.country, country_code: address.countryCodeV2, address1: address.address1,
      address2: address.address2, phone: address.phone, first_name: address.firstName, last_name: address.lastName,
    };
  } catch {
    return null;
  }
}

export async function processPendingQueueCron(db: any): Promise<void> {
  const pendingRows = await db.prepare(`
    SELECT * FROM "NovaHairPendingOrder"
    WHERE syncState IN ('WAITING_FOR_CJ_SYNC', 'CJ_SYNC_DELAYED', 'CJ_AUTO_CREATED')
      OR (syncState = 'CJ_AUTO_CREATE_FAILED' AND attempts < 3)
      OR syncState = 'NEEDS_ADDRESS_FIX'
    ORDER BY firstSeenAt ASC LIMIT 10
  `).all();

  const results = pendingRows.results || [];
  if (results.length === 0) return;

  console.log(`[CRON EXECUTOR] Processing ${results.length} pending NovaHair order(s) for CJ verification...`);

  for (const row of results) {
    const orderId = row.orderId;
    const orderNum = row.orderNum;
    const rawId = row.rawId;
    let expected: ExpectedBundle = JSON.parse(row.expectedData);
    const orderPayload = JSON.parse(row.orderPayload);
    const attempts = Number(row.attempts || 0) + 1;
    // The parcel is planned again from the order's own lines on every attempt,
    // so a mapping added after the order was queued applies to it, and an
    // upsell line the old code did not know is never shipped short.
    const planned = planSupplierOrder(Array.isArray(orderPayload.line_items) ? orderPayload.line_items : []);
    if (planned.ok) {
      expected = planned.expected;
    } else if (planned.code !== "NO_SUPPLIER_LINES") {
      await db.prepare(`
        UPDATE "NovaHairPendingOrder"
        SET syncState = 'NEEDS_SUPPLIER_MAPPING', attempts = ?, result = ?, lastAttemptAt = CURRENT_TIMESTAMP
        WHERE orderId = ?
      `).bind(attempts, planned.reason.slice(0, 240), orderId).run();
      continue;
    }
    // An order held for a bad address retries against the live address, so
    // correcting it in Shopify is all it takes to release the order.
    if (row.syncState === "NEEDS_ADDRESS_FIX") {
      const address = await refreshedShippingAddress(String(rawId));
      if (!address || !String(address.zip || "").trim()) continue;
      orderPayload.shipping_address = { ...(orderPayload.shipping_address || {}), ...address };
    }
    const firstSeen = new Date(row.firstSeenAt).getTime();
    const elapsedSeconds = Math.floor((Date.now() - firstSeen) / 1000);

    let cjOrder: any = null;
    const autoCreateEnabled = envFlag("NOVAHAIR_CJ_AUTO_CREATE_ENABLED");
    try {
      if (autoCreateEnabled) {
        if (!isNovaHairAutoCreateEligible(orderNum)) {
          await db.prepare(`
            UPDATE "NovaHairPendingOrder"
            SET syncState = ?, attempts = ?, result = ?, lastAttemptAt = CURRENT_TIMESTAMP
            WHERE orderId = ?
          `).bind(
            "CJ_AUTO_SKIPPED_PRE_CUTOFF",
            attempts,
            `Skipped because NOVAHAIR_CJ_AUTO_CREATE_MIN_ORDER_NUMBER=${envInt("NOVAHAIR_CJ_AUTO_CREATE_MIN_ORDER_NUMBER", 0)}`,
            orderId
          ).run();
          continue;
        }
        cjOrder = await ensureAutoCjOrder(orderPayload, expected, orderNum);
        await db.prepare(`
          UPDATE "NovaHairPendingOrder"
          SET syncState = ?, attempts = ?, lastAttemptAt = CURRENT_TIMESTAMP
          WHERE orderId = ?
        `).bind("CJ_AUTO_CREATED", attempts, orderId).run();
      } else {
        cjOrder = await findPurchasedCjOrder(orderNum, orderPayload);
      }
    } catch (err) {
      console.warn(`[CRON CJ AUTO/POLL TRANSIENT ERROR] Order #${orderNum}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      // An address CJ will not accept is not a transient error: retrying it
      // three times and giving up is how orders died silently for days. A
      // product CJ cannot supply is not one either; it waits for a person.
      const state = (err as any)?.code === "NO_SUPPLIER_MAPPING"
        ? "NEEDS_SUPPLIER_MAPPING"
        : isAddressRejection(message) ? "NEEDS_ADDRESS_FIX" : "CJ_AUTO_CREATE_FAILED";
      await db.prepare(`
        UPDATE "NovaHairPendingOrder"
        SET syncState = ?, attempts = ?, result = ?, lastAttemptAt = CURRENT_TIMESTAMP
        WHERE orderId = ?
      `).bind(state, attempts, message.slice(0, 240), orderId).run();
      continue;
    }

    if (!cjOrder) {
      let nextState = "WAITING_FOR_CJ_SYNC";
      if (elapsedSeconds > 600) {
        nextState = "CJ_SYNC_TIMEOUT";
        console.warn(`⚠️ [CJ_SYNC_TIMEOUT] Order #${orderNum} exceeded 10m without CJ appearance.`);
      } else if (elapsedSeconds > 180) {
        nextState = "CJ_SYNC_DELAYED";
      }
      await db.prepare(`
        UPDATE "NovaHairPendingOrder"
        SET syncState = ?, attempts = ?, lastAttemptAt = CURRENT_TIMESTAMP
        WHERE orderId = ?
      `).bind(nextState, attempts, orderId).run();
      continue;
    }

    // Found in CJ -> Perform full deep verification
    const state = await getNovaHairState(db);
    state.lastCjSyncTimestamp = new Date().toISOString();

    const detailRes = await cjGet("shopping/order/getOrderDetail", { orderId: cjOrder.orderId });
    const cjData = detailRes?.data || {};
    const productList = cjData.productList || [];

    // Placed by a person or the Railway worker, not by this code: its contents
    // are theirs to verify, and its price is still this sale's cost.
    if (cjOrder.adopted) {
      await recordSupplierCost(orderId, orderNum, orderPayload, { ...cjOrder, ...cjData });
      state.seenOrderIds.push(orderId);
      await saveNovaHairState(db, state);
      await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
        .bind("CJ_VERIFIED", `ADOPTED ${String(cjOrder.orderNum || cjOrder.orderId)}`, orderId).run();
      continue;
    }

    // Every line the parcel may carry: the shades, the kit, and the add-ons.
    const expectedQuantities: Record<string, number> = Object.fromEntries(
      (Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[]).map(key => [key, Number(expected[key] || 0)]),
    );
    const keyByVid = new Map<string, string>(
      (Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[]).map(key => [CJ_PHYSICAL_MAPPINGS[key].vid, key]),
    );
    for (const addon of Object.values(CJ_ADDON_MAPPINGS)) keyByVid.set(addon.vid, `addon:${addon.sku}`);
    for (const addon of expected.addons || []) expectedQuantities[`addon:${addon.sku}`] = Number(addon.quantity || 0);
    const cjQuantities: Record<string, number> = Object.fromEntries(Object.keys(expectedQuantities).map(key => [key, 0]));

    let vidError: string | null = null;
    for (const item of productList) {
      const key = keyByVid.get(String(item.vid));
      if (!key) { vidError = item.vid; break; }
      cjQuantities[key] = (cjQuantities[key] || 0) + Number(item.quantity || 0);
    }

    if (vidError) {
      await triggerCloudCircuitBreaker(`Unknown CJ VID found in order: ${vidError}`, orderPayload, "Known CJ variants: shades, kit and mapped add-ons", vidError, db);
      await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
        .bind("CIRCUIT_BREAKER_TRIGGERED", "FAIL", orderId).run();
      return;
    }

    const mismatches: string[] = [];
    for (const key of new Set([...Object.keys(expectedQuantities), ...Object.keys(cjQuantities)])) {
      const exp = Number(expectedQuantities[key] || 0);
      const act = Number(cjQuantities[key] || 0);
      if (exp !== act) mismatches.push(`${key}: expected ${exp}, got ${act}`);
    }

    if (mismatches.length > 0) {
      await triggerCloudCircuitBreaker(`Component quantity mismatch: ${mismatches.join(", ")}`, orderPayload, expected, cjQuantities, db);
      await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
        .bind("CIRCUIT_BREAKER_TRIGGERED", "FAIL", orderId).run();
      return;
    }

    if (cjData.isComplete !== 1) {
      await triggerCloudCircuitBreaker("CJ order incomplete or has unconnected items (isComplete != 1)", orderPayload, "isComplete == 1", cjData.isComplete, db);
      await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
        .bind("CIRCUIT_BREAKER_TRIGGERED", "FAIL", orderId).run();
      return;
    }

    // Success
    console.log(`🏆 [CRON VERIFIED PASS] Order #${orderNum} verified successfully in CJ!`);
    const orderRecord = {
      order_number: `#${orderNum}`,
      shopify_order_id: orderId,
      original_sku: expected.original_sku,
      expected,
      cj_actual: cjQuantities,
      cj_weight_g: cjData.orderWeight,
      cj_status: cjData.orderStatus,
      cj_is_complete: cjData.isComplete,
      logistic_name: cjData.logisticName,
      product_amount_usd: cjData.productAmount,
      postage_amount_usd: cjData.postageAmount,
      order_amount_usd: cjData.orderAmount,
      cost_label: "CONFIRMED PRE-PAYMENT CJ ORDER COST",
      result: "PASS",
      verified_at: new Date().toISOString()
    };

    state.monitoredOrders.push(orderRecord);
    state.seenOrderIds.push(orderId);
    state.passedCount += 1;

    if (state.passedCount >= 3) {
      state.releaseState = "PRODUCTION_STABLE";
    }

    await saveNovaHairState(db, state);
    await recordSupplierCost(orderId, orderNum, orderPayload, { ...cjOrder, ...cjData });
    await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
      .bind("CJ_VERIFIED", "PASS", orderId).run();
  }
}

export async function processNovaHairOrderWebhook(orderPayload: any, db: any): Promise<{ handled: boolean; reason?: string }> {
  const state = await getNovaHairState(db);
  state.lastWebhookTimestamp = new Date().toISOString();

  const orderNum = String(orderPayload.name || orderPayload.order_number || "").replace("#", "");
  const orderGid = String(orderPayload.admin_graphql_api_id || `gid://shopify/Order/${orderPayload.id}`);

  // 1. Exclude historical orders
  if (EXCLUDED_ORDER_NUMBERS.has(orderNum)) {
    return { handled: false, reason: `Excluded historical order #${orderNum}` };
  }

  // 2. Exclude test tags
  const tags = String(orderPayload.tags || "");
  if (EXCLUDED_TAG_KEYWORDS.some(kw => tags.includes(kw))) {
    return { handled: false, reason: `Excluded tagged test order #${orderNum}` };
  }

  // 3. Check idempotency
  if (state.seenOrderIds.includes(orderGid)) {
    return { handled: false, reason: `Order ${orderGid} already processed (idempotent)` };
  }

  // 4. Plan the parcel from every line CJ ships: bundle, extra bottles, add-ons.
  const lineItems: any[] = orderPayload.line_items || [];
  const planned = planSupplierOrder(lineItems);

  if (!planned.ok) {
    if (planned.code === "NO_SUPPLIER_LINES") {
      return { handled: false, reason: `Order #${orderNum} does not contain NovaHair or OceAura bundle lines.` };
    }
    // A line this code cannot read, or a product CJ cannot supply, is parked
    // where the dashboard and the morning digest will show it. Answering "not
    // handled" is how #4481 sat paid and unordered with nothing saying so.
    await enqueuePendingOrder(orderPayload, { original_sku: planned.sku, reason: planned.reason } as any, db, {
      syncState: "NEEDS_SUPPLIER_MAPPING",
      result: planned.reason,
    });
    await saveNovaHairState(db, state);
    return { handled: true, reason: planned.reason };
  }

  // Enqueue in D1 durable pending table
  await enqueuePendingOrder(orderPayload, planned.expected, db);
  await saveNovaHairState(db, state);
  return { handled: true, bundle: planned.expected } as any;
}

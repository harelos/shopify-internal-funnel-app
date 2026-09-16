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
  BOTTLE_KEYS,
  decodeBundleSku,
  isNovaHairBundleSku,
  BOTTLE_ORDER_BY_SEGMENTS,
  buildNovaHairCjCreateOrderPayload,
  CJ_PHYSICAL_MAPPINGS,
  novaHairAutoCjOrderNumber,
  type ExpectedBundle,
  type NovaHairComponentKey,
} from "../lib/novahair-cj-auto-order.js";

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

async function findCjOrderForNovaHair(orderNum: string, rawId: string, preferAuto: boolean): Promise<any | null> {
  const autoOrderNumber = novaHairAutoCjOrderNumber(orderNum);
  const listRes = await cjGet("shopping/order/list", { pageNum: 1, pageSize: 100 });
  const orders = listRes?.data?.list || [];
  if (!Array.isArray(orders)) return null;

  const autoOrder = orders.find((o: any) => String(o.orderNum || o.orderNumber || "") === autoOrderNumber);
  if (autoOrder || preferAuto) return autoOrder || null;

  return orders.find((o: any) =>
    String(o.platformOrderId || "") === String(rawId) ||
    String(o.orderNum || o.orderNumber || "").endsWith(orderNum)
  ) || null;
}

async function ensureAutoCjOrder(orderPayload: any, expected: ExpectedBundle, orderNum: string, rawId: string): Promise<any | null> {
  const existing = await findCjOrderForNovaHair(orderNum, rawId, true);
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

export async function enqueuePendingOrder(orderPayload: any, expected: ExpectedBundle, db: any): Promise<void> {
  const orderId = String(orderPayload.admin_graphql_api_id || `gid://shopify/Order/${orderPayload.id}`);
  const orderNum = String(orderPayload.name || orderPayload.order_number || "").replace("#", "");
  const rawId = String(orderPayload.id || orderId.replace(/^gid:\/\/shopify\/Order\//, ""));

  await db.prepare(`
    INSERT OR REPLACE INTO "NovaHairPendingOrder" (orderId, orderNum, rawId, syncState, expectedData, orderPayload, attempts, firstSeenAt, lastAttemptAt)
    VALUES (?, ?, ?, 'WAITING_FOR_CJ_SYNC', ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(orderId, orderNum, rawId, JSON.stringify(expected), JSON.stringify(orderPayload)).run();

  console.log(`[D1 QUEUE] Enqueued Order #${orderNum} for durable background CJ verification.`);
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
    const expected: ExpectedBundle = JSON.parse(row.expectedData);
    const orderPayload = JSON.parse(row.orderPayload);
    const attempts = Number(row.attempts || 0) + 1;
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
        cjOrder = await ensureAutoCjOrder(orderPayload, expected, orderNum, rawId);
        await db.prepare(`
          UPDATE "NovaHairPendingOrder"
          SET syncState = ?, attempts = ?, lastAttemptAt = CURRENT_TIMESTAMP
          WHERE orderId = ?
        `).bind("CJ_AUTO_CREATED", attempts, orderId).run();
      } else {
        cjOrder = await findCjOrderForNovaHair(orderNum, rawId, false);
      }
    } catch (err) {
      console.warn(`[CRON CJ AUTO/POLL TRANSIENT ERROR] Order #${orderNum}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      // An address CJ will not accept is not a transient error: retrying it
      // three times and giving up is how orders died silently for days.
      const state = isAddressRejection(message) ? "NEEDS_ADDRESS_FIX" : "CJ_AUTO_CREATE_FAILED";
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

    const cjQuantities: Record<string, number> = Object.fromEntries(
      (Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[]).map(key => [key, 0]),
    );
    const keyByVid = new Map<string, NovaHairComponentKey>(
      (Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[]).map(key => [CJ_PHYSICAL_MAPPINGS[key].vid, key]),
    );

    let vidError: string | null = null;
    for (const item of productList) {
      const key = keyByVid.get(String(item.vid));
      if (!key) { vidError = item.vid; break; }
      cjQuantities[key] += Number(item.quantity || 0);
    }

    if (vidError) {
      await triggerCloudCircuitBreaker(`Unknown CJ VID found in order: ${vidError}`, orderPayload, "Known 6 Canonical VIDs", vidError, db);
      await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
        .bind("CIRCUIT_BREAKER_TRIGGERED", "FAIL", orderId).run();
      return;
    }

    const mismatches: string[] = [];
    for (const shade of Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[]) {
      const exp = expected[shade];
      const act = cjQuantities[shade];
      if (exp !== act) mismatches.push(`${shade}: expected ${exp}, got ${act}`);
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
    const costAmount = Number(cjData.orderAmount);
    const costDateSource = orderPayload.processed_at || orderPayload.created_at || orderRecord.verified_at;
    const costDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: getEnvVar("REPORTING_TIMEZONE", "Asia/Jerusalem"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(costDateSource));
    if (Number.isFinite(costAmount) && costAmount >= 0) {
      await persistFinancialLedgerEntries([{
        source: "CJ_ORDER_COSTS",
        category: "CJ_VARIABLE_COST",
        externalKey: orderId,
        occurredDate: costDate,
        amount: costAmount,
        currency: "USD",
        quality: "ESTIMATE",
        metadata: { orderNumber: orderNum, costLabel: orderRecord.cost_label },
      }]);
    }
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

  // 4. Identify bundle line items
  const lineItems: any[] = orderPayload.line_items || [];
  let expectedBundle: ExpectedBundle | null = null;

  for (const li of lineItems) {
    const sku = String(li.sku || "");
    if (isNovaHairBundleSku(sku)) {
      expectedBundle = decodeBundleSku(sku, Number(li.quantity || 1));
      break;
    }
  }

  if (!expectedBundle) {
    const shopifyComponents: Record<string, number> = {};
    for (const li of lineItems) {
      const s = String(li.sku || "");
      const q = Number(li.quantity || 0);
      const key = (Object.keys(CJ_PHYSICAL_MAPPINGS) as NovaHairComponentKey[])
        .find(candidate => CJ_PHYSICAL_MAPPINGS[candidate].sku === s);
      if (key) shopifyComponents[key] = q;
    }

    if (shopifyComponents.free_kit && shopifyComponents.free_kit > 0) {
      const bottleSum = BOTTLE_KEYS.reduce((sum, key) => sum + (shopifyComponents[key] || 0), 0);
      expectedBundle = {
        bundle_size: bottleSum,
        black: shopifyComponents.black || 0,
        dark_brown: shopifyComponents.dark_brown || 0,
        medium_brown: shopifyComponents.medium_brown || 0,
        light_brown: shopifyComponents.light_brown || 0,
        purple: shopifyComponents.purple || 0,
        red: shopifyComponents.red || 0,
        free_kit: shopifyComponents.free_kit || 1,
        expected_weight_g: (bottleSum * 330.0) + ((shopifyComponents.free_kit || 1) * 110.0),
        original_sku: `DECOMPOSED-BUNDLE-${bottleSum}B`
      };
    }
  }

  if (!expectedBundle) {
    return { handled: false, reason: `Order #${orderNum} does not contain NovaHair bundle lines.` };
  }

  // Enqueue in D1 durable pending table
  await enqueuePendingOrder(orderPayload, expectedBundle, db);
  await saveNovaHairState(db, state);
  return { handled: true, bundle: expectedBundle } as any;
}

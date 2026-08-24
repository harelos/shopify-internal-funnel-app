import { env as cloudflareEnv } from "cloudflare:workers";

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

export interface ExpectedBundle {
  bundle_size: number;
  black: number;
  dark_brown: number;
  light_brown: number;
  purple: number;
  red: number;
  free_kit: number;
  expected_weight_g: number;
  original_sku: string;
}

export const CJ_PHYSICAL_MAPPINGS = {
  black: { vid: "2412030839551624000", sku: "CJYD223160001AZ", name: "Black", weight_g: 330.0 },
  dark_brown: { vid: "2412030839551624200", sku: "CJYD223160002BY", name: "Dark Brown", weight_g: 330.0 },
  light_brown: { vid: "2412030839551624400", sku: "CJYD223160003CX", name: "Light Brown", weight_g: 330.0 },
  purple: { vid: "2412030839551624700", sku: "CJYD223160005EV", name: "Purple", weight_g: 330.0 },
  red: { vid: "2412030839551624600", sku: "CJYD223160004DW", name: "Red", weight_g: 330.0 },
  free_kit: { vid: "ED56BD86-3AF9-4E8E-9855-FBD046D33613", sku: "CJBJMRPF00756-Suit", name: "Free Kit", weight_g: 110.0 }
};

const REGEX_NOVASALE = /^NOVASALE-(2|4|6)-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/;
const EXCLUDED_ORDER_NUMBERS = new Set(["4359", "4360", "4361", "4362"]);
const EXCLUDED_TAG_KEYWORDS = ["INTERNAL_", "TEST", "CANARY", "BOOTSTRAP", "DO_NOT_FULFILL"];
const PRODUCT_ID = "gid://shopify/Product/10341269274919";
const SHOP_DOMAIN = "jacobfelipe.myshopify.com";
const CJ_AUTH_URL = "https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken";

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

export function decodeBundleSku(sku: string, parentQuantity: number = 1): ExpectedBundle | null {
  const m = REGEX_NOVASALE.exec(sku);
  if (!m) return null;
  const bundleSize = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  const db = parseInt(m[3], 10);
  const lb = parseInt(m[4], 10);
  const p = parseInt(m[5], 10);
  const r = parseInt(m[6], 10);
  if (b + db + lb + p + r !== bundleSize) return null;

  return {
    bundle_size: bundleSize * parentQuantity,
    black: b * parentQuantity,
    dark_brown: db * parentQuantity,
    light_brown: lb * parentQuantity,
    purple: p * parentQuantity,
    red: r * parentQuantity,
    free_kit: 1 * parentQuantity,
    expected_weight_g: (bundleSize * parentQuantity * 330.0) + (1 * parentQuantity * 110.0),
    original_sku: sku
  };
}

async function shopifyGql(query: string, variables: any = {}): Promise<any> {
  const token = getEnvVar("SHOPIFY_ADMIN_ACCESS_TOKEN");
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

async function getCjToken(): Promise<string> {
  const apiKey = getEnvVar("CJ_API_KEY");
  const res = await fetch(CJ_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey })
  });
  const data: any = await res.json();
  return data?.data?.accessToken || "";
}

async function cjGet(endpoint: string, params: Record<string, any> = {}): Promise<any> {
  const token = await getCjToken();
  const url = new URL(`https://developers.cjdropshipping.com/api2.0/v1/${endpoint}`);
  Object.keys(params).forEach(k => url.searchParams.append(k, String(params[k])));
  const res = await fetch(url.toString(), {
    headers: {
      "CJ-Access-Token": token,
      "Content-Type": "application/json"
    }
  });
  return res.json();
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

export async function processPendingQueueCron(db: any): Promise<void> {
  const pendingRows = await db.prepare(`
    SELECT * FROM "NovaHairPendingOrder"
    WHERE syncState IN ('WAITING_FOR_CJ_SYNC', 'CJ_SYNC_DELAYED')
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
    const firstSeen = new Date(row.firstSeenAt).getTime();
    const elapsedSeconds = Math.floor((Date.now() - firstSeen) / 1000);

    let cjOrder: any = null;
    try {
      const listRes = await cjGet("shopping/order/list", { pageNum: 1, pageSize: 20 });
      const orders = listRes?.data?.list || [];
      for (const o of orders) {
        if (String(o.platformOrderId) === String(rawId) || String(o.orderNum).endsWith(orderNum)) {
          cjOrder = o;
          break;
        }
      }
    } catch (err) {
      console.warn(`[CRON CJ POLL TRANSIENT ERROR] Order #${orderNum}:`, err);
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

    const cjQuantities: Record<string, number> = {
      black: 0, dark_brown: 0, light_brown: 0, purple: 0, red: 0, free_kit: 0
    };

    let vidError: string | null = null;
    for (const item of productList) {
      const vid = item.vid;
      const qty = Number(item.quantity || 0);
      if (vid === CJ_PHYSICAL_MAPPINGS.black.vid) cjQuantities.black += qty;
      else if (vid === CJ_PHYSICAL_MAPPINGS.dark_brown.vid) cjQuantities.dark_brown += qty;
      else if (vid === CJ_PHYSICAL_MAPPINGS.light_brown.vid) cjQuantities.light_brown += qty;
      else if (vid === CJ_PHYSICAL_MAPPINGS.purple.vid) cjQuantities.purple += qty;
      else if (vid === CJ_PHYSICAL_MAPPINGS.red.vid) cjQuantities.red += qty;
      else if (vid === CJ_PHYSICAL_MAPPINGS.free_kit.vid) cjQuantities.free_kit += qty;
      else {
        vidError = vid;
        break;
      }
    }

    if (vidError) {
      await triggerCloudCircuitBreaker(`Unknown CJ VID found in order: ${vidError}`, orderPayload, "Known 6 Canonical VIDs", vidError, db);
      await db.prepare('UPDATE "NovaHairPendingOrder" SET syncState = ?, result = ?, completedAt = CURRENT_TIMESTAMP WHERE orderId = ?')
        .bind("CIRCUIT_BREAKER_TRIGGERED", "FAIL", orderId).run();
      return;
    }

    const mismatches: string[] = [];
    for (const shade of ["black", "dark_brown", "light_brown", "purple", "red", "free_kit"] as const) {
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
    if (REGEX_NOVASALE.test(sku)) {
      expectedBundle = decodeBundleSku(sku, Number(li.quantity || 1));
      break;
    }
  }

  if (!expectedBundle) {
    const shopifyComponents: Record<string, number> = {};
    for (const li of lineItems) {
      const s = String(li.sku || "");
      const q = Number(li.quantity || 0);
      if (s === CJ_PHYSICAL_MAPPINGS.black.sku) shopifyComponents.black = q;
      else if (s === CJ_PHYSICAL_MAPPINGS.dark_brown.sku) shopifyComponents.dark_brown = q;
      else if (s === CJ_PHYSICAL_MAPPINGS.light_brown.sku) shopifyComponents.light_brown = q;
      else if (s === CJ_PHYSICAL_MAPPINGS.purple.sku) shopifyComponents.purple = q;
      else if (s === CJ_PHYSICAL_MAPPINGS.red.sku) shopifyComponents.red = q;
      else if (s === CJ_PHYSICAL_MAPPINGS.free_kit.sku) shopifyComponents.free_kit = q;
    }

    if (shopifyComponents.free_kit && shopifyComponents.free_kit > 0) {
      const bottleSum = (shopifyComponents.black || 0) + (shopifyComponents.dark_brown || 0) +
                        (shopifyComponents.light_brown || 0) + (shopifyComponents.purple || 0) + (shopifyComponents.red || 0);
      expectedBundle = {
        bundle_size: bottleSum,
        black: shopifyComponents.black || 0,
        dark_brown: shopifyComponents.dark_brown || 0,
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

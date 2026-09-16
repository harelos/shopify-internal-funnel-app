import { supportD1 } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { decodeBundleSku } from "../lib/novahair-cj-auto-order.js";
import { enqueuePendingOrder, getD1, listCjOrders } from "./novahair-monitor.js";

/**
 * Finds paid orders that never reached CJ and puts them back in the queue.
 *
 * Nothing watched for this. An order is enqueued by its webhook, and if the
 * bundle SKU could not be decoded — which is what happened when a sixth shade
 * was added — it was never enqueued at all, so no retry, no failure row, and no
 * sign of it anywhere. Five paid orders in one day sat with nothing ordered
 * from the supplier and nobody knew.
 *
 * Placing a duplicate supplier order costs real money, so an order is enqueued
 * only when CJ holds no order for it under any of the prefixes the sync worker
 * files them under, and when nothing is already queued for it here.
 */
const shopify = new ShopifyAdminClient();
const LOOKBACK_DAYS = 10;
const MAX_PER_RUN = 10;
const CJ_PAGES = 3;

export interface CjBackfillResult {
  scanned: number;
  alreadyAtCj: number;
  alreadyQueued: number;
  enqueued: string[];
  undecodable: string[];
  skipped: string;
}

export async function reconcileMissingCjOrders(options: { dryRun?: boolean } = {}): Promise<CjBackfillResult> {
  const result: CjBackfillResult = { scanned: 0, alreadyAtCj: 0, alreadyQueued: 0, enqueued: [], undecodable: [], skipped: "" };
  if (workerEnvValue("NOVAHAIR_CJ_AUTO_CREATE_ENABLED") !== "true") {
    return { ...result, skipped: "auto_create_disabled" };
  }
  const db = supportD1();
  if (!db) return { ...result, skipped: "no_database" };

  const from = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const orders = (await shopify.ordersForCjCosts({ from }).catch(() => null))?.orders ?? [];
  result.scanned = orders.length;
  if (!orders.length) return result;

  // Every order number CJ already holds, whatever prefix it was filed under.
  const atCj = new Set<string>();
  for (let page = 1; page <= CJ_PAGES; page += 1) {
    let rows: any[] = [];
    try { rows = await listCjOrders(page, 100); } catch { break; }
    for (const row of rows) {
      const match = /^(?:RESCUE|AUTO|MANUAL|BACKFILL)-(\d+)$/i.exec(String(row?.orderNum || "").trim());
      if (match && !/trash/i.test(String(row?.orderStatus || ""))) atCj.add(match[1]);
    }
    if (rows.length < 100) break;
  }
  // A shadow row means the store connection saw it, not that anything was
  // bought, so only the purchase prefixes count as "already at CJ".

  // A row that exhausted its retries is a dead record, not work in progress.
  // Counting it as queued is how orders stayed stuck for days: the queue had
  // given up on them and nothing else would look at them again. The CJ check
  // above is what prevents a duplicate, not this.
  const queued = new Set<string>();
  const pending = await db.prepare(`SELECT "orderNum" FROM "NovaHairPendingOrder"
    WHERE NOT ("syncState" = 'CJ_AUTO_CREATE_FAILED' AND "attempts" >= 3)`)
    .all<{ orderNum: string }>().catch(() => null);
  for (const row of pending?.results || []) queued.add(String(row.orderNum).replace(/^#/, ""));

  const minOrderNumber = Number(workerEnvValue("NOVAHAIR_CJ_AUTO_CREATE_MIN_ORDER_NUMBER")) || 0;
  for (const order of orders) {
    if (result.enqueued.length >= MAX_PER_RUN) break;
    const number = String(order.name || "").replace(/^#/, "");
    if (!/^\d+$/.test(number) || Number(number) < minOrderNumber) continue;
    if (atCj.has(number)) { result.alreadyAtCj += 1; continue; }
    if (queued.has(number)) { result.alreadyQueued += 1; continue; }

    const bundleLine = (order.lineItems || []).find(item => item.sku && decodeBundleSku(String(item.sku)));
    if (!bundleLine) { result.undecodable.push(order.name || number); continue; }
    const expected = decodeBundleSku(String(bundleLine.sku), Number(bundleLine.quantity) || 1);
    if (!expected) { result.undecodable.push(order.name || number); continue; }

    if (options.dryRun) { result.enqueued.push(order.name || number); continue; }
    // The full order payload is what the queue replays, so it is read fresh
    // rather than rebuilt from the summary above.
    const payload = await shopify.orderPayloadForFulfilment(order.legacyResourceId).catch(() => null);
    if (!payload) { result.undecodable.push(order.name || number); continue; }
    await enqueuePendingOrder(payload, expected, getD1());
    result.enqueued.push(order.name || number);
  }
  return result;
}

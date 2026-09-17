import { supportD1 } from "../lib/support-d1.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { purchasedCjOrdersByNumber, readCjOrderIndex } from "../lib/cj-order-index.js";
import { planSupplierOrder } from "../lib/supplier-order-plan.js";
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
 * Placing a duplicate supplier order costs real money, so this acts only on a
 * complete reading of CJ's list. On 2026-09-17 a CJ timeout truncated that
 * list at page two; the sweep took the rest of CJ as empty and placed six
 * orders for parcels that had already shipped. A CJ read that fails or stops
 * short now skips the whole sweep, and the next run tries again.
 */
const shopify = new ShopifyAdminClient();
const LOOKBACK_DAYS = 10;
const MAX_PER_RUN = 10;
const CJ_PAGES = 12;

export interface CjBackfillResult {
  scanned: number;
  alreadyAtCj: number;
  alreadyQueued: number;
  enqueued: string[];
  /** Orders whose lines name a product CJ cannot supply, or a SKU this code cannot read; parked for a person. */
  needsMapping: string[];
  /** Parked orders that now decode cleanly and were released back to the queue. */
  released: string[];
  /** Orders with nothing CJ ships (another supplier's goods). */
  notSupplierOrders: number;
  /** How much of CJ's list the sweep had to read to cover the window. */
  cjPages: number;
  cjRows: number;
  skipped: string;
}

export async function reconcileMissingCjOrders(options: { dryRun?: boolean } = {}): Promise<CjBackfillResult> {
  const result: CjBackfillResult = {
    scanned: 0, alreadyAtCj: 0, alreadyQueued: 0, enqueued: [], needsMapping: [], released: [], notSupplierOrders: 0, cjPages: 0, cjRows: 0, skipped: "",
  };
  if (workerEnvValue("NOVAHAIR_CJ_AUTO_CREATE_ENABLED") !== "true") {
    return { ...result, skipped: "auto_create_disabled" };
  }
  const db = supportD1();
  if (!db) return { ...result, skipped: "no_database" };

  // Parked orders are planned again from their own lines: once a mapping
  // lands in code, they release themselves instead of waiting for a database
  // edit that nobody remembers to make.
  const held = await db.prepare(`SELECT "orderId", "orderNum", "orderPayload" FROM "NovaHairPendingOrder"
    WHERE "syncState" = 'NEEDS_SUPPLIER_MAPPING'`).all<{ orderId: string; orderNum: string; orderPayload: string }>().catch(() => null);
  for (const row of held?.results || []) {
    let lines: any[] = [];
    try { lines = JSON.parse(String(row.orderPayload || "{}"))?.line_items || []; } catch { continue; }
    const planned = planSupplierOrder(lines);
    if (!planned.ok) continue;
    if (!options.dryRun) {
      await db.prepare(`UPDATE "NovaHairPendingOrder"
        SET "syncState" = 'WAITING_FOR_CJ_SYNC', "expectedData" = ?, "attempts" = 0, "result" = NULL, "lastAttemptAt" = CURRENT_TIMESTAMP
        WHERE "orderId" = ?`).bind(JSON.stringify(planned.expected), row.orderId).run();
    }
    result.released.push(`#${String(row.orderNum).replace(/^#/, "")}`);
  }

  const from = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();

  // Every order CJ holds since the window began, or nothing at all.
  let atCj: Map<string, unknown[]>;
  try {
    const index = await readCjOrderIndex({
      list: listCjOrders,
      since: new Date(new Date(from).getTime() - 86400000).toISOString(),
      maxPages: CJ_PAGES,
    });
    result.cjPages = index.pages;
    result.cjRows = index.rows.length;
    if (!index.complete) return { ...result, skipped: "cj_list_incomplete" };
    atCj = purchasedCjOrdersByNumber(index.rows);
  } catch (error) {
    return { ...result, skipped: `cj_list_failed: ${String((error as Error)?.message || error).slice(0, 160)}` };
  }

  const orders = (await shopify.ordersForCjCosts({ from }).catch(() => null))?.orders ?? [];
  result.scanned = orders.length;
  if (!orders.length) return result;

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
    const label = order.name || number;
    if (!/^\d+$/.test(number) || Number(number) < minOrderNumber) continue;
    if (atCj.has(number)) { result.alreadyAtCj += 1; continue; }
    if (queued.has(number)) { result.alreadyQueued += 1; continue; }

    const planned = planSupplierOrder(order.lineItems || []);
    if (!planned.ok && planned.code === "NO_SUPPLIER_LINES") { result.notSupplierOrders += 1; continue; }

    if (options.dryRun) {
      (planned.ok ? result.enqueued : result.needsMapping).push(label);
      continue;
    }
    // The full order payload is what the queue replays, so it is read fresh
    // rather than rebuilt from the summary above.
    const payload = await shopify.orderPayloadForFulfilment(order.legacyResourceId).catch(() => null);
    if (!payload) { result.needsMapping.push(`${label} (payload unavailable)`); continue; }
    if (planned.ok) {
      await enqueuePendingOrder(payload, planned.expected, getD1());
      result.enqueued.push(label);
    } else {
      // Parked where the dashboard and the morning digest will show it.
      await enqueuePendingOrder(payload, { original_sku: planned.sku, reason: planned.reason } as any, getD1(), {
        syncState: "NEEDS_SUPPLIER_MAPPING",
        result: planned.reason,
      });
      result.needsMapping.push(label);
    }
  }
  return result;
}

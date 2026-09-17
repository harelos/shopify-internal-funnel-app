import { auditSupplierCosts, type SupplierCostAudit } from "../lib/cj-cost-audit.js";
import { readCjOrderIndex } from "../lib/cj-order-index.js";
import { financialD1 } from "../lib/financial-ledger.js";
import { getGrowthCockpitConfig, resolveGrowthCockpitRange } from "../lib/growth-cockpit-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { listCjOrders } from "./novahair-monitor.js";

const shopify = new ShopifyAdminClient();

export interface CjCostAuditReport extends SupplierCostAudit {
  window: { localFrom: string; localTo: string; timezone: string };
  cjList: { read: boolean; complete: boolean; rows: number; note: string | null };
  /** Orders parked because a line names a product CJ has no mapping for. */
  needsMapping: Array<{ order: string; reason: string }>;
  generatedAt: string;
}

function shiftDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The daily check that the cost ledger says what the sales say.
 *
 * Runs the pure audit over live inputs: Shopify's paid sales for the window,
 * the ledger rows that could belong to them (thirty days back, so a row
 * dated wrongly is still found), and CJ's order list read back to the start
 * of the window for the duplicate check. A CJ read that fails or stops short
 * is reported as such rather than read as "no duplicates".
 */
export async function auditCjSupplierCosts(options: { days?: number; now?: Date } = {}): Promise<CjCostAuditReport> {
  const config = getGrowthCockpitConfig(workerEnvValue);
  const timezone = config.reportingTimezone;
  const days = Math.max(1, Math.min(30, Math.floor(options.days ?? 7)));
  const now = options.now ?? new Date();
  const today = resolveGrowthCockpitRange({ preset: "today", timezone, now });
  const localTo = String(today.localTo);
  const localFrom = shiftDate(localTo, -(days - 1));
  const range = resolveGrowthCockpitRange({ from: localFrom, to: localTo, timezone, now });
  if (!range.from || !range.toExclusive) throw new Error("The audit window did not resolve to instants.");

  const sales = (await shopify.ordersForCjCosts({ from: range.from, toExclusive: range.toExclusive })).orders;

  const db = financialD1();
  const ledger = db
    ? await db.prepare(`SELECT externalKey, occurredDate, amount, metadata FROM "FinancialLedgerEntry"
        WHERE source = 'CJ_ORDER_COSTS' AND category = 'CJ_VARIABLE_COST' AND occurredDate >= ?`)
      .bind(shiftDate(localFrom, -30)).all()
    : { results: [] as any[] };
  const ledgerRows = ((ledger.results ?? []) as any[]).map(row => ({
    externalKey: String(row.externalKey),
    occurredDate: String(row.occurredDate),
    amount: row.amount,
    metadata: row.metadata == null ? null : String(row.metadata),
  }));

  let cjRows: any[] | null = null;
  let cjList: CjCostAuditReport["cjList"] = { read: false, complete: false, rows: 0, note: null };
  try {
    const index = await readCjOrderIndex({ list: listCjOrders, since: range.from, maxPages: 12 });
    cjRows = index.complete ? index.rows : null;
    cjList = {
      read: true,
      complete: index.complete,
      rows: index.rows.length,
      note: index.complete ? null : "CJ's order list was cut off before reaching the start of the window; the duplicate check did not run.",
    };
  } catch (error) {
    cjList = { read: false, complete: false, rows: 0, note: `CJ order list unavailable: ${String((error as Error)?.message || error).slice(0, 160)}` };
  }

  const held = db
    ? await db.prepare(`SELECT "orderNum", "result" FROM "NovaHairPendingOrder" WHERE "syncState" = 'NEEDS_SUPPLIER_MAPPING' ORDER BY "firstSeenAt" ASC`)
      .bind().all().catch(() => ({ results: [] as any[] }))
    : { results: [] as any[] };
  const needsMapping = ((held.results ?? []) as any[]).map(row => ({
    order: `#${String(row.orderNum || "").replace(/^#/, "")}`,
    reason: String(row.result || "").slice(0, 200),
  }));

  const audit = auditSupplierCosts({ sales, ledgerRows, cjRows, timezone });
  return {
    ...audit,
    ok: audit.ok && needsMapping.length === 0,
    window: { localFrom, localTo, timezone },
    cjList,
    needsMapping,
    generatedAt: now.toISOString(),
  };
}

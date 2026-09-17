import { env as cloudflareEnv } from "cloudflare:workers";
import type { DailyCoverageRow } from "./financial-window.js";
import type { FinancialMetric, FinancialQuality } from "./growth-cockpit-finance.js";

type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results?: any[] }> } };
};

export interface FinancialLedgerEntryInput {
  source: string;
  category: string;
  externalKey: string;
  occurredDate: string;
  amount: number;
  currency: string;
  quality: FinancialQuality;
  metadata?: Record<string, unknown>;
}

export interface FinancialLedgerCoverageInput {
  source: string;
  category: string;
  localFrom: string | null;
  localTo: string | null;
  amount: number;
  currency: string;
  quality: FinancialQuality;
  rowCount: number;
  metadata?: Record<string, unknown>;
}

export function financialD1(): D1Like | null {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.DB ?? null;
}

function safeJson(value: Record<string, unknown> | undefined): string {
  return JSON.stringify(value ?? {}).slice(0, 4000);
}

function entryId(entry: FinancialLedgerEntryInput): string {
  return `${entry.source}:${entry.category}:${entry.externalKey}`;
}

export async function persistFinancialLedgerEntries(entries: FinancialLedgerEntryInput[]): Promise<number> {
  const db = financialD1();
  if (!db || !entries.length) return 0;
  let saved = 0;
  for (const entry of entries) {
    if (!Number.isFinite(entry.amount) || entry.amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(entry.occurredDate)) continue;
    await db.prepare(`
      INSERT INTO "FinancialLedgerEntry"
        (id, source, category, externalKey, occurredDate, amount, currency, quality, metadata, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(source, category, externalKey) DO UPDATE SET
        occurredDate = excluded.occurredDate,
        amount = excluded.amount,
        currency = excluded.currency,
        quality = excluded.quality,
        metadata = excluded.metadata,
        updatedAt = CURRENT_TIMESTAMP
    `).bind(
      entryId(entry), entry.source, entry.category, entry.externalKey, entry.occurredDate,
      entry.amount, entry.currency.toUpperCase(), entry.quality, safeJson(entry.metadata),
    ).run();
    saved += 1;
  }
  return saved;
}

export async function persistFinancialLedgerCoverage(coverage: FinancialLedgerCoverageInput): Promise<void> {
  const db = financialD1();
  if (!db || !Number.isFinite(coverage.amount) || coverage.amount < 0) return;
  const rangeKey = `${coverage.localFrom ?? "all"}:${coverage.localTo ?? "all"}`;
  const id = `${coverage.source}:${coverage.category}:${rangeKey}`;
  await db.prepare(`
    INSERT INTO "FinancialLedgerCoverage"
      (id, source, category, rangeKey, localFrom, localTo, amount, currency, quality, rowCount, reconciledAt, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    ON CONFLICT(source, category, rangeKey) DO UPDATE SET
      amount = excluded.amount,
      currency = excluded.currency,
      quality = excluded.quality,
      rowCount = excluded.rowCount,
      reconciledAt = CURRENT_TIMESTAMP,
      metadata = excluded.metadata
  `).bind(
    id, coverage.source, coverage.category, rangeKey, coverage.localFrom, coverage.localTo,
    coverage.amount, coverage.currency.toUpperCase(), coverage.quality, coverage.rowCount, safeJson(coverage.metadata),
  ).run();
}

export async function hasRecentFinancialCoverage(input: {
  source: string;
  category: string;
  localFrom: string | null;
  localTo: string | null;
  maxAgeMs: number;
}): Promise<boolean> {
  const db = financialD1();
  if (!db) return false;
  const rangeKey = `${input.localFrom ?? "all"}:${input.localTo ?? "all"}`;
  const result = await db.prepare(`
    SELECT reconciledAt FROM "FinancialLedgerCoverage"
    WHERE source = ? AND category = ? AND rangeKey = ? LIMIT 1
  `).bind(input.source, input.category, rangeKey).all();
  const value = result.results?.[0]?.reconciledAt;
  if (!value) return false;
  const timestamp = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") ? "" : "Z")).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < input.maxAgeMs;
}

export async function aggregateFinancialLedger(input: {
  source: string;
  category: string;
  localFrom: string | null;
  localTo: string | null;
  note: string;
}): Promise<FinancialMetric> {
  const db = financialD1();
  if (!db) return { amount: null, currency: null, quality: "MISSING", source: input.source, note: "D1 financial ledger is unavailable." };
  const conditions = ["source = ?", "category = ?"];
  const values: unknown[] = [input.source, input.category];
  if (input.localFrom) { conditions.push("occurredDate >= ?"); values.push(input.localFrom); }
  if (input.localTo) { conditions.push("occurredDate <= ?"); values.push(input.localTo); }
  const result = await db.prepare(`
    SELECT amount, currency, quality FROM "FinancialLedgerEntry"
    WHERE ${conditions.join(" AND ")}
  `).bind(...values).all();
  const rows = result.results ?? [];
  if (!rows.length) return { amount: null, currency: null, quality: "MISSING", source: input.source, note: input.note };
  const currencies = [...new Set(rows.map(row => String(row.currency).toUpperCase()))];
  return {
    amount: currencies.length === 1 ? Number(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)) : null,
    currency: currencies.length === 1 ? currencies[0] : null,
    quality: "PARTIAL",
    source: input.source,
    note: `${input.note} ${rows.length} persisted row(s); coverage is not authoritative for whole-store profit.`,
  };
}

export async function dailyFinancialLedger(input: {
  source: string;
  category: string;
  localFrom: string | null;
  localTo: string | null;
}): Promise<Array<{ date: string; amount: number; currency: string; quality: FinancialQuality }>> {
  const db = financialD1();
  if (!db) return [];
  const conditions = ["source = ?", "category = ?"];
  const values: unknown[] = [input.source, input.category];
  if (input.localFrom) { conditions.push("occurredDate >= ?"); values.push(input.localFrom); }
  if (input.localTo) { conditions.push("occurredDate <= ?"); values.push(input.localTo); }
  const result = await db.prepare(`
    SELECT occurredDate, amount, currency, quality FROM "FinancialLedgerEntry"
    WHERE ${conditions.join(" AND ")}
    ORDER BY occurredDate ASC
  `).bind(...values).all();
  const byDate = new Map<string, { amount: number; currencies: Set<string>; qualities: Set<FinancialQuality> }>();
  for (const row of result.results ?? []) {
    const date = String(row.occurredDate);
    const current = byDate.get(date) ?? { amount: 0, currencies: new Set<string>(), qualities: new Set<FinancialQuality>() };
    current.amount += Number(row.amount || 0);
    current.currencies.add(String(row.currency).toUpperCase());
    current.qualities.add(String(row.quality) as FinancialQuality);
    byDate.set(date, current);
  }
  return [...byDate.entries()].flatMap(([date, value]) => value.currencies.size === 1 ? [{
    date,
    amount: Number(value.amount.toFixed(2)),
    currency: [...value.currencies][0]!,
    quality: value.qualities.has("ACTUAL") ? "ACTUAL" : "PARTIAL" as FinancialQuality,
  }] : []);
}

/**
 * Reads the single-day coverage rows a reconciler has written for a window.
 *
 * Coverage is keyed by its range, so a day settled by the cron is stored with
 * localFrom equal to localTo. Those rows are what make a long window a sum
 * instead of a live query over every order in it.
 */
export async function readDailyFinancialCoverage(input: {
  source: string;
  category: string;
  localFrom: string;
  localTo: string;
}): Promise<DailyCoverageRow[]> {
  const db = financialD1();
  if (!db) return [];
  const result = await db.prepare(`
    SELECT localFrom, amount, currency, quality, rowCount, metadata
    FROM "FinancialLedgerCoverage"
    WHERE source = ? AND category = ? AND localFrom = localTo
      AND localFrom >= ? AND localFrom <= ?
    ORDER BY localFrom ASC
  `).bind(input.source, input.category, input.localFrom, input.localTo).all();
  return (result.results ?? []).map((row: any) => {
    let orders: number | null = null;
    try {
      const metadata = row.metadata ? JSON.parse(String(row.metadata)) : null;
      if (metadata && Number.isFinite(Number(metadata.orders))) orders = Number(metadata.orders);
    } catch {
      orders = null;
    }
    return {
      localDate: String(row.localFrom),
      amount: Number(row.amount || 0),
      currency: String(row.currency || "").toUpperCase(),
      quality: String(row.quality || "MISSING") as FinancialQuality,
      rowCount: Number(row.rowCount || 0),
      orders,
    };
  });
}

/**
 * The recent average supplier cost per paid order, for estimating COGS on a
 * window CJ has not charged yet.
 *
 * CJ confirms the real cost hours to days after the sale, so a "today" window
 * with one fresh order otherwise shows no product cost and no profit at all.
 * Prefer charged actuals (CJ_PAID_ORDERS); fall back to the order-dated
 * estimate. Requires a few sample orders in one currency so the average is
 * stable rather than a single outlier.
 */
export async function trailingCogsPerOrder(input: { localFrom: string; localTo: string }): Promise<{ perOrder: number; currency: string; sampleOrders: number } | null> {
  const db = financialD1();
  if (!db) return null;
  for (const source of ["CJ_PAID_ORDERS", "CJ_ORDER_COSTS"]) {
    const result = await db.prepare(`
      SELECT COUNT(*) AS n, SUM(amount) AS total, MAX(currency) AS currency, COUNT(DISTINCT currency) AS currencies
      FROM "FinancialLedgerEntry"
      WHERE source = ? AND amount > 0 AND occurredDate >= ? AND occurredDate <= ?
    `).bind(source, input.localFrom, input.localTo).all();
    const row = (result.results ?? [])[0] as any;
    const n = Number(row?.n || 0);
    const total = Number(row?.total || 0);
    if (n >= 3 && Number(row?.currencies) === 1 && total > 0) {
      return { perOrder: Number((total / n).toFixed(4)), currency: String(row.currency).toUpperCase(), sampleOrders: n };
    }
  }
  return null;
}

export interface SupplierCostForRange extends FinancialMetric {
  /** Sales in the window that carry a CJ cost row. */
  pricedOrders: number;
  /** Priced from CJ's own order for that sale. */
  exactOrders: number;
  /** Priced from CJ's price for the identical bundle, because CJ has no order for the sale yet. */
  bundlePricedOrders: number;
}

/**
 * The supplier cost of the sales in a window, one row per sale.
 *
 * The generic aggregate reports PARTIAL for any row count, which made an exact
 * per-order total read as a guess. This reports what the rows actually are: how
 * many sales are priced, and how many of those came from CJ's own order rather
 * than from the identical bundle's CJ price.
 */
export async function supplierCostForRange(input: {
  localFrom: string | null;
  localTo: string | null;
}): Promise<SupplierCostForRange> {
  const empty: SupplierCostForRange = {
    amount: null, currency: null, quality: "MISSING", source: "CJ_ORDER_COSTS",
    note: "No CJ supplier cost has been recorded for the sales in this range.",
    pricedOrders: 0, exactOrders: 0, bundlePricedOrders: 0,
  };
  const db = financialD1();
  if (!db) return { ...empty, note: "D1 financial ledger is unavailable." };
  const conditions = ["source = ?", "category = ?"];
  const values: unknown[] = ["CJ_ORDER_COSTS", "CJ_VARIABLE_COST"];
  if (input.localFrom) { conditions.push("occurredDate >= ?"); values.push(input.localFrom); }
  if (input.localTo) { conditions.push("occurredDate <= ?"); values.push(input.localTo); }
  const result = await db.prepare(`
    SELECT amount, currency, metadata FROM "FinancialLedgerEntry"
    WHERE ${conditions.join(" AND ")} AND amount > 0
  `).bind(...values).all();
  const rows = (result.results ?? []) as Array<{ amount: number; currency: string; metadata: string }>;
  if (!rows.length) return empty;
  const currencies = [...new Set(rows.map(row => String(row.currency).toUpperCase()))];
  if (currencies.length !== 1) {
    return { ...empty, quality: "MISSING", note: `CJ cost rows span ${currencies.length} currencies and cannot be summed.` };
  }
  let exactOrders = 0;
  for (const row of rows) {
    let basis = "";
    try { basis = String(JSON.parse(row.metadata || "{}").costBasis || ""); } catch { basis = ""; }
    if (basis !== "CJ_BUNDLE_PRICE") exactOrders += 1;
  }
  const bundlePricedOrders = rows.length - exactOrders;
  const amount = Number(rows.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2));
  return {
    amount,
    currency: currencies[0],
    quality: "ACTUAL",
    source: "CJ_ORDER_COSTS",
    note: bundlePricedOrders
      ? `CJ charge for ${rows.length} order(s): ${exactOrders} from CJ's own order, ${bundlePricedOrders} at CJ's price for the identical bundle (not sent to CJ yet).`
      : `CJ charge for ${rows.length} order(s): product plus the shipping CJ quoted.`,
    pricedOrders: rows.length,
    exactOrders,
    bundlePricedOrders,
  };
}

import { env as cloudflareEnv } from "cloudflare:workers";
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

function financialD1(): D1Like | null {
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

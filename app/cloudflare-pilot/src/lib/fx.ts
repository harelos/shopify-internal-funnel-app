import { env as cloudflareEnv } from "cloudflare:workers";
import type { FxRateQuote } from "./growth-cockpit-finance.js";

type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; all(): Promise<{ results?: any[] }> } };
};

const DEFAULT_PROVIDER_URL = "https://open.er-api.com/v6/latest";
const STALE_RATE_MAX_AGE_DAYS = 7;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export type FxRateResolution = FxRateQuote;

function fxD1(): D1Like | null {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.DB ?? null;
}

function fxEnvValue(name: string): string {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return String(envObj?.[name] ?? process.env[name] ?? "").trim();
}

function utcDateLabel(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function daysBetween(fromLabel: string, toLabel: string): number {
  const from = Date.parse(`${fromLabel}T00:00:00Z`);
  const to = Date.parse(`${toLabel}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.POSITIVE_INFINITY;
  return Math.round((to - from) / 86400000);
}

async function readStoredRate(base: string, quote: string, rateDate?: string) {
  const db = fxD1();
  if (!db) return null;
  const sql = rateDate
    ? `SELECT "rateDate", "rate", "source" FROM "FxRateDaily" WHERE "baseCurrency" = ? AND "quoteCurrency" = ? AND "rateDate" = ? LIMIT 1`
    : `SELECT "rateDate", "rate", "source" FROM "FxRateDaily" WHERE "baseCurrency" = ? AND "quoteCurrency" = ? ORDER BY "rateDate" DESC LIMIT 1`;
  const bindings = rateDate ? [base, quote, rateDate] : [base, quote];
  try {
    const result = await db.prepare(sql).bind(...bindings).all();
    const row = result?.results?.[0];
    if (!row || !Number.isFinite(Number(row.rate)) || Number(row.rate) <= 0) return null;
    return { rateDate: String(row.rateDate), rate: Number(row.rate), source: String(row.source) };
  } catch {
    return null;
  }
}

async function persistRate(base: string, quote: string, rateDate: string, rate: number, source: string): Promise<void> {
  const db = fxD1();
  if (!db) return;
  try {
    await db.prepare(`
      INSERT INTO "FxRateDaily" ("id", "baseCurrency", "quoteCurrency", "rateDate", "rate", "source", "fetchedAt")
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("baseCurrency", "quoteCurrency", "rateDate") DO UPDATE SET
        "rate" = excluded."rate",
        "source" = excluded."source",
        "fetchedAt" = CURRENT_TIMESTAMP
    `).bind(`${base}:${quote}:${rateDate}`, base, quote, rateDate, rate, source).run();
  } catch {
    // A rate that cannot be cached is still usable for this request.
  }
}

async function fetchProviderRate(base: string, quote: string): Promise<{ rate: number; rateDate: string; source: string } | null> {
  const providerUrl = fxEnvValue("FX_RATE_PROVIDER_URL") || DEFAULT_PROVIDER_URL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${providerUrl}/${base}`, { signal: controller.signal });
    if (!response.ok) return null;
    const body: any = await response.json();
    if (body?.result && body.result !== "success") return null;
    const rate = Number(body?.rates?.[quote]);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    const published = body?.time_last_update_utc ? new Date(body.time_last_update_utc) : new Date();
    const rateDate = Number.isNaN(published.getTime()) ? utcDateLabel(new Date()) : utcDateLabel(published);
    let host = providerUrl;
    try { host = new URL(providerUrl).host; } catch { /* keep the configured value */ }
    return { rate, rateDate, source: host };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolves one published FX rate for reporting conversion.
 *
 * A rate published for the current UTC day is treated as authoritative. When
 * the provider is unreachable, the most recent cached rate is returned as an
 * explicit estimate so the reader always sees how old the conversion is.
 */
export async function resolveFxRate(base: string, quote: string, now: Date = new Date()): Promise<FxRateResolution> {
  const from = base.trim().toUpperCase();
  const to = quote.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(from) || !CURRENCY_PATTERN.test(to)) {
    return { base: from, quote: to, rate: null, rateDate: null, source: "FX_RATE", quality: "MISSING", note: "Conversion requires two ISO 4217 currency codes." };
  }
  if (from === to) {
    return { base: from, quote: to, rate: 1, rateDate: utcDateLabel(now), source: "FX_RATE", quality: "ACTUAL", note: "No conversion is required." };
  }

  const today = utcDateLabel(now);
  const cachedToday = await readStoredRate(from, to, today);
  if (cachedToday) {
    return {
      base: from, quote: to, rate: cachedToday.rate, rateDate: cachedToday.rateDate, source: cachedToday.source,
      quality: "ACTUAL",
      note: `1 ${from} = ${cachedToday.rate} ${to} published ${cachedToday.rateDate} by ${cachedToday.source}.`,
    };
  }

  const fetched = await fetchProviderRate(from, to);
  if (fetched) {
    await persistRate(from, to, fetched.rateDate, fetched.rate, fetched.source);
    return {
      base: from, quote: to, rate: fetched.rate, rateDate: fetched.rateDate, source: fetched.source,
      quality: daysBetween(fetched.rateDate, today) <= 1 ? "ACTUAL" : "ESTIMATE",
      note: `1 ${from} = ${fetched.rate} ${to} published ${fetched.rateDate} by ${fetched.source}.`,
    };
  }

  const stale = await readStoredRate(from, to);
  if (stale) {
    const age = daysBetween(stale.rateDate, today);
    if (age <= STALE_RATE_MAX_AGE_DAYS) {
      return {
        base: from, quote: to, rate: stale.rate, rateDate: stale.rateDate, source: stale.source,
        quality: "ESTIMATE",
        note: `The ${from}/${to} rate provider was unreachable; using the cached rate published ${stale.rateDate} by ${stale.source} (${age} day(s) old).`,
      };
    }
  }

  return {
    base: from, quote: to, rate: null, rateDate: null, source: "FX_RATE", quality: "MISSING",
    note: `No ${from}/${to} rate is available from the configured provider or the cached rate history.`,
  };
}

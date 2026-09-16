import { financialD1 } from "../lib/financial-ledger.js";
import { getGrowthCockpitConfig } from "../lib/growth-cockpit-config.js";
import { reportingMoneyFor } from "../lib/reporting-currency.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";

/**
 * Settles one row per reporting day so every stat can say whether it is better
 * or worse than yesterday without re-querying Shopify for each comparison.
 *
 * Today and yesterday are rewritten on every run because they are still
 * changing; older days are only computed when their row is missing, so a
 * fourteen-day history costs fourteen Shopify calls once and nothing after.
 */
const shopify = new ShopifyAdminClient();
const HISTORY_DAYS = 14;

export interface DashboardDailyRow {
  localDate: string;
  currency: string;
  netRevenue: number | null;
  orders: number | null;
  paymentFees: number | null;
  adSpend: number | null;
  productCost: number | null;
  trackedVisitors: number | null;
  ordersLinkedToVisitor: number | null;
  costPricedOrders: number | null;
}

function localDateIn(timezone: string, date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Midnight of a local calendar date, as a UTC instant. */
function startOfLocalDay(localDate: string, timezone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  const guess = Date.UTC(year, month - 1, day, 12, 0, 0);
  // Resolve the offset by asking what local date/time that instant represents.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
  }).formatToParts(new Date(guess));
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "12");
  return new Date(guess - hour * 3600000);
}

function shiftLocalDate(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

async function ledgerTotalsByDate(source: string, category: string, from: string, to: string): Promise<Map<string, { amount: number; rows: number; currency: string }>> {
  const db = financialD1();
  const out = new Map<string, { amount: number; rows: number; currency: string }>();
  if (!db) return out;
  const result = await db.prepare(`SELECT occurredDate, SUM(amount) AS amount, COUNT(*) AS rows, currency
    FROM "FinancialLedgerEntry" WHERE source = ? AND category = ? AND occurredDate >= ? AND occurredDate <= ?
    GROUP BY occurredDate, currency`).bind(source, category, from, to).all();
  for (const row of (result.results ?? []) as Array<{ occurredDate: string; amount: number; rows: number; currency: string }>) {
    out.set(String(row.occurredDate), { amount: Number(row.amount) || 0, rows: Number(row.rows) || 0, currency: String(row.currency).toUpperCase() });
  }
  return out;
}

export async function snapshotDashboardDaily(now: Date = new Date()): Promise<{ written: number; days: string[] }> {
  const db = financialD1();
  if (!db) return { written: 0, days: [] };
  const timezone = getGrowthCockpitConfig(workerEnvValue).reportingTimezone;
  const today = localDateIn(timezone, now);
  const oldest = shiftLocalDate(today, -(HISTORY_DAYS - 1));

  const existing = new Set<string>();
  const known = await db.prepare('SELECT "localDate" FROM "DashboardDailyMetric" WHERE "localDate" >= ?').bind(oldest).all();
  for (const row of (known.results ?? []) as Array<{ localDate: string }>) existing.add(String(row.localDate));

  const [adSpendByDate, costByDate] = await Promise.all([
    ledgerTotalsByDate("META_ADS_INSIGHTS", "AD_SPEND", oldest, today),
    ledgerTotalsByDate("CJ_ORDER_COSTS", "CJ_VARIABLE_COST", oldest, today),
  ]);

  const written: string[] = [];
  for (let offset = 0; offset < HISTORY_DAYS; offset += 1) {
    const localDate = shiftLocalDate(today, -offset);
    // Today and yesterday are still moving; older days are settled.
    if (offset > 1 && existing.has(localDate)) continue;
    const from = startOfLocalDay(localDate, timezone).toISOString();
    const toExclusive = startOfLocalDay(shiftLocalDate(localDate, 1), timezone).toISOString();
    let summary: any = null;
    try {
      summary = await shopify.orderFinancialSummary({ from, toExclusive, now });
    } catch (error) {
      console.warn(`[DASHBOARD DAILY] Shopify summary failed for ${localDate}: ${String((error as Error)?.message || error).slice(0, 160)}`);
      continue;
    }
    // Restate the day in the reporting currency before it is stored, so a day
    // before the shop switched currency is comparable with one after.
    const money = await reportingMoneyFor([summary?.currency].filter(Boolean) as string[]);
    const netRevenue = summary?.amount != null && summary?.currency ? money.convert(summary.amount, summary.currency) : null;
    const paymentFees = summary?.paymentFees?.amount != null && summary?.paymentFees?.currency
      ? money.convert(summary.paymentFees.amount, summary.paymentFees.currency)
      : null;
    const adSpend = adSpendByDate.get(localDate)?.amount ?? null;
    const cost = costByDate.get(localDate) ?? null;

    await db.prepare(`INSERT INTO "DashboardDailyMetric"
        ("localDate","currency","netRevenue","orders","paymentFees","adSpend","productCost","trackedVisitors","ordersLinkedToVisitor","costPricedOrders","updatedAt")
      VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT("localDate") DO UPDATE SET
        "currency" = excluded."currency", "netRevenue" = excluded."netRevenue", "orders" = excluded."orders",
        "paymentFees" = excluded."paymentFees", "adSpend" = excluded."adSpend", "productCost" = excluded."productCost",
        "costPricedOrders" = excluded."costPricedOrders", "updatedAt" = CURRENT_TIMESTAMP`)
      .bind(localDate, money.currency, netRevenue, Number(summary?.orders ?? 0), paymentFees,
        adSpend, cost ? Number(cost.amount.toFixed(2)) : null, null, null, cost ? cost.rows : null).run();
    written.push(localDate);
  }
  return { written: written.length, days: written };
}

export interface MetricComparison {
  previous: number | null;
  previousLabel: string;
  series: Array<{ date: string; value: number | null }>;
  /** True when the previous window is missing days, so a delta would mislead. */
  incomplete: boolean;
}

export interface DashboardComparison {
  previousLabel: string;
  windowDays: number;
  metrics: Record<string, MetricComparison>;
  seriesDates: string[];
}

const SERIES_KEYS = ["netRevenue", "orders", "paymentFees", "adSpend", "productCost"] as const;

/**
 * The same window immediately before the one being reported, plus a daily
 * series for the trend, both read from settled rows.
 */
export async function dashboardComparison(input: { localFrom: string; localTo: string }): Promise<DashboardComparison | null> {
  const db = financialD1();
  if (!db) return null;
  const from = input.localFrom;
  const to = input.localTo;
  const dayCount = Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
  const previousTo = shiftLocalDate(from, -1);
  const previousFrom = shiftLocalDate(previousTo, -(dayCount - 1));
  // The series always spans a week so the trend is readable even for one day.
  const seriesFrom = shiftLocalDate(to, -6);

  const result = await db.prepare(`SELECT * FROM "DashboardDailyMetric" WHERE "localDate" >= ? AND "localDate" <= ? ORDER BY "localDate" ASC`)
    .bind(previousFrom < seriesFrom ? previousFrom : seriesFrom, to).all();
  const rows = (result.results ?? []) as unknown as DashboardDailyRow[];
  if (!rows.length) return null;
  const byDate = new Map(rows.map(row => [String(row.localDate), row]));

  const seriesDates: string[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) seriesDates.push(shiftLocalDate(to, -offset));
  const previousDates: string[] = [];
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) previousDates.push(shiftLocalDate(previousTo, -offset));

  const metrics: Record<string, MetricComparison> = {};
  for (const key of SERIES_KEYS) {
    let previous: number | null = null;
    let missing = 0;
    for (const date of previousDates) {
      const row = byDate.get(date);
      const value = row ? (row[key] as number | null) : null;
      if (value == null) { missing += 1; continue; }
      previous = (previous ?? 0) + Number(value);
    }
    metrics[key] = {
      previous: previous == null ? null : Number(previous.toFixed(2)),
      previousLabel: dayCount === 1 ? "yesterday" : `previous ${dayCount} days`,
      series: seriesDates.map(date => ({ date, value: (byDate.get(date)?.[key] as number | null) ?? null })),
      incomplete: missing > 0,
    };
  }
  return {
    previousLabel: dayCount === 1 ? "yesterday" : `previous ${dayCount} days`,
    windowDays: dayCount,
    metrics,
    seriesDates,
  };
}

import type { FinancialQuality } from "./growth-cockpit-finance.js";

export interface DailyCoverageRow {
  localDate: string;
  amount: number;
  currency: string;
  quality: FinancialQuality;
  rowCount: number;
  orders?: number | null;
}

export interface DailyCoverageSum {
  /** Every day in the window had a reconciled row. */
  complete: boolean;
  amount: number;
  currency: string | null;
  quality: FinancialQuality;
  orders: number;
  days: number;
  missingDays: string[];
}

export function calendarDayLabels(localFrom: string, localTo: string): string[] {
  const labels: string[] = [];
  const [fromYear, fromMonth, fromDay] = localFrom.split("-").map(Number);
  const [toYear, toMonth, toDay] = localTo.split("-").map(Number);
  const end = Date.UTC(toYear, toMonth - 1, toDay);
  for (let cursor = Date.UTC(fromYear, fromMonth - 1, fromDay); cursor <= end; cursor += 86400000) {
    const date = new Date(cursor);
    labels.push([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
      .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
      .join("-"));
    if (labels.length > 800) break;
  }
  return labels;
}

/**
 * Adds up the days a reconciler has already settled.
 *
 * Asking Shopify for every order in a ninety-day window took long enough that
 * the request was abandoned and the screen showed nothing. The cron has
 * already written one reconciled row per finished day, so a window made only
 * of finished days is a sum, not a query. It is deliberately all-or-nothing:
 * a window missing even one day falls back to the live read rather than
 * quietly reporting a smaller number as if it were the period's total.
 */
export function sumDailyCoverage(rows: DailyCoverageRow[], localFrom: string, localTo: string): DailyCoverageSum {
  const expected = calendarDayLabels(localFrom, localTo);
  const byDate = new Map(rows.map(row => [row.localDate, row]));
  const missingDays = expected.filter(day => !byDate.has(day));
  const present = expected.map(day => byDate.get(day)).filter((row): row is DailyCoverageRow => Boolean(row));
  const currencies = [...new Set(present.map(row => row.currency.toUpperCase()))];
  const weakest = present.reduce<FinancialQuality>((quality, row) => {
    const order: FinancialQuality[] = ["MISSING", "PARTIAL", "ESTIMATE", "ACTUAL"];
    return order.indexOf(row.quality) < order.indexOf(quality) ? row.quality : quality;
  }, "ACTUAL");

  return {
    complete: missingDays.length === 0 && currencies.length <= 1 && present.length > 0,
    amount: Number(present.reduce((sum, row) => sum + Number(row.amount || 0), 0).toFixed(2)),
    currency: currencies.length === 1 ? currencies[0] : null,
    quality: present.length ? weakest : "MISSING",
    orders: present.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.orders || 0))), 0),
    days: present.length,
    missingDays,
  };
}

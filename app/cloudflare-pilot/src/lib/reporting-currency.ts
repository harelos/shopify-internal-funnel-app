import { resolveFxRate, type FxRateResolution } from "./fx.js";
import { workerEnvValue } from "./shopify-config.js";
import { type FinancialQuality } from "./growth-cockpit-finance.js";

const SYMBOLS: Record<string, string> = { USD: "$", ILS: "₪", EUR: "€", GBP: "£" };

export interface ReportingMoney {
  /** The currency every amount in the response is stated in. */
  currency: string | null;
  symbol: string;
  /** Rates actually used, so a screen can show what the conversion stood on. */
  rates: FxRateResolution[];
  quality: FinancialQuality;
  /** Converts one amount, or returns null when no trustworthy rate exists. */
  convert(amount: number | null | undefined, from: string | null | undefined): number | null;
}

function weakest(left: FinancialQuality, right: FinancialQuality): FinancialQuality {
  const order: FinancialQuality[] = ["MISSING", "PARTIAL", "ESTIMATE", "ACTUAL"];
  return order.indexOf(left) <= order.indexOf(right) ? left : right;
}

/**
 * Restates store amounts in one reporting currency for the dashboard only.
 *
 * The store sells and is paid out in shekels; the owner reads the business in
 * dollars, and ad spend is already billed in dollars, so a screen mixing the
 * two cannot be compared with itself. Nothing here changes what a customer is
 * charged — it converts what is displayed, at the published daily rate, and
 * reports the rate alongside so the number can be traced.
 */
export async function reportingMoneyFor(sourceCurrencies: Array<string | null | undefined>): Promise<ReportingMoney> {
  const target = String(workerEnvValue("REPORTING_CURRENCY") || "").toUpperCase() || null;
  const distinct = [...new Set(sourceCurrencies
    .map(value => String(value || "").toUpperCase())
    .filter(value => /^[A-Z]{3}$/.test(value)))];

  if (!target) {
    const only = distinct.length === 1 ? distinct[0] : null;
    return {
      currency: only,
      symbol: only ? SYMBOLS[only] ?? only : "",
      rates: [],
      quality: only ? "ACTUAL" : "MISSING",
      convert: (amount, from) => {
        if (amount == null || !Number.isFinite(Number(amount))) return null;
        return only && String(from || "").toUpperCase() === only ? Number(amount) : null;
      },
    };
  }

  const quotes = new Map<string, FxRateResolution>();
  let quality: FinancialQuality = "ACTUAL";
  for (const currency of distinct) {
    if (currency === target) continue;
    try {
      const quote = await resolveFxRate(currency, target);
      if (quote.rate == null) {
        quality = weakest(quality, "MISSING");
        continue;
      }
      quotes.set(currency, quote);
      quality = weakest(quality, quote.quality);
    } catch {
      quality = weakest(quality, "MISSING");
    }
  }

  return {
    currency: target,
    symbol: SYMBOLS[target] ?? target,
    rates: [...quotes.values()],
    quality,
    convert(amount, from) {
      if (amount == null || !Number.isFinite(Number(amount))) return null;
      const source = String(from || "").toUpperCase();
      if (!source) return null;
      if (source === target) return Number(Number(amount).toFixed(2));
      const quote = quotes.get(source);
      if (!quote || quote.rate == null) return null;
      return Number((Number(amount) * quote.rate).toFixed(2));
    },
  };
}

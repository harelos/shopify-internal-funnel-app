import type { MetaAdSetPerformance } from "./meta-campaign-spend.js";

export interface AdSetVerdict extends MetaAdSetPerformance {
  /** Meta reports purchases it attributes; Shopify is the source of truth for the ceiling. */
  verdict: "OVER_BREAK_EVEN" | "UNDER_BREAK_EVEN" | "NO_PURCHASES" | "UNKNOWN";
  headroom: number | null;
}

/**
 * Compares each ad set's cost per purchase with what the business can afford.
 *
 * The ceiling is the store's own break-even CPA: revenue minus product cost and
 * payment fees, per order. An ad set above it loses money on every order it
 * buys, however good its ROAS looks.
 */
export function judgeAdSets(adSets: MetaAdSetPerformance[], breakEvenCpa: number | null): AdSetVerdict[] {
  return adSets.map(adSet => {
    if (adSet.costPerPurchase == null) {
      return { ...adSet, verdict: adSet.spend > 0 ? "NO_PURCHASES" as const : "UNKNOWN" as const, headroom: null };
    }
    if (breakEvenCpa == null || !Number.isFinite(breakEvenCpa)) return { ...adSet, verdict: "UNKNOWN" as const, headroom: null };
    const headroom = Number((breakEvenCpa - adSet.costPerPurchase).toFixed(2));
    return {
      ...adSet,
      verdict: headroom >= 0 ? "UNDER_BREAK_EVEN" as const : "OVER_BREAK_EVEN" as const,
      headroom,
    };
  });
}

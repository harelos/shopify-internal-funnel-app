import { workerEnvValue } from "./shopify-config.js";

export interface MetaSpendRange {
  localFrom: string | null;
  localTo: string | null;
}

/**
 * Upper-funnel counts reported by Meta itself.
 *
 * These come from the ad account rather than the storefront because the
 * storefront pixel only sees visitors who allow it, while Meta reports every
 * click it charged for.
 */
export interface MetaFunnelCounts {
  linkClicks: number | null;
  landingPageViews: number | null;
  addToCart: number | null;
  initiateCheckout: number | null;
  purchases: number | null;
  impressions: number | null;
}

export interface MetaSpendResult {
  amount: number | null;
  currency: string | null;
  quality: "ACTUAL" | "PARTIAL" | "MISSING";
  source: string;
  note: string;
  rows: number;
  accountId: string | null;
  daily: Array<{ date: string; amount: number }>;
  funnel: MetaFunnelCounts;
}

type MetaAction = { action_type?: string; value?: string };
type MetaInsightRow = {
  spend?: string;
  date_start?: string;
  date_stop?: string;
  impressions?: string;
  inline_link_clicks?: string;
  actions?: MetaAction[];
};

const EMPTY_FUNNEL: MetaFunnelCounts = {
  linkClicks: null, landingPageViews: null, addToCart: null, initiateCheckout: null, purchases: null, impressions: null,
};

function sumNumeric(rows: MetaInsightRow[], field: "impressions" | "inline_link_clicks"): number | null {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    const value = Number(row[field]);
    if (Number.isFinite(value)) { total += value; seen = true; }
  }
  return seen ? total : null;
}

/**
 * Resolves one conversion count from Meta's action list.
 *
 * Meta reports the same conversion under several aliases at once, for example
 * add_to_cart alongside offsite_conversion.fb_pixel_add_to_cart with an
 * identical value. Summing the aliases would double-count, so the preferred
 * alias is taken and the rest are ignored.
 */
function resolveAction(rows: MetaInsightRow[], preferredTypes: string[]): number | null {
  for (const actionType of preferredTypes) {
    let total = 0;
    let seen = false;
    for (const row of rows) {
      for (const action of row.actions ?? []) {
        if (action.action_type !== actionType) continue;
        const value = Number(action.value);
        if (Number.isFinite(value)) { total += value; seen = true; }
      }
    }
    if (seen) return total;
  }
  return null;
}

function missing(note: string, accountId: string | null = null): MetaSpendResult {
  return { amount: null, currency: null, quality: "MISSING", source: "META_ADS_INSIGHTS", note, rows: 0, accountId, daily: [], funnel: { ...EMPTY_FUNNEL } };
}

function dateRangeQuery(range: MetaSpendRange): Record<string, string> {
  return range.localFrom && range.localTo
    ? { time_range: JSON.stringify({ since: range.localFrom, until: range.localTo }) }
    : { date_preset: "maximum" };
}

/** Reads aggregate spend from Meta without ever returning or logging the token. */
export async function fetchMetaSpend(range: MetaSpendRange): Promise<MetaSpendResult> {
  const accountId = workerEnvValue("META_AD_ACCOUNT_ID");
  const accessToken = workerEnvValue("META_ACCESS_TOKEN");
  const version = workerEnvValue("META_GRAPH_API_VERSION") || "v23.0";
  const currency = workerEnvValue("META_AD_ACCOUNT_CURRENCY").toUpperCase() || null;
  if (!accountId) return missing("META_AD_ACCOUNT_ID is not configured.");
  if (!accessToken) return missing("META_ACCESS_TOKEN is not configured.", accountId);
  if (!currency) return missing("META_AD_ACCOUNT_CURRENCY is not configured.", accountId);

  const rows: MetaInsightRow[] = [];
  let nextUrl: string | null = null;
  let page = 0;
  try {
    do {
      const url = nextUrl
        ? new URL(nextUrl)
        : new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/insights`);
      if (!nextUrl) {
        url.searchParams.set("fields", "spend,date_start,date_stop,impressions,inline_link_clicks,actions");
        url.searchParams.set("time_increment", "1");
        url.searchParams.set("limit", "500");
        for (const [key, value] of Object.entries(dateRangeQuery(range))) url.searchParams.set(key, value);
      }
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return missing(`Meta Insights returned HTTP ${response.status}.`, accountId);
      const payload = await response.json() as { data?: MetaInsightRow[]; paging?: { next?: string } };
      rows.push(...(payload.data ?? []));
      nextUrl = payload.paging?.next ?? null;
      page += 1;
    } while (nextUrl && page < 20);
  } catch (error: any) {
    return missing(`Meta Insights request failed: ${String(error?.message || "unknown error").slice(0, 160)}`, accountId);
  }

  const spends = rows.map(row => Number(row.spend));
  if (spends.some(value => !Number.isFinite(value) || value < 0)) {
    return missing("Meta returned no valid spend rows for this period.", accountId);
  }
  // Meta answers a window with no delivery with an empty list, not a zero
  // row. Early in the day that is every "today" window, and treating it as
  // missing blanked profit until the first ad impression was billed.
  if (!rows.length) {
    return {
      amount: 0,
      currency,
      quality: "ACTUAL",
      source: "META_ADS_INSIGHTS",
      note: "Meta Insights returned no delivery for this window; spend is zero so far.",
      rows: 0,
      accountId,
      daily: [],
      funnel: { ...EMPTY_FUNNEL },
    };
  }
  return {
    amount: Number(spends.reduce((sum, value) => sum + value, 0).toFixed(2)),
    currency,
    quality: nextUrl ? "PARTIAL" : "ACTUAL",
    source: "META_ADS_INSIGHTS",
    note: nextUrl ? "Meta Insights exceeded the safe page limit; spend is partial." : "Aggregate Meta Insights spend for the configured ad account and reporting dates.",
    rows: rows.length,
    accountId,
    daily: rows.map(row => ({ date: String(row.date_start || row.date_stop || ""), amount: Number(Number(row.spend || 0).toFixed(2)) }))
      .filter(entry => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(entry.date)),
    funnel: {
      impressions: sumNumeric(rows, "impressions"),
      linkClicks: sumNumeric(rows, "inline_link_clicks"),
      landingPageViews: resolveAction(rows, ["landing_page_view"]),
      addToCart: resolveAction(rows, ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"]),
      initiateCheckout: resolveAction(rows, ["initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"]),
      purchases: resolveAction(rows, ["purchase", "offsite_conversion.fb_pixel_purchase"]),
    },
  };
}

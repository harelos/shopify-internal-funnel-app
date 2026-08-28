import { workerEnvValue } from "./shopify-config.js";

export interface MetaSpendRange {
  localFrom: string | null;
  localTo: string | null;
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
}

type MetaInsightRow = { spend?: string; date_start?: string; date_stop?: string };

function missing(note: string, accountId: string | null = null): MetaSpendResult {
  return { amount: null, currency: null, quality: "MISSING", source: "META_ADS_INSIGHTS", note, rows: 0, accountId, daily: [] };
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
        url.searchParams.set("fields", "spend,date_start,date_stop");
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
  if (!rows.length || spends.some(value => !Number.isFinite(value) || value < 0)) {
    return missing("Meta returned no valid spend rows for this period.", accountId);
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
      .filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.date)),
  };
}

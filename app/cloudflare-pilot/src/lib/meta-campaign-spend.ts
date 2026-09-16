import { workerEnvValue } from "./shopify-config.js";

/**
 * Spend and purchases per ad set, so break-even can be judged where the money
 * is actually spent.
 *
 * A store-wide break-even CPA says what the business can afford per order. It
 * cannot say which ad set is over it, and that is the decision being made every
 * day. Meta reports purchases and their value at ad-set level, so the cost per
 * purchase there can be compared against the ceiling the store's own margin
 * sets.
 */
export interface MetaAdSetPerformance {
  campaignName: string;
  adSetName: string;
  adSetId: string;
  spend: number;
  purchases: number;
  purchaseValue: number;
  /** Spend divided by purchases; null when the ad set has no purchase yet. */
  costPerPurchase: number | null;
}

export interface MetaCampaignSpendResult {
  currency: string | null;
  accountId: string | null;
  adSets: MetaAdSetPerformance[];
  note: string;
  ok: boolean;
}

function actionValue(actions: Array<{ action_type?: string; value?: string }> | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  return actions
    .filter(action => types.includes(String(action.action_type)))
    .reduce((sum, action) => sum + (Number(action.value) || 0), 0);
}

export async function fetchMetaAdSetPerformance(range: { localFrom: string | null; localTo: string | null }): Promise<MetaCampaignSpendResult> {
  const accountId = workerEnvValue("META_AD_ACCOUNT_ID");
  const accessToken = workerEnvValue("META_ACCESS_TOKEN");
  const version = workerEnvValue("META_GRAPH_API_VERSION") || "v23.0";
  const currency = workerEnvValue("META_AD_ACCOUNT_CURRENCY").toUpperCase() || null;
  const empty = (note: string): MetaCampaignSpendResult => ({ currency, accountId: accountId || null, adSets: [], note, ok: false });
  if (!accountId || !accessToken) return empty("Meta is not configured.");
  if (!range.localFrom || !range.localTo) return empty("The reporting window has no dates.");

  try {
    const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(accountId)}/insights`);
    url.searchParams.set("level", "adset");
    url.searchParams.set("fields", "campaign_name,adset_name,adset_id,spend,actions,action_values");
    url.searchParams.set("time_range", JSON.stringify({ since: range.localFrom, until: range.localTo }));
    url.searchParams.set("limit", "200");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return empty(`Meta Insights returned HTTP ${response.status}.`);
    const payload = await response.json() as {
      data?: Array<{
        campaign_name?: string; adset_name?: string; adset_id?: string; spend?: string;
        actions?: Array<{ action_type?: string; value?: string }>;
        action_values?: Array<{ action_type?: string; value?: string }>;
      }>;
    };
    const purchaseTypes = ["purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"];
    const adSets = (payload.data ?? []).map(row => {
      const spend = Number(row.spend) || 0;
      const purchases = actionValue(row.actions, purchaseTypes);
      return {
        campaignName: String(row.campaign_name || "—"),
        adSetName: String(row.adset_name || "—"),
        adSetId: String(row.adset_id || ""),
        spend: Number(spend.toFixed(2)),
        purchases,
        purchaseValue: Number(actionValue(row.action_values, purchaseTypes).toFixed(2)),
        costPerPurchase: purchases > 0 ? Number((spend / purchases).toFixed(2)) : null,
      };
    }).filter(row => row.spend > 0)
      .sort((left, right) => right.spend - left.spend);

    return {
      currency,
      accountId,
      adSets,
      ok: true,
      note: adSets.length
        ? `Meta ad-set delivery for ${range.localFrom} to ${range.localTo}.`
        : "Meta reported no ad-set delivery in this window.",
    };
  } catch (error: any) {
    return empty(`Meta ad-set request failed: ${String(error?.message || "unknown error").slice(0, 140)}`);
  }
}

export { judgeAdSets, type AdSetVerdict } from "./ad-set-verdict.js";

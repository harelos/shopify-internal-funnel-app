import fs from 'node:fs';

const rawData = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_deep_insights.json', 'utf-8'));
const auditData = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_audit_data.json', 'utf-8'));

const summary = {};

for (const [accId, data] of Object.entries(rawData)) {
  const accName = data.account.name;
  const currency = data.account.currency;
  const insights = data.insights || [];
  const ads = data.ads || [];
  const rawCampaigns = auditData[accId]?.campaigns || [];
  const rawAdsets = auditData[accId]?.adsets || [];

  const adMap = new Map();
  for (const a of ads) {
    adMap.set(a.id, a);
  }

  const enrichedAds = [];
  let totalSpend = 0;
  let totalPurchases = 0;
  let totalPurchaseValue = 0;
  let totalImpressions = 0;
  let totalClicks = 0;

  for (const ins of insights) {
    const spend = Number(ins.spend || 0);
    const impressions = Number(ins.impressions || 0);
    const clicks = Number(ins.clicks || 0);
    const ctr = Number(ins.ctr || 0);
    const cpc = Number(ins.cpc || 0);
    const cpm = Number(ins.cpm || 0);

    let roas = 0;
    if (ins.purchase_roas && ins.purchase_roas.length > 0) {
      roas = Number(ins.purchase_roas[0].value || 0);
    }

    let purchases = 0;
    let purchaseVal = 0;
    if (ins.actions) {
      const pAction = ins.actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
      if (pAction) purchases = Number(pAction.value || 0);
    }
    if (ins.action_values) {
      const pvAction = ins.action_values.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
      if (pvAction) purchaseVal = Number(pvAction.value || 0);
    }

    const cpa = purchases > 0 ? (spend / purchases) : 0;

    totalSpend += spend;
    totalPurchases += purchases;
    totalPurchaseValue += purchaseVal;
    totalImpressions += impressions;
    totalClicks += clicks;

    const adObj = adMap.get(ins.ad_id);
    const creative = adObj?.creative || {};

    enrichedAds.push({
      ad_id: ins.ad_id,
      ad_name: ins.ad_name,
      campaign_name: ins.campaign_name,
      adset_name: ins.adset_name,
      spend,
      impressions,
      clicks,
      ctr,
      cpc,
      cpm,
      purchases,
      purchase_value: purchaseVal,
      roas,
      cpa,
      creative_title: creative.title || '',
      creative_body: creative.body || '',
      image_url: creative.image_url || creative.thumbnail_url || '',
      object_story_spec: creative.object_story_spec || null
    });
  }

  // Also extract campaign level stats from rawCampaigns
  const enrichedCampaigns = rawCampaigns.map(c => {
    const cIns = c.insights?.data?.[0] || {};
    let roas = 0;
    if (cIns.purchase_roas?.[0]?.value) roas = Number(cIns.purchase_roas[0].value);
    let purchases = 0;
    if (cIns.actions) {
      const pAction = cIns.actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
      if (pAction) purchases = Number(pAction.value || 0);
    }
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      effective_status: c.effective_status,
      objective: c.objective,
      spend: Number(cIns.spend || 0),
      impressions: Number(cIns.impressions || 0),
      clicks: Number(cIns.clicks || 0),
      ctr: Number(cIns.ctr || 0),
      cpc: Number(cIns.cpc || 0),
      purchases,
      roas
    };
  });

  const winners = enrichedAds
    .filter(a => a.purchases > 0)
    .sort((a, b) => b.roas - a.roas);

  const topSpenders = [...enrichedAds].sort((a, b) => b.spend - a.spend).slice(0, 10);
  const bleeders = enrichedAds
    .filter(a => a.spend > 50 && a.purchases === 0)
    .sort((a, b) => b.spend - a.spend);

  summary[accId] = {
    account_name: accName,
    currency,
    total_spend: totalSpend,
    total_purchases: totalPurchases,
    total_revenue: totalPurchaseValue,
    overall_roas: totalSpend > 0 ? (totalPurchaseValue / totalSpend) : 0,
    overall_cpa: totalPurchases > 0 ? (totalSpend / totalPurchases) : 0,
    overall_ctr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100) : 0,
    total_campaigns: rawCampaigns.length,
    total_adsets: rawAdsets.length,
    total_ads: ads.length,
    campaigns: enrichedCampaigns,
    adsets: rawAdsets,
    top_winners: winners.slice(0, 15),
    top_spenders: topSpenders,
    bleeders: bleeders.slice(0, 15)
  };
}

fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_audit_summary.json', JSON.stringify(summary, null, 2));
console.log('Finished processing summary metrics successfully!');

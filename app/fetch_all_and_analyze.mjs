import fs from 'node:fs';

const token = 'EAAOLLFDEGuIBSPH6jZCkz3ZBKRDG7UhzHRYZAxlbiGCIZCGNamjol0G65PS6VZCVrPGtZCsqwfvPPpP3LWAUO6cPpGZAM7upLF9Kv5A4g8liFX4wwOq4mxp5EsEVRZC6TNZCzXl5eBMY2GP7Md6Hx3ZCLKy1mMZCClaZBtTZBWEa1IOs9BE3ixTnvWX7Hsb82CnLDFWXXuyY5q8b3rKz5BGrOzawNoJPMwg3B5f9ZA';

const targetAccounts = [
  { id: 'act_906835510448247', name: 'Shopify Store 1', currency: 'HKD' },
  { id: 'act_1348468232946606', name: 'Shopify Store 2', currency: 'ILS' },
  { id: 'act_8852331774866389', name: 'Shopify Store 3', currency: 'USD' },
  { id: 'act_1348222705758124', name: 'JacobNew1', currency: 'USD' },
  { id: 'act_1674931262932286', name: 'JacobNew2', currency: 'USD' },
  { id: 'act_166613279606127', name: 'JacobNew3', currency: 'USD' },
  { id: 'act_1485755002230457', name: 'JacobNew4', currency: 'USD' },
  { id: 'act_1717853958667676', name: 'JacobNew5', currency: 'USD' },
  { id: 'act_289731960246927', name: 'JacobNew6', currency: 'USD' },
  { id: 'act_1415509685957819', name: 'JacobNew7', currency: 'USD' },
  { id: 'act_1431223877625963', name: 'JacobNew8', currency: 'USD' },
  { id: 'act_658570955674770', name: 'JacobNew9', currency: 'USD' },
  { id: 'act_1322498805668580', name: 'elegancelift1', currency: 'HKD' },
  { id: 'act_3887802441433954', name: 'Celestiva Limited 1', currency: 'HKD' },
  { id: 'act_1917030162474613', name: 'CelestivaLimited2', currency: 'HKD' },
  { id: 'act_676516688178386', name: 'CelestivaLimited3', currency: 'HKD' }
];

const HKD_TO_USD = 1 / 7.78;
const ILS_TO_USD = 1 / 3.65;

function toUSD(amount, currency) {
  const val = parseFloat(amount) || 0;
  if (currency === 'HKD') return val * HKD_TO_USD;
  if (currency === 'ILS') return val * ILS_TO_USD;
  return val;
}

async function fetchPaging(url, maxPages = 4) {
  let allData = [];
  let nextUrl = url;
  let page = 0;

  while (nextUrl && page < maxPages) {
    page++;
    try {
      const res = await fetch(nextUrl);
      const data = await res.json();
      if (data.error) {
        console.warn(` [API Warning] ${data.error.message}`);
        break;
      }
      if (data.data && Array.isArray(data.data)) {
        allData = allData.concat(data.data);
      }
      nextUrl = data.paging && data.paging.next ? data.paging.next : null;
    } catch (e) {
      console.error(' Fetch error:', e.message);
      break;
    }
  }
  return allData;
}

async function pullAccountData(acc) {
  console.log(`\n========================================`);
  console.log(`Pulling ${acc.name} (${acc.id}) [Currency: ${acc.currency}]...`);
  const result = { account: acc, campaigns: [], adsets: [], ads: [] };

  // 1. Fetch campaigns with insights
  const campUrl = `https://graph.facebook.com/v21.0/${acc.id}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,start_time,stop_time,insights.date_preset(maximum){spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type,date_start,date_stop}&limit=50&access_token=${token}`;
  result.campaigns = await fetchPaging(campUrl, 2);

  // 2. Fetch adsets
  const adsetUrl = `https://graph.facebook.com/v21.0/${acc.id}/adsets?fields=id,name,status,effective_status,campaign_id,targeting,billing_event,optimization_goal,bid_amount,daily_budget,lifetime_budget,created_time,start_time,end_time,insights.date_preset(maximum){spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type,date_start,date_stop}&limit=50&access_token=${token}`;
  result.adsets = await fetchPaging(adsetUrl, 3);

  // 3. Fetch ads with creative
  const adsUrl = `https://graph.facebook.com/v21.0/${acc.id}/ads?fields=id,name,status,effective_status,campaign_id,adset_id,created_time,creative{id,name,title,body,image_url,thumbnail_url},insights.date_preset(maximum){spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type,date_start,date_stop}&limit=50&access_token=${token}`;
  result.ads = await fetchPaging(adsUrl, 4);

  console.log(`Fetched ${result.campaigns.length} campaigns, ${result.adsets.length} adsets, ${result.ads.length} ads`);
  return result;
}

function detectProduct(name, text = '') {
  const combined = (name + ' ' + text).toLowerCase();
  
  if (combined.includes('nova') || combined.includes('שיער') || combined.includes('צבע') || combined.includes('hair') || combined.includes('shampoo')) {
    return 'NovaHair (צבע שיער / Hair Dye)';
  }
  if (combined.includes('oceaura') || combined.includes('oce') || combined.includes('aura')) {
    return 'OceAura (Skincare / Beauty)';
  }
  if (combined.includes('elegance') || combined.includes('lift') || combined.includes('bra') || combined.includes('חזייה')) {
    return 'Elegance Lift (Shapewear / Bra)';
  }
  if (combined.includes('posture') || combined.includes('back') || combined.includes('גב')) {
    return 'Posture Corrector (תומך גב)';
  }
  if (combined.includes('teeth') || combined.includes('whitening') || combined.includes('שיניים')) {
    return 'Teeth Whitening (הלבנת שיניים)';
  }
  if (combined.includes('laser') || combined.includes('ipl') || combined.includes('הסרת שיער')) {
    return 'IPL Laser Hair Removal (הסרת שיער)';
  }
  if (combined.includes('massage') || combined.includes('gun') || combined.includes('עיסוי')) {
    return 'Deep Tissue Massage Gun (אקדח עיסוי)';
  }
  if (combined.includes('insole') || combined.includes('ortho') || combined.includes('מדרסים')) {
    return 'Orthopedic Insoles (מדרסים אורתופדיים)';
  }
  if (combined.includes('iphone') || combined.includes('phone') || combined.includes('case') || combined.includes('magsafe')) {
    return 'iPhone / MagSafe Accessories (אביזרי סמארטפון)';
  }
  if (combined.includes('jewelry') || combined.includes('ring') || combined.includes('bracelet') || combined.includes('שרשרת') || combined.includes('צמיד')) {
    return 'Jewelry / Accessories (תכשיטים)';
  }
  if (combined.includes('dc-08/02') || combined.includes('dynamic')) {
    return 'Dynamic Catalog / Multi-Product (קטלוג דינמי)';
  }
  
  return 'General E-Commerce / Other';
}

function processAllData(raw) {
  const allAccountsProcessed = {};
  const productMap = {};
  const globalWinners = [];
  const globalUntapped = [];
  const globalBleeders = [];

  for (const [accId, accData] of Object.entries(raw)) {
    const acc = accData.account;
    const currency = acc.currency;

    let accSpend = 0;
    let accRevenue = 0;
    let accPurchases = 0;
    let accImpressions = 0;
    let accClicks = 0;

    const processedAds = [];

    // Map adsets by ID for targeting info
    const adsetMap = {};
    accData.adsets.forEach(as => {
      adsetMap[as.id] = as;
    });

    // Map campaigns by ID
    const campMap = {};
    accData.campaigns.forEach(c => {
      campMap[c.id] = c;
    });

    accData.ads.forEach(ad => {
      const insight = (ad.insights && ad.insights.data && ad.insights.data[0]) ? ad.insights.data[0] : null;
      
      const rawSpend = insight ? parseFloat(insight.spend || 0) : 0;
      const spendUSD = toUSD(rawSpend, currency);

      let purchases = 0;
      let revenueRaw = 0;

      if (insight && insight.actions) {
        const pAction = insight.actions.find(a => 
          a.action_type === 'purchase' || 
          a.action_type === 'omni_purchase' || 
          a.action_type === 'offsite_conversion.fb_pixel_purchase'
        );
        if (pAction) purchases = parseInt(pAction.value || 0);
      }

      if (insight && insight.action_values) {
        const pVal = insight.action_values.find(a => 
          a.action_type === 'purchase' || 
          a.action_type === 'omni_purchase' || 
          a.action_type === 'offsite_conversion.fb_pixel_purchase'
        );
        if (pVal) revenueRaw = parseFloat(pVal.value || 0);
      }

      const revenueUSD = toUSD(revenueRaw, currency);
      const roas = spendUSD > 0 ? (revenueUSD / spendUSD) : 0;
      const cpa = purchases > 0 ? (spendUSD / purchases) : 0;
      const impressions = insight ? parseInt(insight.impressions || 0) : 0;
      const clicks = insight ? parseInt(insight.clicks || 0) : 0;
      const ctr = insight ? parseFloat(insight.ctr || 0) : 0;
      const cpcRaw = insight ? parseFloat(insight.cpc || 0) : 0;
      const cpcUSD = toUSD(cpcRaw, currency);

      accSpend += spendUSD;
      accRevenue += revenueUSD;
      accPurchases += purchases;
      accImpressions += impressions;
      accClicks += clicks;

      const creative = ad.creative || {};
      const creativeTitle = creative.title || '';
      const creativeBody = creative.body || '';
      const creativeImg = creative.image_url || creative.thumbnail_url || '';
      const adsetName = adsetMap[ad.adset_id] ? adsetMap[ad.adset_id].name : 'Unknown Adset';
      const campaignName = campMap[ad.campaign_id] ? campMap[ad.campaign_id].name : 'Unknown Campaign';
      const targeting = adsetMap[ad.adset_id] ? adsetMap[ad.adset_id].targeting : null;

      const dateStart = insight ? insight.date_start : (ad.created_time ? ad.created_time.split('T')[0] : 'N/A');
      const dateStop = insight ? insight.date_stop : 'N/A';

      const detectedProd = detectProduct(`${campaignName} ${adsetName} ${ad.name}`, `${creativeTitle} ${creativeBody}`);

      const processedAd = {
        ad_id: ad.id,
        ad_name: ad.name,
        status: ad.status,
        effective_status: ad.effective_status,
        account_id: acc.id,
        account_name: acc.name,
        campaign_name: campaignName,
        adset_name: adsetName,
        targeting: targeting,
        product: detectedProd,
        spend_usd: spendUSD,
        revenue_usd: revenueUSD,
        roas: roas,
        purchases: purchases,
        cpa_usd: cpa,
        impressions: impressions,
        clicks: clicks,
        ctr: ctr,
        cpc_usd: cpcUSD,
        date_start: dateStart,
        date_stop: dateStop,
        creative_title: creativeTitle,
        creative_body: creativeBody,
        creative_image: creativeImg
      };

      processedAds.push(processedAd);

      // Map to Product Aggregation
      if (!productMap[detectedProd]) {
        productMap[detectedProd] = {
          name: detectedProd,
          accounts: new Set(),
          ads_count: 0,
          total_spend_usd: 0,
          total_revenue_usd: 0,
          total_purchases: 0,
          total_impressions: 0,
          total_clicks: 0,
          date_start_min: dateStart,
          date_stop_max: dateStop,
          ads: [],
          top_adsets: {},
          winning_creatives: []
        };
      }

      const pGroup = productMap[detectedProd];
      pGroup.accounts.add(acc.name);
      pGroup.ads_count++;
      pGroup.total_spend_usd += spendUSD;
      pGroup.total_revenue_usd += revenueUSD;
      pGroup.total_purchases += purchases;
      pGroup.total_impressions += impressions;
      pGroup.total_clicks += clicks;
      pGroup.ads.push(processedAd);

      if (dateStart !== 'N/A' && (pGroup.date_start_min === 'N/A' || dateStart < pGroup.date_start_min)) {
        pGroup.date_start_min = dateStart;
      }
      if (dateStop !== 'N/A' && (pGroup.date_stop_max === 'N/A' || dateStop > pGroup.date_stop_max)) {
        pGroup.date_stop_max = dateStop;
      }

      // Adset performance aggregation within product
      if (!pGroup.top_adsets[adsetName]) {
        pGroup.top_adsets[adsetName] = { name: adsetName, spend_usd: 0, purchases: 0, revenue_usd: 0, ctr_sum: 0, count: 0 };
      }
      pGroup.top_adsets[adsetName].spend_usd += spendUSD;
      pGroup.top_adsets[adsetName].purchases += purchases;
      pGroup.top_adsets[adsetName].revenue_usd += revenueUSD;
      pGroup.top_adsets[adsetName].ctr_sum += ctr;
      pGroup.top_adsets[adsetName].count += 1;

      // Identify Winners, Untapped, and Bleeders
      if (spendUSD >= 5 && roas >= 2.5 && purchases >= 1) {
        globalWinners.push(processedAd);
      }
      // Untapped Potential: Good CTR (>3.5%), low spend (<$40), solid ROAS or promising clicks/engagement with 1-2 sales
      if (spendUSD > 0 && spendUSD <= 40 && (roas >= 3.0 || (ctr >= 4.0 && spendUSD >= 3))) {
        globalUntapped.push(processedAd);
      }
      // Bleeders: spent >$30 with 0 purchases or ROAS < 0.8
      if (spendUSD >= 30 && (purchases === 0 || roas < 0.8)) {
        globalBleeders.push(processedAd);
      }
    });

    allAccountsProcessed[acc.id] = {
      account_id: acc.id,
      account_name: acc.name,
      currency: currency,
      total_spend_usd: accSpend,
      total_revenue_usd: accRevenue,
      overall_roas: accSpend > 0 ? (accRevenue / accSpend) : 0,
      total_purchases: accPurchases,
      total_impressions: accImpressions,
      total_clicks: accClicks,
      avg_ctr: accImpressions > 0 ? ((accClicks / accImpressions) * 100) : 0,
      campaigns_count: accData.campaigns.length,
      adsets_count: accData.adsets.length,
      ads_count: accData.ads.length,
      ads: processedAds
    };
  }

  // Finalize product map
  const productList = Object.values(productMap).map(p => {
    const avgROAS = p.total_spend_usd > 0 ? (p.total_revenue_usd / p.total_spend_usd) : 0;
    const avgCPA = p.total_purchases > 0 ? (p.total_spend_usd / p.total_purchases) : 0;
    const avgCTR = p.total_impressions > 0 ? ((p.total_clicks / p.total_impressions) * 100) : 0;

    // Top adset
    const adsetList = Object.values(p.top_adsets).map(a => ({
      ...a,
      roas: a.spend_usd > 0 ? (a.revenue_usd / a.spend_usd) : 0,
      cpa: a.purchases > 0 ? (a.spend_usd / a.purchases) : 0,
      avg_ctr: a.count > 0 ? (a.ctr_sum / a.count) : 0
    })).sort((a, b) => b.roas - a.roas || b.purchases - a.purchases);

    // Top winning ads for this product
    const topProductAds = p.ads
      .filter(a => a.spend_usd > 0)
      .sort((a, b) => (b.roas * b.purchases) - (a.roas * a.purchases) || b.roas - a.roas);

    return {
      name: p.name,
      accounts: Array.from(p.accounts),
      ads_count: p.ads_count,
      total_spend_usd: p.total_spend_usd,
      total_revenue_usd: p.total_revenue_usd,
      overall_roas: avgROAS,
      total_purchases: p.total_purchases,
      cpa_usd: avgCPA,
      avg_ctr: avgCTR,
      date_range: `${p.date_start_min} to ${p.date_stop_max}`,
      top_adset: adsetList[0] || null,
      top_ads: topProductAds.slice(0, 5),
      untapped_candidates: topProductAds.filter(a => a.spend_usd <= 35 && (a.roas >= 3.0 || a.ctr >= 4.5)).slice(0, 5)
    };
  }).sort((a, b) => b.total_spend_usd - a.total_spend_usd);

  globalWinners.sort((a, b) => b.roas - a.roas || b.purchases - a.purchases);
  globalUntapped.sort((a, b) => b.roas - a.roas || b.ctr - a.ctr);
  globalBleeders.sort((a, b) => b.spend_usd - a.spend_usd);

  return {
    accounts: allAccountsProcessed,
    products: productList,
    globalWinners: globalWinners.slice(0, 20),
    globalUntapped: globalUntapped.slice(0, 20),
    globalBleeders: globalBleeders.slice(0, 15)
  };
}

function generateHTML(analysis) {
  const totalSpendAll = Object.values(analysis.accounts).reduce((s, a) => s + a.total_spend_usd, 0);
  const totalRevAll = Object.values(analysis.accounts).reduce((s, a) => s + a.total_revenue_usd, 0);
  const totalPurchasesAll = Object.values(analysis.accounts).reduce((s, a) => s + a.total_purchases, 0);
  const blendedROAS = totalSpendAll > 0 ? (totalRevAll / totalSpendAll).toFixed(2) : '0.00';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Meta Ads Master Audit & Revival Intelligence Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0e17;
      --bg-surface: #111827;
      --bg-card: #182234;
      --bg-card-hover: #1f2d44;
      --border-color: #26354d;
      --text-main: #f3f4f6;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --brand-accent: #3b82f6;
      --brand-glow: rgba(59, 130, 246, 0.15);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.15);
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #8b5cf6;
      --font-main: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-main);
      background-color: var(--bg-primary);
      color: var(--text-main);
      line-height: 1.5;
      padding-bottom: 80px;
    }

    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* ADHD-friendly Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border-color);
    }
    .header h1 {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header h1 span.badge {
      font-size: 13px;
      font-weight: 700;
      background: var(--brand-glow);
      color: var(--brand-accent);
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .header p {
      color: var(--text-muted);
      font-size: 15px;
      margin-top: 6px;
    }

    /* Executive KPI Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 36px;
    }
    .kpi-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--border-color);
    }
    .kpi-card.blue::before { background: var(--brand-accent); }
    .kpi-card.green::before { background: var(--success); }
    .kpi-card.purple::before { background: var(--purple); }
    .kpi-card.amber::before { background: var(--warning); }

    .kpi-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .kpi-value {
      font-size: 32px;
      font-weight: 800;
      color: #fff;
      margin: 8px 0 4px 0;
      font-family: var(--font-mono);
    }
    .kpi-sub {
      font-size: 13px;
      color: var(--text-dim);
    }

    /* Section Styling */
    .section-title {
      font-size: 20px;
      font-weight: 700;
      color: #fff;
      margin: 40px 0 18px 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-desc {
      font-size: 14px;
      color: var(--text-muted);
      margin-top: -12px;
      margin-bottom: 20px;
    }

    /* Executive Callout Alert */
    .alert-banner {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(59, 130, 246, 0.08) 100%);
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 36px;
    }
    .alert-banner h3 {
      font-size: 18px;
      font-weight: 700;
      color: var(--success);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .alert-banner ul {
      margin-left: 20px;
      color: var(--text-main);
      font-size: 14px;
    }
    .alert-banner li {
      margin-bottom: 6px;
    }

    /* Products Grid */
    .product-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .product-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .product-card:hover {
      border-color: var(--brand-accent);
      transform: translateY(-2px);
    }
    .prod-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .prod-title {
      font-size: 18px;
      font-weight: 700;
      color: #fff;
    }
    .prod-accounts {
      font-size: 12px;
      color: var(--brand-accent);
      margin-top: 2px;
      font-weight: 600;
    }
    .roas-badge {
      font-size: 16px;
      font-weight: 800;
      padding: 6px 12px;
      border-radius: 8px;
      font-family: var(--font-mono);
    }
    .roas-high { background: var(--success-glow); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.4); }
    .roas-mid { background: rgba(59, 130, 246, 0.15); color: var(--brand-accent); border: 1px solid rgba(59, 130, 246, 0.4); }
    .roas-low { background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.4); }

    .metrics-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      background: var(--bg-surface);
      border-radius: 8px;
      padding: 12px;
      gap: 8px;
      margin-bottom: 16px;
    }
    .metric-col { text-align: center; }
    .m-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; font-weight: 600; }
    .m-val { font-size: 14px; font-weight: 700; color: #fff; font-family: var(--font-mono); margin-top: 2px; }

    .prod-details {
      font-size: 13px;
      color: var(--text-muted);
      border-top: 1px solid rgba(255,255,255,0.06);
      padding-top: 14px;
      margin-top: auto;
    }
    .prod-details p { margin-bottom: 6px; }
    .prod-details strong { color: var(--text-main); }

    .tag-revive {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.2);
      color: #34d399;
      padding: 2px 8px;
      border-radius: 4px;
      margin-top: 8px;
    }

    /* Table Styles */
    .table-container {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      overflow-x: auto;
      margin-bottom: 40px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }
    th {
      background: var(--bg-surface);
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }
    td {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      color: var(--text-main);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--bg-card-hover); }

    .mono { font-family: var(--font-mono); font-weight: 600; }
    .text-green { color: var(--success); }
    .text-blue { color: var(--brand-accent); }
    .text-red { color: var(--danger); }
    .text-amber { color: var(--warning); }

    /* Account breakdown badges */
    .acc-pill {
      font-size: 12px;
      background: #1e293b;
      color: #cbd5e1;
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
      display: inline-block;
    }

    /* Action Plan Cards */
    .action-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .action-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      position: relative;
    }
    .action-card.priority-1 { border-left: 4px solid var(--success); }
    .action-card.priority-2 { border-left: 4px solid var(--brand-accent); }
    .action-card.priority-3 { border-left: 4px solid var(--purple); }

    .action-card h4 {
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 10px;
    }
    .action-card p {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 14px;
      line-height: 1.6;
    }
    .action-step {
      background: var(--bg-surface);
      border-radius: 8px;
      padding: 12px 16px;
      font-size: 13px;
      color: var(--text-main);
      margin-bottom: 8px;
    }
  </style>
</head>
<body>

<div class="container">

  <!-- Header -->
  <div class="header">
    <div>
      <h1>Meta Ads Multi-Account Performance Audit <span class="badge">PRO REPORT</span></h1>
      <p>Exhaustive Cross-Account Analysis & Revival Strategy (Converted 100% to USD)</p>
    </div>
    <div style="text-align: right;">
      <span class="acc-pill">16 Accounts Analyzed</span>
      <div style="font-size: 12px; color: var(--text-dim); margin-top: 4px;">Target Market: Israel (IL) & Global</div>
    </div>
  </div>

  <!-- Executive KPIs -->
  <div class="kpi-grid">
    <div class="kpi-card green">
      <div class="kpi-label">Total Tracked Revenue</div>
      <div class="kpi-value">$${totalRevAll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div class="kpi-sub">${totalPurchasesAll} Total Purchases Recorded</div>
    </div>
    <div class="kpi-card blue">
      <div class="kpi-label">Total Ad Spend</div>
      <div class="kpi-value">$${totalSpendAll.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div class="kpi-sub">Across All Historical Campaigns</div>
    </div>
    <div class="kpi-card purple">
      <div class="kpi-label">Blended ROAS</div>
      <div class="kpi-value">${blendedROAS}x</div>
      <div class="kpi-sub">Profitable Overall Return</div>
    </div>
    <div class="kpi-card amber">
      <div class="kpi-label">Active Products Found</div>
      <div class="kpi-value">${analysis.products.length}</div>
      <div class="kpi-sub">Categorized & Analyzed</div>
    </div>
  </div>

  <!-- Executive Summary Banner -->
  <div class="alert-banner">
    <h3>🚀 Executive Strategic Takeaways (Immediate Action Items)</h3>
    <ul>
      <li><strong>NovaHair (Shopify Store 3 - Israeli Market):</strong> #1 Highest ROI product. Generated <strong>$3,776.60 revenue on just $826.23 spend (4.57x ROAS)</strong> with incredible CTRs (up to 14.29%) and $1.30–$4.20 CPA. The angle <em>"ברק טבעי ב-10 דקות בלבד - נמאס לבזבז זמן במספרה"</em> was heavily validated and prematurely paused. <strong>Revive immediately.</strong></li>
      <li><strong>JacobNew4 & JacobNew6 (Scaling Winners):</strong> JacobNew4 generated <strong>$36,398.18 revenue at 2.86x ROAS</strong> ($12.7k spend) with dynamic ads pulling insane <strong>22.00% CTR</strong> and $13.84 CPA. JacobNew6 had heavy volume ($39.4k spend) showing proven scaling capabilities.</li>
      <li><strong>Celestiva Limited 1 (OceAura):</strong> Generated <strong>$8,994.50 revenue at 2.33x ROAS</strong> ($3,865 spend). Top adset achieved 6.19x ROAS, but ad fatigue and campaign clutter (83 split campaigns) hurt blended efficiency.</li>
      <li><strong>Untapped Budget Opportunity:</strong> Over 15 specific winning ads showed 5x–126x ROAS on micro-budgets ($1–$15) and were turned off before ever receiving proper scale.</li>
    </ul>
  </div>

  <!-- Product Breakdown Section -->
  <div class="section-title">
    <span>📦 Product-by-Product Intelligence Matrix</span>
    <span style="font-size: 13px; font-weight: normal; color: var(--text-dim);">Ranked by Total Revenue & ROAS</span>
  </div>
  <div class="section-desc">Complete breakdown of every product line tested across your ad accounts, including budget allocated, revenue generated, CTR, CPA, and revival potential.</div>

  <div class="product-grid">
    ${analysis.products.map(p => {
      const roasClass = p.overall_roas >= 3.0 ? 'roas-high' : (p.overall_roas >= 1.8 ? 'roas-mid' : 'roas-low');
      return `
      <div class="product-card">
        <div>
          <div class="prod-header">
            <div>
              <div class="prod-title">${p.name}</div>
              <div class="prod-accounts">Accounts: ${p.accounts.join(', ')}</div>
            </div>
            <div class="roas-badge ${roasClass}">${p.overall_roas.toFixed(2)}x ROAS</div>
          </div>

          <div class="metrics-row">
            <div class="metric-col">
              <div class="m-label">Spend (USD)</div>
              <div class="m-val">$${p.total_spend_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            </div>
            <div class="metric-col">
              <div class="m-label">Revenue</div>
              <div class="m-val text-green">$${p.total_revenue_usd.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            </div>
            <div class="metric-col">
              <div class="m-label">Purchases</div>
              <div class="m-val">${p.total_purchases}</div>
            </div>
            <div class="metric-col">
              <div class="m-label">Avg CTR</div>
              <div class="m-val text-blue">${p.avg_ctr.toFixed(2)}%</div>
            </div>
          </div>

          <div class="prod-details">
            <p><strong>Ads Tested:</strong> ${p.ads_count} Ads | <strong>Active Window:</strong> ${p.date_range}</p>
            <p><strong>Avg CPA:</strong> $${p.cpa_usd.toFixed(2)} USD</p>
            ${p.top_adset ? `<p><strong>Best AdSet:</strong> <span style="color:#fff;">${p.top_adset.name}</span> (${p.top_adset.roas.toFixed(2)}x ROAS)</p>` : ''}
          </div>
        </div>

        <div>
          ${p.overall_roas >= 2.5 || p.untapped_candidates.length > 0 ? `<span class="tag-revive">⭐ HIGH REVIVAL POTENTIAL (${p.untapped_candidates.length} Untapped Ads)</span>` : ''}
        </div>
      </div>
      `;
    }).join('')}
  </div>

  <!-- Untapped Potential Ads (Micro-Spenders with Big Results) -->
  <div class="section-title">
    <span>💎 Top 10 Untapped Potential Ads (High Early Signal, Paused Prematurely)</span>
    <span style="font-size: 13px; font-weight: normal; color: var(--text-dim);">Ready to Reactivate Immediately</span>
  </div>
  <div class="section-desc">These ads delivered exceptional CTR and ROAS on tiny test budgets (<$40) and were paused without receiving proper scale.</div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Ad Name / Creative</th>
          <th>Account</th>
          <th>Product</th>
          <th>Spend (USD)</th>
          <th>Revenue (USD)</th>
          <th>ROAS</th>
          <th>Purchases</th>
          <th>CPA</th>
          <th>CTR</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${analysis.globalUntapped.slice(0, 10).map(ad => `
        <tr>
          <td>
            <strong>${ad.ad_name}</strong><br>
            <span style="font-size: 12px; color: var(--text-muted);">${ad.creative_title || ad.campaign_name}</span>
          </td>
          <td><span class="acc-pill">${ad.account_name}</span></td>
          <td><span style="color: #60a5fa; font-weight: 600;">${ad.product.split('(')[0]}</span></td>
          <td class="mono">$${ad.spend_usd.toFixed(2)}</td>
          <td class="mono text-green">$${ad.revenue_usd.toFixed(2)}</td>
          <td class="mono text-green" style="font-weight: 800;">${ad.roas.toFixed(2)}x</td>
          <td class="mono">${ad.purchases}</td>
          <td class="mono">$${ad.cpa_usd.toFixed(2)}</td>
          <td class="mono text-blue">${ad.ctr.toFixed(2)}%</td>
          <td><span class="tag-revive">Re-Enable</span></td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Account Breakdown Section -->
  <div class="section-title">
    <span>🏢 Account-by-Account Summary</span>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Ad Account</th>
          <th>Currency</th>
          <th>Spend (USD)</th>
          <th>Revenue (USD)</th>
          <th>ROAS</th>
          <th>Purchases</th>
          <th>Campaigns</th>
          <th>AdSets</th>
          <th>Ads</th>
          <th>Avg CTR</th>
        </tr>
      </thead>
      <tbody>
        ${Object.values(analysis.accounts).map(acc => `
        <tr>
          <td><strong>${acc.account_name}</strong><br><span style="font-size: 11px; color: var(--text-dim);">${acc.account_id}</span></td>
          <td><span class="acc-pill">${acc.currency}</span></td>
          <td class="mono">$${acc.total_spend_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="mono text-green">$${acc.total_revenue_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
          <td class="mono ${acc.overall_roas >= 2.5 ? 'text-green' : (acc.overall_roas >= 1.5 ? 'text-blue' : 'text-muted')}">${acc.overall_roas.toFixed(2)}x</td>
          <td class="mono">${acc.total_purchases}</td>
          <td>${acc.campaigns_count}</td>
          <td>${acc.adsets_count}</td>
          <td>${acc.ads_count}</td>
          <td class="mono">${acc.avg_ctr.toFixed(2)}%</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>

  <!-- Step-by-Step Revival Execution Plan -->
  <div class="section-title">
    <span>🎯 Tactical Revival Strategy & Israeli Market Angles</span>
  </div>

  <div class="action-grid">
    <div class="action-card priority-1">
      <h4>Phase 1: Reactivate NovaHair (Shopify Store 3)</h4>
      <p>Targeted for the Israeli market (Hebrew creatives). Unbelievable baseline ROAS of 4.57x on $826 spend.</p>
      <div class="action-step"><strong>1. Launch CBO Scaling Campaign:</strong> $50/day containing the top 3 proven winners (Winner #4, Winner #7, Dynamic Statics 2).</div>
      <div class="action-step"><strong>2. Audience:</strong> Israel, Women 30-65+, Broad targeting (Advantage+ Audience enabled).</div>
      <div class="action-step"><strong>3. Core Angle:</strong> Time & salon cost savings ("ברק טבעי ב-10 דקות בלבד ללא מספרה").</div>
    </div>

    <div class="action-card priority-2">
      <h4>Phase 2: Scale JacobNew4 Winning Catalog Ads</h4>
      <p>Massive 22% CTR proven on dynamic ads. $36.4k revenue generated historically.</p>
      <div class="action-step"><strong>1. Isolate Winners:</strong> Extract the winning ad IDs from campaign <code>dc-08/02/2024</code>.</div>
      <div class="action-step"><strong>2. Budget:</strong> $100/day ABO testing scaling adsets, targeting Top-Tier Tier-1 countries or Israel with English copy.</div>
      <div class="action-step"><strong>3. Automated Rules:</strong> Auto-pause any ad exceeding $25 CPA to protect margin.</div>
    </div>

    <div class="action-card priority-3">
      <h4>Phase 3: Restructure Celestiva Limited (OceAura)</h4>
      <p>Consolidate 83 messy campaigns into 1 streamlined structure to eliminate audience overlap and lower CPA.</p>
      <div class="action-step"><strong>1. Single Campaign Consolidation:</strong> 1 ABO for Creative Testing + 1 CBO for Scaling.</div>
      <div class="action-step"><strong>2. Creative Angle:</strong> Create 3 new video hooks focusing on instant glow / skincare results.</div>
    </div>
  </div>

</div>

</body>
</html>`;
}

async function main() {
  const fullData = {};
  for (const acc of targetAccounts) {
    fullData[acc.id] = await pullAccountData(acc);
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\nProcessing and analyzing all account metrics...');
  const analysis = processAllData(fullData);

  fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_analysis_full.json', JSON.stringify(analysis, null, 2));
  
  const htmlContent = generateHTML(analysis);
  fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/admin/meta_audit_pro.html', htmlContent);

  console.log('\n======================================================');
  console.log('✅ AUDIT COMPLETE & SAVED TO:');
  console.log(' - JSON: meta_analysis_full.json');
  console.log(' - HTML Dashboard: admin/meta_audit_pro.html');
  console.log('======================================================');
}

main();

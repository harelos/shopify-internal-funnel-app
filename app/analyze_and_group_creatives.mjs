import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_deep_extraction_raw.json', 'utf8'));

const ads = raw.ads || [];
const demo = raw.demographics || [];
const devices = raw.devices || [];
const placements = raw.placements || [];

// 1. Group Ads by Unique Creative / Product / Landing URL
const creativeGroups = {};

ads.forEach(ad => {
  if (ad.spend_usd === 0 && ad.purchases === 0) return; // Skip zero-spend ads

  // Normalize key by landing_url or copy text or headline
  let key = ad.landing_url ? ad.landing_url.split('?')[0].toLowerCase() : '';
  if (!key && ad.headline) key = ad.headline.trim().toLowerCase();
  if (!key && ad.copy_text) key = ad.copy_text.slice(0, 50).trim().toLowerCase();
  if (!key) key = ad.ad_name.trim().toLowerCase();

  if (!creativeGroups[key]) {
    creativeGroups[key] = {
      key: key,
      sample_headline: ad.headline,
      sample_copy: ad.copy_text,
      landing_url: ad.landing_url,
      image_thumb: ad.image_thumb,
      accounts: new Set(),
      ad_names: new Set(),
      total_spend_usd: 0,
      total_revenue_usd: 0,
      total_purchases: 0,
      total_clicks: 0,
      total_impressions: 0,
      ad_count: 0,
      instances: []
    };
  }

  const g = creativeGroups[key];
  g.accounts.add(ad.account_name);
  g.ad_names.add(ad.ad_name);
  g.total_spend_usd += ad.spend_usd;
  g.total_revenue_usd += ad.revenue_usd;
  g.total_purchases += ad.purchases;
  g.total_clicks += ad.clicks;
  g.total_impressions += ad.impressions;
  g.ad_count += 1;
  g.instances.push(ad);
});

// Process Grouped Creatives
const groupedList = Object.values(creativeGroups).map(g => {
  const roas = g.total_spend_usd > 0 ? (g.total_revenue_usd / g.total_spend_usd) : 0;
  const cpa = g.total_purchases > 0 ? (g.total_spend_usd / g.total_purchases) : 0;
  const ctr = g.total_impressions > 0 ? ((g.total_clicks / g.total_impressions) * 100) : 0;

  // Copy length classification
  const copyLen = (g.sample_copy || '').length;
  let copyType = 'Short (<150 chars)';
  if (copyLen >= 150 && copyLen < 400) copyType = 'Medium (150-400 chars)';
  if (copyLen >= 400) copyType = 'Long (>400 chars)';

  // Identify real product name from landing URL or copy text
  let productName = 'Uncategorized / Catalog';
  const textCheck = (g.landing_url + ' ' + g.sample_copy + ' ' + g.sample_headline + ' ' + Array.from(g.ad_names).join(' ')).toLowerCase();

  if (textCheck.includes('nova') || textCheck.includes('hair') || textCheck.includes('שיער') || textCheck.includes('צבע')) {
    productName = 'NovaHair (שמפו צבע לשיער / Hair Dye Shampoo)';
  } else if (textCheck.includes('elastic') || textCheck.includes('bra') || textCheck.includes('חזייה') || textCheck.includes('lift')) {
    productName = 'ElasticDream / Elegance Bra (חזיית אלסטיק-דרים)';
  } else if (textCheck.includes('skin') || textCheck.includes(' sleep') || textCheck.includes('עור') || textCheck.includes('התחדש') || textCheck.includes('בוקר')) {
    productName = 'Nighttime Skin Renewal (קרם / סרום חידוש עור בלילה)';
  } else if (textCheck.includes('insole') || textCheck.includes('ortho') || textCheck.includes('מדרס')) {
    productName = 'Orthopedic Insoles (מדרסים אורתופדיים)';
  } else if (textCheck.includes('posture') || textCheck.includes('back') || textCheck.includes('גב')) {
    productName = 'Posture Corrector (תומך גב)';
  } else if (textCheck.includes('dynamic') || textCheck.includes('dc-08')) {
    productName = 'Dynamic Catalog / Multi-Product';
  } else if (textCheck.includes('oceaura') || textCheck.includes('skincare')) {
    productName = 'OceAura Skincare';
  }

  return {
    key: g.key,
    product_name: productName,
    headline: g.sample_headline || 'N/A',
    copy_text: g.sample_copy || 'N/A',
    copy_type: copyType,
    landing_url: g.landing_url || 'N/A',
    image_thumb: g.image_thumb || '',
    accounts: Array.from(g.accounts),
    ad_count: g.ad_count,
    ad_names_sample: Array.from(g.ad_names).slice(0, 4),
    spend_usd: g.total_spend_usd,
    revenue_usd: g.total_revenue_usd,
    roas: roas,
    purchases: g.total_purchases,
    cpa_usd: cpa,
    ctr: ctr,
    impressions: g.total_impressions,
    clicks: g.total_clicks
  };
}).sort((a, b) => b.spend_usd - a.spend_usd);

// Group by Product
const productAgg = {};
groupedList.forEach(g => {
  if (!productAgg[g.product_name]) {
    productAgg[g.product_name] = {
      product_name: g.product_name,
      total_spend_usd: 0,
      total_revenue_usd: 0,
      total_purchases: 0,
      total_impressions: 0,
      total_clicks: 0,
      ad_count: 0,
      accounts: new Set(),
      creatives: []
    };
  }
  const p = productAgg[g.product_name];
  p.total_spend_usd += g.spend_usd;
  p.total_revenue_usd += g.revenue_usd;
  p.total_purchases += g.purchases;
  p.total_impressions += g.impressions;
  p.total_clicks += g.clicks;
  p.ad_count += g.ad_count;
  g.accounts.forEach(a => p.accounts.add(a));
  p.creatives.push(g);
});

const productsList = Object.values(productAgg).map(p => ({
  product_name: p.product_name,
  accounts: Array.from(p.accounts),
  total_spend_usd: p.total_spend_usd,
  total_revenue_usd: p.total_revenue_usd,
  roas: p.total_spend_usd > 0 ? (p.total_revenue_usd / p.total_spend_usd) : 0,
  total_purchases: p.total_purchases,
  cpa_usd: p.total_purchases > 0 ? (p.total_spend_usd / p.total_purchases) : 0,
  ctr: p.total_impressions > 0 ? ((p.total_clicks / p.total_impressions) * 100) : 0,
  ad_count: p.ad_count,
  top_creatives: p.creatives.sort((a, b) => b.roas - a.roas).slice(0, 5),
  untapped_creatives: p.creatives.filter(c => c.spend_usd <= 50 && (c.roas >= 3.0 || c.ctr >= 4.0)).sort((a, b) => b.roas - a.roas)
})).sort((a, b) => b.total_spend_usd - a.total_spend_usd);

// 2. Demographic Analysis (Age & Gender)
const demoGrouped = {};
demo.forEach(d => {
  if (d.spend_usd === 0) return;
  const key = `${d.gender}_${d.age}`;
  if (!demoGrouped[key]) {
    demoGrouped[key] = { gender: d.gender, age: d.age, spend_usd: 0, revenue_usd: 0, purchases: 0, impressions: 0, clicks: 0 };
  }
  demoGrouped[key].spend_usd += d.spend_usd;
  demoGrouped[key].revenue_usd += d.revenue_usd;
  demoGrouped[key].purchases += d.purchases;
  demoGrouped[key].impressions += d.impressions;
  demoGrouped[key].clicks += d.clicks;
});

const demoList = Object.values(demoGrouped).map(d => ({
  ...d,
  roas: d.spend_usd > 0 ? (d.revenue_usd / d.spend_usd) : 0,
  cpa_usd: d.purchases > 0 ? (d.spend_usd / d.purchases) : 0,
  ctr: d.impressions > 0 ? ((d.clicks / d.impressions) * 100) : 0
})).sort((a, b) => b.purchases - a.purchases || b.revenue_usd - a.revenue_usd);

// 3. Device & Platform Breakdown
const deviceGrouped = {};
devices.forEach(d => {
  if (d.spend_usd === 0) return;
  const key = `${d.device_platform}_${d.impression_device}`;
  if (!deviceGrouped[key]) {
    deviceGrouped[key] = { platform: d.device_platform, device: d.impression_device, spend_usd: 0, revenue_usd: 0, purchases: 0, impressions: 0, clicks: 0 };
  }
  deviceGrouped[key].spend_usd += d.spend_usd;
  deviceGrouped[key].revenue_usd += d.revenue_usd;
  deviceGrouped[key].purchases += d.purchases;
  deviceGrouped[key].impressions += d.impressions;
  deviceGrouped[key].clicks += d.clicks;
});

const deviceList = Object.values(deviceGrouped).map(d => ({
  ...d,
  roas: d.spend_usd > 0 ? (d.revenue_usd / d.spend_usd) : 0,
  cpa_usd: d.purchases > 0 ? (d.spend_usd / d.purchases) : 0,
  ctr: d.impressions > 0 ? ((d.clicks / d.impressions) * 100) : 0
})).sort((a, b) => b.purchases - a.purchases);

// 4. Publisher Placement Breakdown (FB vs IG)
const placementGrouped = {};
placements.forEach(p => {
  if (p.spend_usd === 0) return;
  const key = `${p.publisher_platform}_${p.platform_position}`;
  if (!placementGrouped[key]) {
    placementGrouped[key] = { platform: p.publisher_platform, position: p.platform_position, spend_usd: 0, revenue_usd: 0, purchases: 0, impressions: 0, clicks: 0 };
  }
  placementGrouped[key].spend_usd += p.spend_usd;
  placementGrouped[key].revenue_usd += p.revenue_usd;
  placementGrouped[key].purchases += p.purchases;
  placementGrouped[key].impressions += p.impressions;
  placementGrouped[key].clicks += p.clicks;
});

const placementList = Object.values(placementGrouped).map(p => ({
  ...p,
  roas: p.spend_usd > 0 ? (p.revenue_usd / p.spend_usd) : 0,
  cpa_usd: p.purchases > 0 ? (p.spend_usd / p.purchases) : 0,
  ctr: p.impressions > 0 ? ((p.clicks / p.impressions) * 100) : 0
})).sort((a, b) => b.purchases - a.purchases);

// Output Master JSON
const masterResult = {
  products: productsList,
  grouped_creatives: groupedList.slice(0, 50),
  demographics: demoList,
  devices: deviceList,
  placements: placementList
};

fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_marketing_master_audit.json', JSON.stringify(masterResult, null, 2));

console.log('\n=======================================================');
console.log('✅ MARKETING AUDIT COMPLETE & GROUPED:');
console.log(` - Products Categorized: ${productsList.length}`);
console.log(` - Top Unique Creatives Grouped: ${groupedList.length}`);
console.log(` - Demographics Breakdown Segments: ${demoList.length}`);
console.log(` - Device Breakdown Segments: ${deviceList.length}`);
console.log(` - Placement Breakdown Segments: ${placementList.length}`);
console.log('=======================================================\n');

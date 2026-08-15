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
      if (data.error) break;
      if (data.data && Array.isArray(data.data)) {
        allData = allData.concat(data.data);
      }
      nextUrl = data.paging && data.paging.next ? data.paging.next : null;
    } catch (e) {
      break;
    }
  }
  return allData;
}

async function runDeepExtraction() {
  console.log('=== STARTING DEEP META MARKETING EXTRACTION ===');
  const allAdsData = [];
  const demographicsData = [];
  const deviceData = [];
  const placementData = [];

  for (const acc of targetAccounts) {
    console.log(`\nFetching full data for ${acc.name} (${acc.id})...`);

    // 1. Fetch AdCreatives
    const crUrl = `https://graph.facebook.com/v21.0/${acc.id}/adcreatives?fields=id,name,title,body,object_story_spec,asset_feed_spec,thumbnail_url,image_url&limit=100&access_token=${token}`;
    const crList = await fetchPaging(crUrl, 4);
    const crMap = {};
    crList.forEach(c => { crMap[c.id] = c; });

    // 2. Fetch Ads with Insights
    const adsUrl = `https://graph.facebook.com/v21.0/${acc.id}/ads?fields=id,name,status,effective_status,campaign_id,adset_id,created_time,creative{id},insights.date_preset(maximum){spend,impressions,clicks,cpc,ctr,purchase_roas,actions,action_values,date_start,date_stop}&limit=100&access_token=${token}`;
    const adsList = await fetchPaging(adsUrl, 4);

    // 3. Fetch Campaigns & Adsets for names
    const campsUrl = `https://graph.facebook.com/v21.0/${acc.id}/campaigns?fields=id,name,objective,daily_budget,lifetime_budget&limit=100&access_token=${token}`;
    const campsList = await fetchPaging(campsUrl, 2);
    const campMap = {};
    campsList.forEach(c => { campMap[c.id] = c; });

    const adsetsUrl = `https://graph.facebook.com/v21.0/${acc.id}/adsets?fields=id,name,targeting,daily_budget,lifetime_budget&limit=100&access_token=${token}`;
    const adsetsList = await fetchPaging(adsetsUrl, 3);
    const adsetMap = {};
    adsetsList.forEach(a => { adsetMap[a.id] = a; });

    adsList.forEach(ad => {
      const crId = ad.creative ? ad.creative.id : null;
      const creative = crMap[crId] || {};
      const insight = (ad.insights && ad.insights.data && ad.insights.data[0]) ? ad.insights.data[0] : null;

      const rawSpend = insight ? parseFloat(insight.spend || 0) : 0;
      const spendUSD = toUSD(rawSpend, acc.currency);

      let purchases = 0;
      let revenueUSD = 0;
      if (insight && insight.actions) {
        const pAction = insight.actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
        if (pAction) purchases = parseInt(pAction.value || 0);
      }
      if (insight && insight.action_values) {
        const pVal = insight.action_values.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
        if (pVal) revenueUSD = toUSD(pVal.value || 0, acc.currency);
      }

      // Extract Story Spec details
      const linkData = creative.object_story_spec?.link_data || {};
      const videoData = creative.object_story_spec?.video_data || {};

      let landingUrl = linkData.link || linkData.call_to_action?.value?.link || '';
      let copyText = linkData.message || videoData.message || creative.body || '';
      let headline = linkData.name || videoData.title || creative.title || '';
      let description = linkData.description || '';
      let imageThumb = creative.image_url || creative.thumbnail_url || linkData.picture || videoData.image_url || '';

      // If Asset Feed (Dynamic Creative)
      if (creative.asset_feed_spec) {
        const af = creative.asset_feed_spec;
        if (!copyText && af.bodies && af.bodies[0]) copyText = af.bodies[0].text;
        if (!headline && af.titles && af.titles[0]) headline = af.titles[0].text;
        if (!description && af.descriptions && af.descriptions[0]) description = af.descriptions[0].text;
        if (!landingUrl && af.link_urls && af.link_urls[0]) landingUrl = af.link_urls[0].website_url;
      }

      const campaignName = campMap[ad.campaign_id] ? campMap[ad.campaign_id].name : 'Unknown Campaign';
      const adsetName = adsetMap[ad.adset_id] ? adsetMap[ad.adset_id].name : 'Unknown Adset';
      const targeting = adsetMap[ad.adset_id] ? adsetMap[ad.adset_id].targeting : null;

      allAdsData.push({
        account_id: acc.id,
        account_name: acc.name,
        currency: acc.currency,
        campaign_id: ad.campaign_id,
        campaign_name: campaignName,
        adset_id: ad.adset_id,
        adset_name: adsetName,
        ad_id: ad.id,
        ad_name: ad.name,
        status: ad.status,
        effective_status: ad.effective_status,
        creative_id: crId,
        landing_url: landingUrl,
        copy_text: copyText,
        headline: headline,
        description: description,
        image_thumb: imageThumb,
        targeting: targeting,
        spend_usd: spendUSD,
        revenue_usd: revenueUSD,
        purchases: purchases,
        roas: spendUSD > 0 ? (revenueUSD / spendUSD) : 0,
        cpa_usd: purchases > 0 ? (spendUSD / purchases) : 0,
        impressions: insight ? parseInt(insight.impressions || 0) : 0,
        clicks: insight ? parseInt(insight.clicks || 0) : 0,
        ctr: insight ? parseFloat(insight.ctr || 0) : 0,
        cpc_usd: insight ? toUSD(insight.cpc || 0, acc.currency) : 0,
        date_start: insight ? insight.date_start : 'N/A',
        date_stop: insight ? insight.date_stop : 'N/A'
      });
    });

    // 4. Fetch Age/Gender Breakdown
    try {
      const demoUrl = `https://graph.facebook.com/v21.0/${acc.id}/insights?date_preset=maximum&level=account&breakdowns=age,gender&fields=spend,actions,action_values,impressions,clicks&limit=50&access_token=${token}`;
      const demoRes = await fetch(demoUrl);
      const demoJson = await demoRes.json();
      if (demoJson.data) {
        demoJson.data.forEach(d => {
          let p = 0, rev = 0;
          if (d.actions) {
            const pa = d.actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
            if (pa) p = parseInt(pa.value || 0);
          }
          if (d.action_values) {
            const pv = d.action_values.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
            if (pv) rev = toUSD(pv.value || 0, acc.currency);
          }
          demographicsData.push({
            account_name: acc.name,
            age: d.age,
            gender: d.gender,
            spend_usd: toUSD(d.spend || 0, acc.currency),
            revenue_usd: rev,
            purchases: p,
            impressions: parseInt(d.impressions || 0),
            clicks: parseInt(d.clicks || 0)
          });
        });
      }
    } catch (e) {}

    // 5. Fetch Impression Device & Platform Breakdown
    try {
      const devUrl = `https://graph.facebook.com/v21.0/${acc.id}/insights?date_preset=maximum&level=account&breakdowns=impression_device,device_platform&fields=spend,actions,action_values,impressions,clicks&limit=50&access_token=${token}`;
      const devRes = await fetch(devUrl);
      const devJson = await devRes.json();
      if (devJson.data) {
        devJson.data.forEach(d => {
          let p = 0, rev = 0;
          if (d.actions) {
            const pa = d.actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
            if (pa) p = parseInt(pa.value || 0);
          }
          if (d.action_values) {
            const pv = d.action_values.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
            if (pv) rev = toUSD(pv.value || 0, acc.currency);
          }
          deviceData.push({
            account_name: acc.name,
            device_platform: d.device_platform,
            impression_device: d.impression_device,
            spend_usd: toUSD(d.spend || 0, acc.currency),
            revenue_usd: rev,
            purchases: p,
            impressions: parseInt(d.impressions || 0),
            clicks: parseInt(d.clicks || 0)
          });
        });
      }
    } catch (e) {}

    // 6. Fetch Publisher Platform Breakdown (FB vs IG vs Audience Network)
    try {
      const pubUrl = `https://graph.facebook.com/v21.0/${acc.id}/insights?date_preset=maximum&level=account&breakdowns=publisher_platform,platform_position&fields=spend,actions,action_values,impressions,clicks&limit=50&access_token=${token}`;
      const pubRes = await fetch(pubUrl);
      const pubJson = await pubRes.json();
      if (pubJson.data) {
        pubJson.data.forEach(d => {
          let p = 0, rev = 0;
          if (d.actions) {
            const pa = d.actions.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
            if (pa) p = parseInt(pa.value || 0);
          }
          if (d.action_values) {
            const pv = d.action_values.find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase');
            if (pv) rev = toUSD(pv.value || 0, acc.currency);
          }
          placementData.push({
            account_name: acc.name,
            publisher_platform: d.publisher_platform,
            platform_position: d.platform_position,
            spend_usd: toUSD(d.spend || 0, acc.currency),
            revenue_usd: rev,
            purchases: p,
            impressions: parseInt(d.impressions || 0),
            clicks: parseInt(d.clicks || 0)
          });
        });
      }
    } catch (e) {}
  }

  const outputPayload = {
    ads: allAdsData,
    demographics: demographicsData,
    devices: deviceData,
    placements: placementData
  };

  fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_deep_extraction_raw.json', JSON.stringify(outputPayload, null, 2));
  console.log('\n=======================================================');
  console.log(`SUCCESS: Extracted ${allAdsData.length} ads, ${demographicsData.length} demo records, ${deviceData.length} device records, ${placementData.length} placement records.`);
  console.log('Saved to meta_deep_extraction_raw.json');
  console.log('=======================================================\n');
}

runDeepExtraction();

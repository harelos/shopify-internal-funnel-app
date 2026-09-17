import fs from 'node:fs';

const token = 'EAAOLLFDEGuIBSPBoKRqOM3VQIS17hEJHoL8ynB6giuanBiU8YU4HBXkZAzUM9ZB3xVDUWCGTVbZCl2Ua6e9PF0GFnY58BPsA58XZCypeMqCsr04ed3XCYNzIJRUzve8WGpClSeWdh8OnBo8R7duuoiRmg9fZAIl18J8aCz0oc8cFngiInOdDBjQKmYxEgUDEv5SRm';

async function fetchAdsForAccount(accId) {
  try {
    const url = `https://graph.facebook.com/v21.0/${accId}/ads?fields=id,name,status,effective_status,campaign{id,name},adset{id,name,targeting},creative{id,name,title,body,image_url,thumbnail_url,object_story_spec}&limit=100&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error('Error fetching ads for ' + accId, e);
    return [];
  }
}

async function fetchInsightsForAccount(accId) {
  try {
    const url = `https://graph.facebook.com/v21.0/${accId}/insights?date_preset=maximum&level=ad&fields=ad_id,ad_name,campaign_name,adset_name,spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type&limit=100&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    return data.data || [];
  } catch (e) {
    console.error('Error fetching insights for ' + accId, e);
    return [];
  }
}

async function analyzeAll() {
  const accounts = [
    { id: 'act_8852331774866389', name: 'Shopify Store 3', currency: 'USD' },
    { id: 'act_3887802441433954', name: 'Celestiva Limited 1', currency: 'HKD' },
    { id: 'act_1485755002230457', name: 'JacobNew4', currency: 'USD' },
    { id: 'act_1415509685957819', name: 'JacobNew7', currency: 'USD' }
  ];

  const fullReport = {};

  for (const acc of accounts) {
    console.log(`Processing ${acc.name}...`);
    const ads = await fetchAdsForAccount(acc.id);
    const insights = await fetchInsightsForAccount(acc.id);

    console.log(` -> Ads: ${ads.length}, Ad Insights: ${insights.length}`);
    fullReport[acc.id] = {
      account: acc,
      ads,
      insights
    };
  }

  fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_deep_insights.json', JSON.stringify(fullReport, null, 2));
  console.log('Saved deep insights to meta_deep_insights.json');
}

analyzeAll();

import fs from 'node:fs';

const token = 'EAAOLLFDEGuIBSPBoKRqOM3VQIS17hEJHoL8ynB6giuanBiU8YU4HBXkZAzUM9ZB3xVDUWCGTVbZCl2Ua6e9PF0GFnY58BPsA58XZCypeMqCsr04ed3XCYNzIJRUzve8WGpClSeWdh8OnBo8R7duuoiRmg9fZAIl18J8aCz0oc8cFngiInOdDBjQKmYxEgUDEv5SRm';

const accounts = [
  { id: 'act_8852331774866389', name: 'Shopify Store 3' },
  { id: 'act_3887802441433954', name: 'Celestiva Limited 1' },
  { id: 'act_1485755002230457', name: 'JacobNew4' },
  { id: 'act_1415509685957819', name: 'JacobNew7' }
];

async function pullAccountData(acc) {
  console.log('Fetching full data for:', acc.name, '(' + acc.id + ')...');
  const result = { account: acc, campaigns: [], adsets: [], ads: [] };

  try {
    // 1. Fetch campaigns
    const campUrl = `https://graph.facebook.com/v21.0/${acc.id}/campaigns?fields=id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,insights.date_preset(maximum){spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type}&limit=100&access_token=${token}`;
    const campRes = await fetch(campUrl);
    const campData = await campRes.json();
    result.campaigns = campData.data || [];

    // 2. Fetch adsets with targeting
    const adsetUrl = `https://graph.facebook.com/v21.0/${acc.id}/adsets?fields=id,name,status,effective_status,campaign_id,targeting,billing_event,optimization_goal,bid_amount,daily_budget,lifetime_budget,insights.date_preset(maximum){spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type}&limit=100&access_token=${token}`;
    const adsetRes = await fetch(adsetUrl);
    const adsetData = await adsetRes.json();
    result.adsets = adsetData.data || [];

    // 3. Fetch ads with creative details & full insights
    const adsUrl = `https://graph.facebook.com/v21.0/${acc.id}/ads?fields=id,name,status,effective_status,campaign_id,adset_id,creative{id,name,title,body,image_url,thumbnail_url,object_story_spec},insights.date_preset(maximum){spend,impressions,clicks,cpc,cpm,ctr,purchase_roas,actions,action_values,cost_per_action_type,video_play_actions,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions}&limit=150&access_token=${token}`;
    const adsRes = await fetch(adsUrl);
    const adsData = await adsRes.json();
    result.ads = adsData.data || [];

    console.log(` -> Found: ${result.campaigns.length} campaigns, ${result.adsets.length} adsets, ${result.ads.length} ads.`);
  } catch (err) {
    console.error('Error fetching for', acc.name, err);
  }

  return result;
}

async function main() {
  const allResults = {};
  for (const acc of accounts) {
    allResults[acc.id] = await pullAccountData(acc);
  }
  fs.writeFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_audit_data.json', JSON.stringify(allResults, null, 2));
  console.log('SUCCESS: All 4 accounts data saved to meta_audit_data.json');
}

main();

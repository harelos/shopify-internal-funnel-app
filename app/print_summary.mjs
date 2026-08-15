import fs from 'node:fs';
const summary = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_audit_summary.json', 'utf-8'));

for (const [id, acc] of Object.entries(summary)) {
  console.log('==============================================');
  console.log(`ACCOUNT: ${acc.account_name} (${id})`);
  console.log(`Currency: ${acc.currency} | Total Spend: ${acc.total_spend} | Purchases: ${acc.total_purchases} | Revenue: ${acc.total_revenue} | ROAS: ${acc.overall_roas.toFixed(2)}`);
  console.log(`Campaigns: ${acc.total_campaigns} | Adsets: ${acc.total_adsets} | Ads: ${acc.total_ads}`);
  
  console.log('\n--- TOP WINNERS (By ROAS & Purchases) ---');
  acc.top_winners.slice(0, 6).forEach(w => {
    console.log(`  * ${w.ad_name} (${w.campaign_name})`);
    console.log(`    Spend: ${w.spend} | ROAS: ${w.roas.toFixed(2)}x | Purchases: ${w.purchases} | CPA: ${w.cpa.toFixed(2)} | CTR: ${w.ctr.toFixed(2)}%`);
    if (w.creative_title || w.creative_body) {
      console.log(`    Title: "${w.creative_title}" | Body: "${w.creative_body.slice(0, 70)}..."`);
    }
  });

  console.log('\n--- TOP SPENDERS ---');
  acc.top_spenders.slice(0, 6).forEach(s => {
    console.log(`  * ${s.ad_name} | Spend: ${s.spend} | ROAS: ${s.roas.toFixed(2)}x | Purchases: ${s.purchases} | CPA: ${s.cpa.toFixed(2)} | CTR: ${s.ctr.toFixed(2)}%`);
  });

  console.log('\n--- BIGGEST BLEEDERS (Spent without purchases) ---');
  acc.bleeders.slice(0, 4).forEach(b => {
    console.log(`  * ${b.ad_name} | Spend: ${b.spend} | CTR: ${b.ctr.toFixed(2)}% | CPC: ${b.cpc.toFixed(2)}`);
  });
}

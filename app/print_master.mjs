import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_marketing_master_audit.json', 'utf8'));

console.log('=== REAL PRODUCTS & LANDING URLS (USD) ===');
d.products.forEach(p => {
  console.log('----------------------------------------------------');
  console.log('PRODUCT:', p.product_name);
  console.log('  Accounts:', p.accounts.join(', '));
  console.log(`  Spend: $${p.total_spend_usd.toFixed(2)} | Rev: $${p.total_revenue_usd.toFixed(2)} | ROAS: ${p.roas.toFixed(2)}x | Purchases: ${p.total_purchases} | CPA: $${p.cpa_usd.toFixed(2)} | Avg CTR: ${p.ctr.toFixed(2)}%`);
  console.log('  Ad Count (including duplicates):', p.ad_count);
  console.log('  Top 3 Creatives by ROAS:');
  p.top_creatives.slice(0, 3).forEach(c => {
    console.log(`    * Headline: "${c.headline}"`);
    console.log(`      URL: ${c.landing_url}`);
    console.log(`      Spend: $${c.spend_usd.toFixed(2)} | Rev: $${c.revenue_usd.toFixed(2)} | ROAS: ${c.roas.toFixed(2)}x | Purchases: ${c.purchases} | CPA: $${c.cpa_usd.toFixed(2)} | CTR: ${c.ctr.toFixed(2)}% | Duplicates Combined: ${c.ad_count}`);
    console.log(`      Copy Snippet: "${(c.copy_text || '').slice(0, 90).replace(/\n/g, ' ')}..."`);
  });
});

console.log('\n=== DEMOGRAPHICS BREAKDOWN (TOP PURCHASING SEGMENTS) ===');
d.demographics.slice(0, 10).forEach(dm => {
  console.log(`  * ${dm.gender.toUpperCase()} | Age: ${dm.age} | Purchases: ${dm.purchases} | Revenue: $${dm.revenue_usd.toFixed(2)} | Spend: $${dm.spend_usd.toFixed(2)} | ROAS: ${dm.roas.toFixed(2)}x | CPA: $${dm.cpa_usd.toFixed(2)}`);
});

console.log('\n=== DEVICE & PLATFORM BREAKDOWN ===');
d.devices.slice(0, 8).forEach(dv => {
  console.log(`  * Platform: ${dv.platform} | Device: ${dv.device} | Purchases: ${dv.purchases} | Revenue: $${dv.revenue_usd.toFixed(2)} | Spend: $${dv.spend_usd.toFixed(2)} | ROAS: ${dv.roas.toFixed(2)}x`);
});

console.log('\n=== PUBLISHER PLACEMENT BREAKDOWN ===');
d.placements.slice(0, 8).forEach(pl => {
  console.log(`  * Platform: ${pl.platform} | Position: ${pl.position} | Purchases: ${pl.purchases} | Revenue: $${pl.revenue_usd.toFixed(2)} | Spend: $${pl.spend_usd.toFixed(2)} | ROAS: ${pl.roas.toFixed(2)}x`);
});

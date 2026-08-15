import fs from 'node:fs';

const rawData = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_deep_insights.json', 'utf-8'));
const auditData = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_audit_data.json', 'utf-8'));

for (const [id, data] of Object.entries(rawData)) {
  console.log(`\n================== DETAILED CREATIVE & TARGETING: ${data.account.name} ==================`);
  
  const ads = data.ads || [];
  const adsets = auditData[id]?.adsets || [];
  
  console.log('--- TARGETING IN ADSETS ---');
  adsets.slice(0, 5).forEach(as => {
    console.log(`AdSet: "${as.name}" (Status: ${as.status})`);
    console.log(`  Optimization: ${as.optimization_goal} | Billing: ${as.billing_event}`);
    console.log(`  Targeting:`, JSON.stringify(as.targeting, null, 2));
  });

  console.log('--- CREATIVES DETAILS ---');
  ads.slice(0, 5).forEach(a => {
    const c = a.creative || {};
    console.log(`Ad: "${a.name}" (ID: ${a.id})`);
    console.log(`  Title: "${c.title || ''}"`);
    console.log(`  Body: "${c.body || ''}"`);
    console.log(`  Image/Thumb: ${c.image_url || c.thumbnail_url || 'N/A'}`);
    if (c.object_story_spec?.link_data) {
      const ld = c.object_story_spec.link_data;
      console.log(`  Link: ${ld.link} | Call to Action: ${ld.call_to_action?.type}`);
      console.log(`  Message: ${ld.message}`);
    }
  });
}

import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync('C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/meta_deep_extraction_raw.json', 'utf8'));
console.log('Total ads:', d.ads.length);

const creativeMap = {};
d.ads.forEach(ad => {
  const normCopy = (ad.copy_text || '').trim().replace(/\s+/g, ' ');
  const normHead = (ad.headline || '').trim();
  const key = `${ad.account_name}___${normHead}___${normCopy.substring(0, 50)}`;

  if (!creativeMap[key]) {
    creativeMap[key] = {
      account: ad.account_name,
      sample_ad_name: ad.ad_name,
      headline: normHead,
      copy_full: normCopy,
      image_url: ad.image_url,
      video_id: ad.video_id,
      destination: ad.link_url || 'shop.tigerbrandsglobal.com',
      ads_count: 0,
      creative_ids: new Set(),
      ad_ids: new Set()
    };
  }
  creativeMap[key].ads_count++;
  if (ad.creative_id) creativeMap[key].creative_ids.add(ad.creative_id);
  creativeMap[key].ad_ids.add(ad.ad_id);
});

const list = Object.values(creativeMap).sort((a, b) => b.ads_count - a.ads_count);
console.log(`Unique creative clusters: ${list.length}`);

list.slice(0, 15).forEach((c, idx) => {
  console.log(`\n#${idx + 1}: [${c.account}] Ads Count: ${c.ads_count}`);
  console.log(`Sample Name: ${c.sample_ad_name}`);
  console.log(`Headline: ${c.headline}`);
  console.log(`Copy: ${c.copy_full.substring(0, 120)}...`);
  console.log(`Creative IDs: ${Array.from(c.creative_ids).slice(0, 3).join(', ')}`);
});

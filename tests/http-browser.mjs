import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const out='browser-evidence';await fs.mkdir(out,{recursive:true});
const results=[];
const browser=await chromium.launch({headless:true});
const base='http://127.0.0.1:8080/index.html';
let failed=false;
async function check(name,fn){try{const detail=await fn();results.push({name,pass:true,detail});console.log('PASS',name);}catch(e){failed=true;results.push({name,pass:false,error:String(e)});console.error('FAIL',name,String(e));}}
async function newPage(width=390){
 const c=await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});
 const p=await c.newPage();p.errors=[];p.requests=[];
 p.on('pageerror',e=>p.errors.push(String(e)));p.on('request',r=>p.requests.push({url:r.url(),method:r.method(),type:r.resourceType()}));
 await p.addInitScript(()=>{window.__frames=[];function frame(){const el=document.getElementById('gallery-slot');if(el)window.__frames.push({arm:el.dataset.renderedVariant,hasA:!!el.querySelector('#galMain')});requestAnimationFrame(frame);}requestAnimationFrame(frame);});
 return {p,c};
}
await check('B first render uses real copied images and never mounts control',async()=>{
 const {p,c}=await newPage();await p.goto(base+'?variant=variant-b&view=page');await p.waitForFunction(()=>window.NHGalleryLab?.state.firstImageReady,{},{timeout:20000});await p.waitForTimeout(300);
 const frames=await p.evaluate(()=>window.__frames);if(frames.some(f=>f.hasA||f.arm!=='variant-b'))throw Error('Control appeared');if(p.errors.length)throw Error(p.errors.join('\n'));
 const images=await p.locator('#labGalleryB').evaluate(el=>({width:el.naturalWidth,height:el.naturalHeight,src:el.currentSrc}));if(!images.width)throw Error('Real B image missing');
 await p.screenshot({path:out+'/mobile-B-real.png',fullPage:true});
 if(p.requests.some(r=>r.method!=='GET'||r.url.includes('/apps/funnels')||r.url.includes('posthog')||r.url.includes('facebook.com')))throw Error('Forbidden production request');
 await c.close();return {frames:frames.length,images,requests:p.requests};
});
await check('A image loads from original public Shopify CDN',async()=>{
 const {p,c}=await newPage();await p.goto(base+'?variant=control&view=page');await p.waitForFunction(()=>window.NHGalleryLab?.state.firstImageReady,{},{timeout:20000});
 if(await p.locator('.fce-gallery').count())throw Error('B mounted for A');await p.screenshot({path:out+'/mobile-A-real.png',fullPage:true});await c.close();
});
await check('Real browser storage retains assignment through reloads and new tab',async()=>{
 const {p,c}=await newPage();await p.goto(base);const first=await p.evaluate(()=>NHGalleryLab.state.decision.assignment);
 for(let i=0;i<5;i++){await p.reload();const value=await p.evaluate(()=>NHGalleryLab.state.decision.assignment);if(JSON.stringify(value)!==JSON.stringify(first))throw Error('Assignment changed');}
 const second=await c.newPage();await second.goto(base);if((await second.evaluate(()=>NHGalleryLab.state.visitorId))!==first.visitorId)throw Error('New tab identity changed');await c.close();return {reloads:5,newTab:true};
});
await check('Delayed real B image still cannot show A',async()=>{
 const {p,c}=await newPage();await p.route('**/images/01-roots-returned.webp',async route=>{await new Promise(r=>setTimeout(r,3500));await route.continue();});
 await p.goto(base+'?variant=variant-b&view=page',{waitUntil:'domcontentloaded'});await p.waitForTimeout(1800);if(await p.locator('#galMain').count())throw Error('Control appeared during delay');
 await p.waitForFunction(()=>NHGalleryLab.state.firstImageReady,{},{timeout:15000});if((await p.evaluate(()=>__frames)).some(f=>f.hasA))throw Error('Control frame appeared');await c.close();
});
await check('Actual image request failure does not report exposure or switch to A',async()=>{
 const {p,c}=await newPage();await p.route('**/images/**',r=>r.abort());await p.goto(base+'?variant=variant-b');await p.waitForTimeout(500);
 if(await p.locator('#galMain').count())throw Error('Control mounted on failure');if(await p.evaluate(()=>NHGalleryLab.state.events.some(e=>e.name==='experiment_exposed')))throw Error('False exposure');
 await p.locator('#mainCheckout').click();if(!await p.locator('#checkout-result').isVisible())throw Error('Simulated checkout unavailable');await c.close();
});
await check('Public preview loads real galleries after hosts explicit external-content notice',async()=>{
 const target=process.env.GALLERY_PREVIEW_URL;if(!target)throw Error('Public preview URL missing');
 const {p,c}=await newPage();
 const detail={url:target,noticeAccepted:false,console:[],responses:[]};p.on('console',m=>{if(m.type()==='error')detail.console.push(m.text());});p.on('response',r=>detail.responses.push({url:r.url(),status:r.status()}));
 async function open(url){
  const response=await p.goto(url,{timeout:60000,waitUntil:'domcontentloaded'});
  if(!response||response.status()!==200)throw Error('HTTP '+response?.status());
  if((await p.title()).includes('External Content Notice')){
   detail.noticeAccepted=true;
   await p.getByText('Open the page',{exact:true}).click();
  }
  await p.waitForFunction(()=>!!window.NHGalleryLab,{},{timeout:20000});
  await p.waitForFunction(()=>window.NHGalleryLab.state.firstImageReady,{},{timeout:30000});
 }
 try{
  await open(target+'?variant=variant-b&view=page');
  if(p.errors.length)throw Error(p.errors.join('\n'));
  detail.finalUrl=p.url();detail.dimensions=await p.locator('#labGalleryB').evaluate(el=>({width:el.naturalWidth,height:el.naturalHeight}));
  if((await p.evaluate(()=>__frames)).some(f=>f.hasA||f.arm!=='variant-b'))throw Error('Wrong arm in public B frames');
  await p.screenshot({path:out+'/public-preview-B-real.png',fullPage:true});
  await open(target+'?variant=variant-b');await p.screenshot({path:out+'/public-controls-B-real.png',fullPage:true});
  await open(target+'?variant=control&view=page');if(!await p.locator('#galMain').count())throw Error('Public A unavailable');await p.screenshot({path:out+'/public-preview-A-real.png',fullPage:true});
  await open(target);const first=await p.evaluate(()=>NHGalleryLab.state.decision.assignment);
  for(let i=0;i<3;i++){await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!window.NHGalleryLab);if(JSON.stringify(await p.evaluate(()=>NHGalleryLab.state.decision.assignment))!==JSON.stringify(first))throw Error('Public sticky assignment changed');}
  detail.publicStickyReloads=3;detail.storageMode=await p.evaluate(()=>NHGalleryLab.state.storageMode);
  await fs.writeFile(out+'/public-preview-details.json',JSON.stringify(detail,null,2));return detail;
 }catch(e){detail.error=String(e);detail.title=await p.title();detail.body=(await p.locator('body').innerText()).slice(0,3000);detail.errors=p.errors;await p.screenshot({path:out+'/public-preview-failure.png',fullPage:true});await fs.writeFile(out+'/public-preview-details.json',JSON.stringify(detail,null,2));throw e;}
 finally{await c.close();}
});
await browser.close();await fs.writeFile(out+'/results.json',JSON.stringify({scope:'Chromium HTTP navigation with real copied B assets and original public Shopify CDN A assets. No real Shopify app, checkout or WebView integration. The raw.githack host displays a first-visit external-content notice; the test clicks its visible Open the page button.',results},null,2));
if(failed)process.exitCode=1;

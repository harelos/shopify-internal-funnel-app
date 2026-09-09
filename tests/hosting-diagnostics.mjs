import {chromium} from 'playwright';
import fs from 'node:fs/promises';
await fs.mkdir('browser-evidence',{recursive:true});
const browser=await chromium.launch({headless:true});const rows=[];
for(const host of ['raw.githack.com','rawcdn.githack.com']){
 const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
 const row={host,console:[],errors:[],requestsFailed:[],responses:[]};
 page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')row.console.push(m.text());});
 page.on('pageerror',e=>row.errors.push(String(e)));
 page.on('requestfailed',r=>row.requestsFailed.push({url:r.url(),error:r.failure()}));
 page.on('response',r=>row.responses.push({url:r.url(),status:r.status()}));
 const url=`https://${host}/harelos/shopify-internal-funnel-app/cecb186840eb1725fedbea0a18b192f89004119b/index.html?variant=variant-b&view=page`;
 try{
 const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
 row.status=response?.status();row.headers=await response?.allHeaders();row.url=page.url();
 await page.waitForTimeout(6000);
 row.dom=await page.evaluate(()=>({title:document.title,text:document.body?.innerText.slice(0,2000),core:!!window.NHGalleryCore,lab:!!window.NHGalleryLab,events:window.NHGalleryLab?.state.events,images:Array.from(document.images).map(i=>({src:i.currentSrc,width:i.naturalWidth,height:i.naturalHeight})),scripts:Array.from(document.scripts).map(s=>({src:s.src,type:s.type,length:s.textContent.length}))}));
 await page.screenshot({path:`browser-evidence/hosting-${host}.png`,fullPage:true});
 row.ready=await page.evaluate(()=>!!window.NHGalleryLab?.state.firstImageReady);
 }catch(e){row.error=String(e);}
 console.log('HOST_DIAGNOSTIC',JSON.stringify(row));rows.push(row);await context.close();
}
await browser.close();await fs.writeFile('browser-evidence/hosting.json',JSON.stringify(rows,null,2));

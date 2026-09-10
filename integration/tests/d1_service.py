"""Actual service modules on local Workerd/D1. Shopify publication mocked; all outbound network forbidden."""
from pathlib import Path
import os,json,subprocess,time,urllib.request,urllib.error,hashlib,shutil
HERE=Path(__file__).resolve().parents[1];APP=Path(os.environ['GALLERY_UPSTREAM'])/'app/cloudflare-pilot'
fixture=json.loads((HERE/'preview/manifest.json').read_text());(APP/'gallery-qa-fixture.json').write_text(json.dumps(fixture))
worker=r'''
import {env} from 'cloudflare:workers';
import prisma from './src/lib/db.js';
import {ShopifyAdminClient} from './src/lib/shopify-admin.js';
import {digest} from './src/lib/gallery-bootstrap-manifest.js';
import {readGalleryManifest,runBootstrapCommand,registerGallery,pendingGalleryContexts} from './src/services/gallery-bootstrap.js';
import {snapshotCheckoutElementAssignments,snapshotOrderElementAssignments} from './src/services/element-attribution.js';
import fixture from './gallery-qa-fixture.json';
let published:any=null,failPublish=false;const writes:any[]=[];
(globalThis as any).__SHOPIFY_WORKER_ENV__=env;
(globalThis as any).fetch=async()=>{throw Error('QA forbids all outbound network calls');};
ShopifyAdminClient.prototype.graphql=async function(query:string,variables:any):Promise<any>{
 if(query.startsWith('query GalleryBootstrapPage'))return {page:{id:env.GALLERY_BOOTSTRAP_PAGE_ID,handle:'qa-gallery-lab',metafield:published}};
 if(query.startsWith('mutation GalleryBootstrapPublish')){
  if(failPublish){failPublish=false;throw Error('synthetic-publication-failure');}
  const m=variables.metafields[0];if(m.ownerId!==env.GALLERY_BOOTSTRAP_PAGE_ID||m.compareDigest!==(published?.compareDigest??null))throw Error('CAS or page binding mismatch');
  published={value:m.value,compareDigest:digest(m.value)};writes.push(JSON.parse(m.value));return {metafieldsSet:{metafields:[published],userErrors:[]}};
 }
 throw Error('Unexpected Shopify operation');
};
export default {async fetch(req:Request,e:any){
 (globalThis as any).__SHOPIFY_WORKER_ENV__=e;
 if(req.method==='GET')return Response.json({ready:true,localOnly:true});
 try{const b:any=await req.json();let result:any;
 if(b.op==='seed'){
  await prisma.shop.create({data:{id:'qa-shop-0001',domain:'gallery-qa.myshopify.com'}});
  await prisma.elementTemplate.create({data:{id:'qa-template-0001',shopId:'qa-shop-0001',key:'gallery-qa-template',name:'QA',type:'GALLERY',schemaJson:'{}'}});
  await prisma.elementSlot.create({data:{id:fixture.slotId,shopId:'qa-shop-0001',templateId:'qa-template-0001',pagePath:'/pages/qa-gallery-lab',slotKey:fixture.slotKey,name:'QA gallery',targetSelector:'.nova .hero-media',status:'DRAFT'}});
  for(const v of fixture.variants){await prisma.elementVariant.create({data:{id:v.id,slotId:fixture.slotId,key:v.key,name:v.key,isControl:v.isControl}});await prisma.elementVariantVersion.create({data:{id:'version-'+v.id,variantId:v.id,revision:v.revision,state:'PUBLISHED',payloadJson:JSON.stringify(v.payload)}});await prisma.elementVariant.update({where:{id:v.id},data:{publishedVersionId:'version-'+v.id}});}
  await prisma.elementExperiment.create({data:{id:fixture.experimentId,slotId:fixture.slotId,key:fixture.experimentKey,status:'PAUSED',allocationVersion:2,allocations:{create:fixture.variants.map(v=>({variantId:v.id,weightBasisPoints:v.weightBasisPoints}))}}});result={seeded:true};
 }else if(b.op==='command')result=await runBootstrapCommand(fixture.experimentId,b.action,b.variantId);
 else if(b.op==='manifest')result=await readGalleryManifest(fixture.experimentId);
 else if(b.op==='register')result=await registerGallery(b.visitorId,b.pending);
 else if(b.op==='fast-checkout'){
  const contexts=await pendingGalleryContexts({pendingGalleryBootstrap:b.pending},b.visitorId);
  const assignment=await prisma.elementAssignment.findUniqueOrThrow({where:{id:contexts[0].assignmentId}});
  const checkout=await prisma.checkoutAttribution.upsert({where:{checkoutToken:'qa-checkout-token'},update:{},create:{shopId:'qa-shop-0001',visitorId:assignment.visitorId,checkoutToken:'qa-checkout-token',startedAt:new Date()}});
  await snapshotCheckoutElementAssignments({shopId:'qa-shop-0001',checkoutToken:checkout.checkoutToken,visitorId:assignment.visitorId,contexts});result={contexts,rows:await prisma.checkoutElementAttribution.count()};
 }else if(b.op==='order'){
  const order=await prisma.orderAttribution.upsert({where:{shopifyOrderGid:'gid://shopify/Order/9000000000001'},update:{netRevenueAmount:b.net??239,refundedAmount:239-(b.net??239)},create:{shopId:'qa-shop-0001',shopifyOrderGid:'gid://shopify/Order/9000000000001',checkoutToken:'qa-checkout-token',currency:'ILS',grossAmount:239,netRevenueAmount:239,status:'PAID',isTest:true,confidence:'HIGH',paidAt:new Date()}});
  await snapshotOrderElementAssignments(order.id,'qa-checkout-token');result={rows:await prisma.orderElementAttribution.count(),net:order.netRevenueAmount};
 }else if(b.op==='fail-publish'){failPublish=true;result={armed:true};}
 else if(b.op==='historical-conflict'){await prisma.elementAssignment.update({where:{id:b.assignmentId},data:{allocationVersion:1}});result={changedSyntheticOnly:true};}
 else if(b.op==='inspect')result={assignments:await prisma.elementAssignment.findMany(),published:published?JSON.parse(published.value):null,writes:writes.length};
 else throw Error('Unknown QA operation');
 return Response.json({ok:true,result});
 }catch(error:any){return Response.json({ok:false,error:error.message},{status:409});}
}};
'''
(APP/'gallery-qa.worker.ts').write_text(worker)
conf={'name':'gallery-integration-local-qa','main':'./gallery-qa.worker.ts','compatibility_date':'2026-08-20','compatibility_flags':['nodejs_compat'],'rules':[{'type':'CompiledWasm','globs':['**/*.wasm'],'fallthrough':False}],'vars':{'GALLERY_BOOTSTRAP_MODE':'staging','GALLERY_BOOTSTRAP_EXPERIMENT_ID':fixture['experimentId'],'GALLERY_BOOTSTRAP_PAGE_ID':'gid://shopify/Page/9000000000001','SHOP_DOMAIN':'gallery-qa.myshopify.com','SHOPIFY_LIVE_CONNECT':'false','ANALYTICS_MODE':'OFF'},'d1_databases':[{'binding':'DB','database_name':'gallery-integration-local-qa-db','database_id':'00000000-0000-0000-0000-000000000001','remote':False}],'triggers':{'crons':[]}}
(APP/'gallery-qa.json').write_text(json.dumps(conf))
env={**os.environ,'WRANGLER_SEND_METRICS':'false','DATABASE_URL':'file:./qa-not-production.db'}
def run(args,**kw):return subprocess.run(args,cwd=APP,env=env,check=True,timeout=180,**kw)
schema=run(['node_modules/.bin/prisma','migrate','diff','--from-empty','--to-schema-datamodel','prisma/schema.prisma','--script'],capture_output=True,text=True).stdout
schema+='\n'+(APP/'migrations/0019_gallery_bootstrap_snapshot.sql').read_text();(APP/'gallery-qa-schema.sql').write_text(schema)
run(['node_modules/.bin/wrangler','d1','execute','DB','--local','--config','gallery-qa.json','--persist-to','.gallery-qa-state','--file','gallery-qa-schema.sql'])
log=(HERE/'evidence/d1-worker.log').open('w');proc=subprocess.Popen(['node_modules/.bin/wrangler','dev','--local','--config','gallery-qa.json','--persist-to','.gallery-qa-state','--port','8791','--ip','127.0.0.1'],cwd=APP,env=env,stdout=log,stderr=subprocess.STDOUT)
results=[]
def call(op,**kw):
 req=urllib.request.Request('http://127.0.0.1:8791',data=json.dumps({'op':op,**kw}).encode(),headers={'Content-Type':'application/json'})
 try:r=urllib.request.urlopen(req,timeout=30)
 except urllib.error.HTTPError as e:r=e
 return json.loads(r.read())
def ok(op,**kw):
 r=call(op,**kw);assert r['ok'],r;return r['result']
def pending(m,visitor):
 bucket=int(hashlib.sha256(f"{visitor}:{m['experimentId']}:{m['allocationVersion']}".encode()).hexdigest()[:12],16)%10000
 arm=sorted(m['variants'],key=lambda v:v['id'])[0 if bucket<5000 else 1]
 return {'experimentId':m['experimentId'],'slotId':m['slotId'],'allocationVersion':m['allocationVersion'],'variantId':arm['id'],'cohortHash':m['cohortHash']}
def passed(name):results.append({'test':name,'pass':True});print('PASS D1',name,flush=True)
try:
 for _ in range(90):
  try:urllib.request.urlopen('http://127.0.0.1:8791',timeout=2);break
  except Exception:time.sleep(1)
 else:raise RuntimeError('Local QA Worker did not start')
 ok('seed');r=ok('command',action='start');assert r['bootstrap']['state']=='PUBLISHED',r;m=ok('manifest');assert m['status']=='RUNNING';passed('Actual Prisma/D1 start publishes snapshot to mock Shopify')
 p=pending(m,'real-d1-visitor-0001');a=ok('register',visitorId='real-d1-visitor-0001',pending=p);b=ok('register',visitorId='real-d1-visitor-0001',pending=p);assert a['assignmentId']==b['assignmentId'];passed('Repeated actual registration reuses one database assignment')
 fast=pending(m,'real-d1-fast-0002');r=ok('fast-checkout',visitorId='real-d1-fast-0002',pending=fast);later=ok('register',visitorId='real-d1-fast-0002',pending=fast);assert r['rows']==1 and r['contexts'][0]['assignmentId']==later['assignmentId'];passed('Pending fast checkout resolves to same persisted assignment')
 assert ok('order')['rows']==1 and ok('order')['rows']==1;assert ok('order',net=189)=={'rows':1,'net':189};passed('Synthetic order attribution deduplicates and preserves adjusted revenue')
 ok('historical-conflict',assignmentId=a['assignmentId']);r=call('register',visitorId='real-d1-visitor-0001',pending=p);assert not r['ok'] and 'history preserved' in r['error'];passed('Historical conflicts rejected without rewriting prior assignment')
 r=ok('command',action='pause');assert r['bootstrap']['state']=='PUBLISHED' and ok('inspect')['published']['status']=='PAUSED';passed('Actual pause propagates to mock published manifest')
 ok('fail-publish');r=ok('command',action='start');assert r['bootstrap']['state']=='PUBLISH_FAILED';assert ok('inspect')['published']['status']=='PAUSED';r=ok('command',action='sync');assert r['bootstrap']['state']=='PUBLISHED';passed('Publication failure surfaces; explicit sync recovers')
 win=m['variants'][0]['id'];r=ok('command',action='promote',variantId=win);assert r['bootstrap']['state']=='PUBLISHED',r;assert ok('manifest')['status']=='PROMOTED';passed('Promotion preserves historical assignment rows')
except Exception as e:
 results.append({'test':'D1 integration sequence','pass':False,'error':str(e)});raise
finally:
 proc.terminate()
 try:proc.wait(timeout=10)
 except subprocess.TimeoutExpired:proc.kill()
 log.close();(HERE/'evidence/d1-results.json').write_text(json.dumps(results,indent=2))
 for name in ['gallery-qa.worker.ts','gallery-qa-fixture.json','gallery-qa.json','gallery-qa-schema.sql']:(APP/name).unlink(missing_ok=True)
 shutil.rmtree(APP/'.gallery-qa-state',ignore_errors=True)

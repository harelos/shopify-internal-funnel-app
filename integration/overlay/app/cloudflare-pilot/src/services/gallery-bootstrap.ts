import { randomUUID } from "node:crypto";
import prisma from "../lib/db.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { hashAnonymousKey } from "./element-ab-engine.js";
import { manifestFromExperiment, publishManifest, resolveAssignment, validateManifest, validatePending, type GalleryManifest, type PendingGallery } from "../lib/gallery-bootstrap-manifest.js";
function config() {
  const mode=workerEnvValue("GALLERY_BOOTSTRAP_MODE");
  return {enabled:["staging","live-approved"].includes(mode),mode,experimentId:workerEnvValue("GALLERY_BOOTSTRAP_EXPERIMENT_ID"),pageId:workerEnvValue("GALLERY_BOOTSTRAP_PAGE_ID")};
}
function db():D1Database {
  const value=(globalThis as any).__SHOPIFY_WORKER_ENV__?.DB;
  if(!value)throw Error("Gallery bootstrap D1 unavailable");return value;
}
export function bootstrapConfiguredFor(experimentId:string) {const c=config();return c.enabled&&c.experimentId===experimentId;}
export async function readGalleryManifest(experimentId:string) {
  if(!bootstrapConfiguredFor(experimentId))throw Error("Gallery bootstrap is not enabled for this experiment");
  const e=await prisma.elementExperiment.findUnique({where:{id:experimentId},include:{allocations:true,slot:{include:{template:true,variants:{include:{versions:true}}}}}});
  if(!e)throw Error("Unknown gallery experiment");
  return manifestFromExperiment(e,config().mode==="live-approved"?"LIVE":"STAGING");
}
export async function registerGallery(visitorId:string,pending:PendingGallery) {
  if(!pending||!bootstrapConfiguredFor(pending.experimentId))throw Error("Bootstrap enrollment disabled");
  if(typeof visitorId!=="string"||visitorId.length<8||visitorId.length>200||!/^[a-f0-9]{64}$/.test(pending.cohortHash))throw Error("Invalid visitor or snapshot");
  const record=await db().prepare('SELECT manifestJson FROM GalleryBootstrapSnapshot WHERE cohortHash = ? AND experimentId = ?').bind(pending.cohortHash,pending.experimentId).first<{manifestJson:string}>();
  if(!record)throw Error("Unknown published snapshot");
  const snapshot=validateManifest(JSON.parse(record.manifestJson));
  if(snapshot.status!=="RUNNING")throw Error("Nonexperimental snapshot cannot enroll visitors");
  validatePending(snapshot,pending,visitorId);
  const slot=await prisma.elementSlot.findUnique({where:{id:pending.slotId}});
  if(!slot)throw Error("Unknown slot");
  const visitor=await prisma.visitor.upsert({where:{shopId_anonymousKeyHash:{shopId:slot.shopId,anonymousKeyHash:hashAnonymousKey(visitorId)}},update:{},create:{shopId:slot.shopId,anonymousKeyHash:hashAnonymousKey(visitorId)}});
  const where={visitorId_experimentId:{visitorId:visitor.id,experimentId:pending.experimentId}};
  const assignment=await resolveAssignment({find:()=>prisma.elementAssignment.findUnique({where}),create:()=>prisma.elementAssignment.upsert({where,update:{},create:{visitorId:visitor.id,experimentId:pending.experimentId,variantId:pending.variantId,allocationVersion:pending.allocationVersion}})},pending,async()=>snapshot);
  const variant=snapshot.variants.find(v=>v.id===assignment.variantId)!;
  return {assignmentId:assignment.id,experimentId:snapshot.experimentId,experimentKey:snapshot.experimentKey,slotId:snapshot.slotId,slotKey:snapshot.slotKey,variantId:assignment.variantId,variantKey:variant.key,allocationVersion:snapshot.allocationVersion,posthogFlagKey:snapshot.posthogFlagKey,cohortHash:snapshot.cohortHash,pagePath:snapshot.pagePath,templateType:"GALLERY",templateVersion:2,contentRevision:variant.revision};
}
/** A fast checkout can register before the page's background request finishes. */
export async function pendingGalleryContexts(raw:any,visitorId:string):Promise<any[]> {
  if(!raw?.pendingGalleryBootstrap||raw.isInternal===true)return [];
  const assignment=await registerGallery(visitorId,raw.pendingGalleryBootstrap);
  return [{assignmentId:assignment.assignmentId,experimentId:assignment.experimentId,variantId:assignment.variantId,slotId:assignment.slotId}];
}
export async function syncGalleryBootstrap(experimentId:string,sessionToken?:string) {
  if(!bootstrapConfiguredFor(experimentId))return {state:"DISABLED"};
  const c=config();
  try {
    if(!/^gid:\/\/shopify\/Page\/\d+$/.test(c.pageId))throw Error("Explicit page binding required");
    if(c.mode!=="live-approved"&&c.pageId==="gid://shopify/Page/162313240871")throw Error("Live page is forbidden in staging mode");
    const manifest=await readGalleryManifest(experimentId);
    if(c.mode!=="live-approved"&&!manifest.pagePath.startsWith("/pages/qa-"))throw Error("Staging publication requires a dedicated qa- page, not a live sales page");
    // Pause/promote never overwrite historical cohort receipts.
    if(manifest.status==="RUNNING") await db().prepare('INSERT OR IGNORE INTO GalleryBootstrapSnapshot (cohortHash, experimentId, manifestJson) VALUES (?, ?, ?)').bind(manifest.cohortHash,experimentId,JSON.stringify(manifest)).run();
    const client=new ShopifyAdminClient();
    return await publishManifest(manifest,{
      read:async()=>{
        const result:any=await client.graphql('query GalleryBootstrapPage($id:ID!) { page(id:$id) { id handle metafield(namespace:"funnel_control",key:"gallery_bootstrap") { value compareDigest } } }',{id:c.pageId},sessionToken);
        if(!result.page||`/pages/${result.page.handle}`!==manifest.pagePath)throw Error("Bound page and experiment path differ");
        return {value:result.page.metafield?.value??null,compareDigest:result.page.metafield?.compareDigest??null};
      },
      write:async(value,compareDigest)=>{
        const result:any=await client.graphql('mutation GalleryBootstrapPublish($metafields:[MetafieldsSetInput!]!) { metafieldsSet(metafields:$metafields) { metafields { value compareDigest } userErrors { field message code } } }',{metafields:[{ownerId:c.pageId,namespace:"funnel_control",key:"gallery_bootstrap",type:"json",value,compareDigest}]},sessionToken);
        const operation=result.metafieldsSet;
        if(operation?.userErrors?.length||!operation?.metafields?.[0])throw Error(operation?.userErrors?.map((x:any)=>x.message).join('; ')||"Missing publication acknowledgement");
        return operation.metafields[0];
      }
    });
  } catch(error:any) {return {state:"PUBLISH_FAILED",reason:String(error.message),databaseChangeMayAlreadyBeSaved:true};}
}
/** One publisher per bound experiment. Abandoned requests expire without taking over live services. */
export async function runBootstrapCommand(experimentId:string,command:"start"|"pause"|"promote"|"sync",variantId?:string,sessionToken?:string) {
  if(!bootstrapConfiguredFor(experimentId))throw Error("Bootstrap command is not enabled");
  const connection=db(),owner=randomUUID(),now=Date.now();
  await connection.prepare('INSERT OR IGNORE INTO GalleryBootstrapLock (experimentId, owner, expiresAt) VALUES (?, ?, 0)').bind(experimentId,'').run();
  const acquired=await connection.prepare('UPDATE GalleryBootstrapLock SET owner = ?, expiresAt = ? WHERE experimentId = ? AND expiresAt < ?').bind(owner,now+120000,experimentId,now).run();
  if(!acquired.meta.changes)throw Error("Another bootstrap publication is in progress; retry after it completes");
  try {
    const e=await prisma.elementExperiment.findUnique({where:{id:experimentId},include:{allocations:true,slot:{include:{template:true,variants:{include:{versions:true}}}}}});
    if(!e)throw Error("Unknown experiment");
    if(command==='start') {
      if(!['DRAFT','PAUSED','RUNNING'].includes(e.status))throw Error("Completed experiments cannot restart");
      if(e.allocations.filter(a=>a.weightBasisPoints>0).length!==2)throw Error("A measured experiment requires two allocated arms");
      manifestFromExperiment({...e,status:'RUNNING',slot:{...e.slot,status:'ACTIVE'}},'STAGING');
      await prisma.elementExperiment.update({where:{id:experimentId},data:{status:'RUNNING',startedAt:e.startedAt??new Date(),endedAt:null}});
      await prisma.elementSlot.update({where:{id:e.slotId},data:{status:'ACTIVE'}});
    } else if(command==='pause') {
      if(e.status==='COMPLETED')throw Error("Completed experiment cannot be reopened by pausing");
      await prisma.elementExperiment.update({where:{id:experimentId},data:{status:'PAUSED'}});
      await prisma.elementSlot.update({where:{id:e.slotId},data:{status:'DRAFT'}});
    } else if(command==='promote') {
      const v=e.slot.variants.find(v=>v.id===variantId&&v.publishedVersionId);
      if(!v)throw Error("Promotion requires a published arm from this slot");
      if(e.status==='COMPLETED')throw Error("Already promoted; use sync to retry publication without changing history");
      await connection.batch([
        connection.prepare('DELETE FROM ElementExperimentAllocation WHERE experimentId = ?').bind(experimentId),
        connection.prepare('INSERT INTO ElementExperimentAllocation (id, experimentId, variantId, weightBasisPoints) VALUES (?, ?, ?, 10000)').bind(randomUUID(),experimentId,v.id),
        connection.prepare("UPDATE ElementExperiment SET status = 'COMPLETED', endedAt = ?, updatedAt = ?, allocationVersion = allocationVersion + 1 WHERE id = ?").bind(new Date().toISOString(),new Date().toISOString(),experimentId),
        connection.prepare("UPDATE ElementSlot SET status = 'ACTIVE', updatedAt = ? WHERE id = ?").bind(new Date().toISOString(),e.slotId),
      ]);
    }
    const lock=await connection.prepare('SELECT owner, expiresAt FROM GalleryBootstrapLock WHERE experimentId = ?').bind(experimentId).first<{owner:string;expiresAt:number}>();
    if(lock?.owner!==owner||lock.expiresAt<Date.now()+30000)throw Error("Publication lease expired before publishing");
    const bootstrap=await syncGalleryBootstrap(experimentId,sessionToken);
    return {...await prisma.elementExperiment.findUnique({where:{id:experimentId},include:{allocations:true}}),bootstrap};
  } finally {
    await connection.prepare('UPDATE GalleryBootstrapLock SET expiresAt = 0 WHERE experimentId = ? AND owner = ?').bind(experimentId,owner).run();
  }
}
export async function isBoundVariant(variantId:string) {
  const c=config();if(!c.enabled)return false;
  const e=await prisma.elementExperiment.findUnique({where:{id:c.experimentId},select:{slotId:true}});
  const v=await prisma.elementVariant.findUnique({where:{id:variantId},select:{slotId:true}});
  return Boolean(e&&v&&e.slotId===v.slotId);
}

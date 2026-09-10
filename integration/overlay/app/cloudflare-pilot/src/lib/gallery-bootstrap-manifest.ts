import { createHash } from "node:crypto";

export type GalleryImage = { id: string; src: string; alt: string; caption?: string };
export type GalleryArm = { id: string; key: string; isControl: boolean; weightBasisPoints: number; revision: number; payload: { preserveExisting?: boolean; items?: GalleryImage[]; initialIndex?: number; showThumbnails?: boolean } };
export type GalleryManifest = {
  schemaVersion: 2; environment: "STAGING" | "LIVE"; pagePath: string; slotId: string; slotKey: string;
  experimentId: string; experimentKey: string; allocationVersion: number; cohortHash: string;
  status: "RUNNING" | "PAUSED" | "PROMOTED"; promotedVariantId: string | null;
  publishedAt: string; posthogFlagKey: string | null; variants: GalleryArm[];
};
const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_.-]{3,200}$/.test(v);
export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function cohortHash(m: Pick<GalleryManifest,"experimentId"|"slotId"|"allocationVersion"|"variants">): string {
  return digest(JSON.stringify([m.experimentId,m.slotId,m.allocationVersion,m.variants.slice().sort((a,b)=>a.id.localeCompare(b.id))]));
}
export function validateManifest(m: GalleryManifest): GalleryManifest {
  if (!m || m.schemaVersion !== 2 || !["STAGING","LIVE"].includes(m.environment)) throw Error("Invalid gallery bootstrap schema");
  if (![m.experimentId,m.slotId,m.slotKey,m.experimentKey].every(id)) throw Error("Invalid gallery identity");
  if (!/^\/pages\/[a-z0-9-]+$/.test(m.pagePath)) throw Error("Invalid page path");
  if (!Number.isSafeInteger(m.allocationVersion) || m.allocationVersion < 1) throw Error("Invalid allocation version");
  if (!["RUNNING","PAUSED","PROMOTED"].includes(m.status)) throw Error("Invalid state");
  if (!Array.isArray(m.variants) || m.variants.length !== 2 || m.variants.filter(v=>v.isControl).length !== 1) throw Error("Exactly two gallery arms and one control required");
  if (new Set(m.variants.map(v=>v.id)).size !== 2 || new Set(m.variants.map(v=>v.key)).size !== 2) throw Error("Duplicate variants");
  let total=0;
  for (const v of m.variants) {
    if (!id(v.id)||!id(v.key)||!Number.isSafeInteger(v.revision)||v.revision<1) throw Error("Invalid variant");
    if (!Number.isInteger(v.weightBasisPoints)||v.weightBasisPoints<0) throw Error("Invalid weight");
    total+=v.weightBasisPoints;
    if (v.isControl) { if(v.payload.preserveExisting!==true) throw Error("Control must preserve original markup"); }
    else {
      const items=v.payload.items;
      if(!Array.isArray(items)||!items.length||items.length>30||new Set(items.map(i=>i.id)).size!==items.length) throw Error("Invalid image list");
      for(const image of items) {
        if(!id(image.id)||typeof image.alt!=="string"||image.alt.length>500) throw Error("Invalid image metadata");
        const url=new URL(image.src);
        if(url.protocol!=="https:"||url.hostname!=="cdn.shopify.com"||!url.pathname.startsWith("/s/files/")) throw Error("Only approved Shopify CDN images permitted");
      }
      const i=v.payload.initialIndex??0;
      if(!Number.isInteger(i)||i<0||i>=items.length) throw Error("Invalid initial image index");
    }
  }
  if(total!==10000) throw Error("Allocation must total 10000 basis points");
  if(m.status==="PROMOTED"&&!m.variants.some(v=>v.id===m.promotedVariantId)) throw Error("Invalid promoted arm");
  if(m.cohortHash!==cohortHash(m)) throw Error("Manifest fingerprint mismatch");
  return m;
}
/** Input is the actual Prisma experiment including allocations, slot and published versions. */
export function manifestFromExperiment(experiment: any, environment: "STAGING"|"LIVE" = "STAGING", now = new Date()): GalleryManifest {
  if(!experiment?.slot || experiment.slot.template?.type!=="GALLERY") throw Error("Gallery experiment required");
  const variants: GalleryArm[]=experiment.slot.variants.map((v:any)=>{
    const version=v.versions.find((r:any)=>r.id===v.publishedVersionId);
    if(!version) throw Error(`Unpublished variant ${v.key}`);
    const payload=JSON.parse(version.payloadJson);
    const allocation=experiment.allocations.find((a:any)=>a.variantId===v.id);
    return {id:v.id,key:v.key,isControl:Boolean(v.isControl),weightBasisPoints:allocation?.weightBasisPoints??0,revision:version.revision,payload};
  }).sort((a:GalleryArm,b:GalleryArm)=>a.id.localeCompare(b.id));
  const status=experiment.status==="RUNNING"&&experiment.slot.status==="ACTIVE"?"RUNNING":experiment.status==="COMPLETED"&&experiment.slot.status==="ACTIVE"?"PROMOTED":"PAUSED";
  const m: GalleryManifest={schemaVersion:2,environment,pagePath:experiment.slot.pagePath,slotId:experiment.slot.id,slotKey:experiment.slot.slotKey,
    experimentId:experiment.id,experimentKey:experiment.key,allocationVersion:experiment.allocationVersion,cohortHash:"",status,
    promotedVariantId:status==="PROMOTED"?(variants.find(v=>v.weightBasisPoints===10000)?.id??null):null,
    publishedAt:now.toISOString(),posthogFlagKey:experiment.posthogFlagKey??null,variants};
  m.cohortHash=cohortHash(m);return validateManifest(m);
}
export function selectedVariant(m: GalleryManifest, visitorId: string): GalleryArm {
  validateManifest(m);
  if(typeof visitorId!=="string"||visitorId.length<8||visitorId.length>200)throw Error("Invalid visitor");
  const bucket=parseInt(digest(`${visitorId}:${m.experimentId}:${m.allocationVersion}`).slice(0,12),16)%10000;
  let cursor=0;
  for(const variant of m.variants.slice().sort((a,b)=>a.id.localeCompare(b.id))) { cursor+=variant.weightBasisPoints;if(bucket<cursor)return variant; }
  throw Error("Unallocated visitor");
}
export function serializeInline(m: GalleryManifest): string {
  return JSON.stringify(validateManifest(m)).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
}
export type PendingGallery = { experimentId:string;slotId:string;allocationVersion:number;variantId:string;cohortHash:string };
export function validatePending(m: GalleryManifest,p: PendingGallery,visitorId:string) {
  if(!p||p.experimentId!==m.experimentId||p.slotId!==m.slotId||p.allocationVersion!==m.allocationVersion||p.cohortHash!==m.cohortHash)throw Error("Stale gallery context");
  if(selectedVariant(m,visitorId).id!==p.variantId)throw Error("Gallery assignment mismatch");
  return p;
}
/** Async registration is not allowed to overwrite a historical assignment. */
export async function resolveAssignment(ports: {find:()=>Promise<any>;create:()=>Promise<any>},pending:PendingGallery,current:()=>Promise<GalleryManifest>) {
  const existing=await ports.find();
  if(existing) {
    if(existing.experimentId!==pending.experimentId||existing.variantId!==pending.variantId||existing.allocationVersion!==pending.allocationVersion)throw Error("Existing assignment conflict; history preserved");
    return existing;
  }
  const manifest=await current();
  if(manifest.status!=="RUNNING"||manifest.cohortHash!==pending.cohortHash)throw Error("Enrollment closed or publication changed");
  let row;
  try {row=await ports.create();} catch(error) {row=await ports.find();if(!row)throw error;}
  if(row.variantId!==pending.variantId||row.allocationVersion!==pending.allocationVersion)throw Error("Concurrent assignment conflict");
  return row;
}
export type PublishPorts={read:()=>Promise<{value:string|null;compareDigest:string|null}>;write:(value:string,expected:string|null)=>Promise<{value:string;compareDigest:string}>};
/** Shopify metafieldsSet CAS prevents a concurrent publisher from silently winning. */
export async function publishManifest(m:GalleryManifest,ports:PublishPorts) {
  validateManifest(m);const before=await ports.read();
  if(before.value) {
    const prior=JSON.parse(before.value) as GalleryManifest;
    if(prior.experimentId===m.experimentId&&prior.allocationVersion===m.allocationVersion&&prior.cohortHash!==m.cohortHash&&m.status!=="PROMOTED")throw Error("Content/allocation changed within a cohort; publish a separately approved phase");
  }
  const value=JSON.stringify(m);const result=await ports.write(value,before.compareDigest);
  if(result.value!==value)throw Error("Publication readback mismatch");
  return {state:"PUBLISHED",cohortHash:m.cohortHash,compareDigest:result.compareDigest};
}

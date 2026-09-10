import { Router } from "express";
import { getShopifyConfig } from "../lib/shopify-config.js";
import { verifyShopifyAppProxyRequest } from "../middleware/shopify-auth.js";
import { readGalleryManifest, registerGallery, runBootstrapCommand, bootstrapConfiguredFor, isBoundVariant } from "../services/gallery-bootstrap.js";
export const galleryBootstrapAdmin = Router();
export const galleryBootstrapRuntime = Router();
// Mounted after existing requireShopifySession middleware.
galleryBootstrapAdmin.get('/element-experiments/:id/bootstrap-manifest',async(req,res)=>{
 try {res.setHeader('Cache-Control','private, no-store');return res.json(await readGalleryManifest(String(req.params.id)));}
 catch(error:any){return res.status(409).json({error:error.message});}
});
galleryBootstrapAdmin.post('/element-experiments/:id/bootstrap-publish',async(req,res)=>{
 const sessionToken=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')||undefined;
 try {const result=await runBootstrapCommand(String(req.params.id),'sync',undefined,sessionToken);return res.status(result.bootstrap.state==='PUBLISHED'?200:409).json(result);}
 catch(error:any){return res.status(409).json({error:error.message});}
});
galleryBootstrapRuntime.post('/gallery-bootstrap/register',async(req,res)=>{
 if(getShopifyConfig().liveConnect&&!verifyShopifyAppProxyRequest(req))return res.status(401).json({error:'Signed Shopify proxy required'});
 try {
  if(req.body?.isInternal===true)return res.json({internal:true,accepted:false});
  const result=await registerGallery(req.body?.visitorId,req.body?.pending);
  res.setHeader('Cache-Control','private, no-store');return res.json({accepted:true,...result});
 }catch(error:any){return res.status(409).json({accepted:false,error:error.message});}
});
for(const action of ['start','pause','promote'] as const) {
 const suffix=action==='promote'?'/promote/:variantId':`/${action}`;
 galleryBootstrapAdmin.post(`/element-experiments/:id${suffix}`,async(req,res,next)=>{
  const params=req.params as Record<string,string>;
  const id=String(params.id);if(!bootstrapConfiguredFor(id))return next();
  try {
   const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')||undefined;
   const result=await runBootstrapCommand(id,action,params.variantId||undefined,token);
   if(result.bootstrap.state!=='PUBLISHED')return res.status(409).json({...result,error:'App state saved, storefront publication FAILED. Do not treat the action as complete. Retry bootstrap-publish.'});
   return res.json(result);
  }catch(error:any){return res.status(409).json({error:error.message});}
 });
}
galleryBootstrapAdmin.patch('/element-experiments/:id/allocations',(req,res,next)=>{
 if(!bootstrapConfiguredFor(String(req.params.id)))return next();
 return res.status(409).json({error:'Bootstrap cohort is frozen. A new allocation requires a separate approved experiment.'});
});
galleryBootstrapAdmin.post('/element-variants/:id/publish',async(req,res,next)=>{
 if(!await isBoundVariant(String(req.params.id)))return next();
 return res.status(409).json({error:'Published bootstrap content is frozen. Save drafts, then prepare a separate approved experiment.'});
});

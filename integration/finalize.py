"""Deterministic source normalization before tests; safe and idempotent."""
from pathlib import Path
import re
r=Path(__file__).resolve().parent
p=r/'overlay/app/cloudflare-pilot/src/lib/gallery-bootstrap-manifest.ts';s=p.read_text()
if 'export function canonical(' not in s:
 s=s.replace('export function cohortHash(','''export function canonical(value: any): string {
  if(value===null||typeof value!=="object") {const text=JSON.stringify(value);if(text===undefined)throw Error("Undefined manifest value");return text;}
  if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonical(value[key])).join(",")+"}";
}
export function cohortHash(''')
 s=s.replace('digest(JSON.stringify([m.experimentId,m.slotId,m.allocationVersion,m.variants.slice().sort((a,b)=>a.id.localeCompare(b.id))]))','digest(canonical([m.experimentId,m.slotId,m.allocationVersion,m.variants.slice().sort((a,b)=>a.id.localeCompare(b.id))]))')
 p.write_text(s)
p=r/'storefront/gallery-bootstrap.js';s=p.read_text()
if 'function canonical(' not in s:
 s=s.replace('function bucket(','''function canonical(value){if(value===null||typeof value!=='object'){const text=JSON.stringify(value);if(text===undefined)throw Error('Undefined manifest value');return text;}if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';}
function bucket(''')
 s=s.replace('sha256(JSON.stringify([m.experimentId,m.slotId,m.allocationVersion,sorted]))','sha256(canonical([m.experimentId,m.slotId,m.allocationVersion,sorted]))')
if 'try { // telemetry-isolation' not in s:
 s=s.replace('  if(state.telemetryAllowed&&root.posthog','  try { // telemetry-isolation\n  if(state.telemetryAllowed&&root.posthog',1)
 s=re.sub(r'(\n\s*})\n(\s*function control\(reason\))',r"\n } catch(error) { state.errors.push('telemetry: '+String(error.message)); }\1\n\2",s,count=1)
 s=s.replace("}catch(error){state.errors.push(String(error.message));control(String(error.message));return state;}","}catch(error){state.errors.push(String(error.message));if(state.phase==='INIT')control(String(error.message));else{node.hidden=false;state.phase='DEGRADED';}return state;}")
 s=s.replace('if(sticky&&(sticky.visitorId',"if(m.status==='RUNNING'&&sticky&&(sticky.visitorId")
 s=s.replace('  const sorted=m.variants',"  if(!['RUNNING','PAUSED','PROMOTED'].includes(m.status))throw Error('Invalid experiment state');\n  const sorted=m.variants",1)
 s=s.replace('root.NHGalleryBootstrap=Object.freeze({mount,states,bucket,sha256});','root.NHGalleryBootstrap=Object.freeze({mount,states,bucket,sha256,canonical});')
p.write_text(s)
p=r/'overlay/app/cloudflare-pilot/src/routes/gallery-bootstrap.ts';s=p.read_text()
if 'bound-slot-guard' not in s:
 s+='''\n// bound-slot-guard: the target is part of an immutable cohort.
galleryBootstrapAdmin.patch('/element-slots/:id',async(req,res,next)=>{
 const { workerEnvValue }=await import('../lib/shopify-config.js');
 const experimentId=workerEnvValue('GALLERY_BOOTSTRAP_EXPERIMENT_ID');
 if(!bootstrapConfiguredFor(experimentId))return next();
 try {const manifest=await readGalleryManifest(experimentId);if(manifest.slotId!==String(req.params.id))return next();}
 catch(error:any){return res.status(409).json({error:error.message});}
 return res.status(409).json({error:'Bootstrap slot is frozen. Prepare a separate approved experiment instead.'});
});
'''
 p.write_text(s)

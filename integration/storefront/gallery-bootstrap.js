/* Gallery-only bootstrap v2. Inline before gallery. No shade, price, bundle or cart UI changes. */
(function(root){'use strict';
const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
function sha256(value){const bytes=new TextEncoder().encode(String(value)),buffer=new Uint8Array(Math.ceil((bytes.length+9)/64)*64);buffer.set(bytes);buffer[bytes.length]=0x80;const view=new DataView(buffer.buffer);view.setUint32(buffer.length-8,Math.floor(bytes.length/0x20000000));view.setUint32(buffer.length-4,(bytes.length*8)>>>0);const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64);for(let offset=0;offset<buffer.length;offset+=64){for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]+(rotr(y,17)^rotr(y,19)^(y>>>10)))>>>0;}let[a,b,c,d,e,f,g,j]=h;for(let i=0;i<64;i++){const t1=(j+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0,t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,j].forEach((v,i)=>{h[i]=(h[i]+v)>>>0;});}return h.map(v=>v.toString(16).padStart(8,'0')).join('');}
function bucket(visitorId,experimentId,allocationVersion){return parseInt(sha256(`${visitorId}:${experimentId}:${allocationVersion}`).slice(0,12),16)%10000;}
function storage(){return {
 get(k){try{return localStorage.getItem(k);}catch(_){return null;}},
 set(k,v){try{localStorage.setItem(k,v);return localStorage.getItem(k)===v;}catch(_){return false;}},
 cookie(k){try{const t=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(k+'='));return t?decodeURIComponent(t.slice(k.length+1)):null;}catch(_){return null;}},
 writeCookie(k,v){try{document.cookie=k+'='+encodeURIComponent(v)+'; Path=/; Max-Age=2592000; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');return this.cookie(k)===v;}catch(_){return false;}},
 session(k,v){try{if(v!==undefined)sessionStorage.setItem(k,v);return sessionStorage.getItem(k);}catch(_){return null;}}
};}
const uuid=()=>root.crypto&&crypto.randomUUID?crypto.randomUUID():('nhg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
const states=new Map();
function mount(node,template,m){
 if(!node||!template||states.has(node))return states.get(node);
 const store=storage(),state={phase:'INIT',rendered:null,assignment:null,events:[],errors:[],enrolled:false};states.set(node,state);
 function event(name,props){const e={name,time:Date.now(),...props};state.events.push(e);root.dispatchEvent(new CustomEvent('gallery-bootstrap:event',{detail:e}));
  if(state.telemetryAllowed&&root.posthog&&typeof posthog.capture==='function'&&!(typeof posthog.has_opted_out_capturing==='function'&&posthog.has_opted_out_capturing())){
   const names={image_selected:'gallery_image_viewed',image_ready:'gallery_image_ready',image_failed:'gallery_image_failed'};
   posthog.capture(names[name]||'gallery_bootstrap_diagnostic',{...state.analyticsProps,...props,diagnostic:name,event_id:uuid(),assignment_id:state.assignment&&state.assignment.assignmentId,source:'gallery_bootstrap_v2',is_internal:false});
   if(name==='image_selected'&&props.reason==='thumbnail')posthog.capture('gallery_thumbnail_clicked',{...state.analyticsProps,...props,event_id:uuid()});
   if(name==='image_selected'&&props.reason==='swipe')posthog.capture('gallery_swiped',{...state.analyticsProps,...props,event_id:uuid()});
  }
 }
 function control(reason){const c=template.content.firstElementChild;if(!c)throw Error('Missing original gallery');node.replaceChildren(...Array.from(c.cloneNode(true).childNodes));node.dataset.fceReady='true';node.dataset.nhgVariant='control';node.hidden=false;state.rendered='control';state.phase='NON_EXPERIMENTAL';event('fallback',{reason});}
 try{
  if(!m||m.schemaVersion!==2||!['STAGING','LIVE'].includes(m.environment)||!Array.isArray(m.variants)||m.variants.length!==2)throw Error('Invalid manifest');
  const sorted=m.variants.slice().sort((a,b)=>a.id.localeCompare(b.id));
  if(sorted.reduce((n,v)=>n+v.weightBasisPoints,0)!==10000||sorted.some(v=>!Number.isInteger(v.weightBasisPoints)||v.weightBasisPoints<0)||new Set(sorted.map(v=>v.id)).size!==2)throw Error('Invalid allocation');
  if(sha256(JSON.stringify([m.experimentId,m.slotId,m.allocationVersion,sorted]))!==m.cohortHash)throw Error('Manifest hash mismatch');
  const qa=m.environment==='STAGING',params=new URLSearchParams(location.search);
  const storageAllowed=qa||Boolean(root.Shopify&&Shopify.customerPrivacy&&typeof Shopify.customerPrivacy.analyticsProcessingAllowed==='function'&&Shopify.customerPrivacy.analyticsProcessingAllowed());
  const identityKey=qa?'_nhg_qa_visitor':'_fce_visitor';
  let visitor=storageAllowed?(store.get(identityKey)||store.cookie(identityKey)):null;
  if(!visitor||visitor.length<8||visitor.length>200)visitor=uuid();
  const persisted=storageAllowed&&(store.set(identityKey,visitor)|store.writeCookie(identityKey,visitor));
  const stickyKey=(qa?'_nhg_qa_assignment:':'_nhg_assignment:')+m.experimentId+':'+m.allocationVersion;
  let sticky=null;try{sticky=storageAllowed?JSON.parse(store.get(stickyKey)||'null'):null;}catch(_){}
  const b=bucket(visitor,m.experimentId,m.allocationVersion);let sum=0,selected;
  for(const arm of sorted){sum+=arm.weightBasisPoints;if(b<sum){selected=arm;break;}}
  if(!selected)throw Error('No allocated gallery');
  if(sticky&&(sticky.visitorId!==visitor||sticky.cohortHash!==m.cohortHash||sticky.variantId!==selected.id))throw Error('Stored cohort conflict');
  const forced=qa?params.get('variant'):null,forcedArm=sorted.find(v=>v.key===forced||v.id===forced);
  const rendered=m.status==='PAUSED'?sorted.find(v=>v.isControl):m.status==='PROMOTED'?sorted.find(v=>v.id===m.promotedVariantId):forcedArm||selected;
  if(!rendered)throw Error('Invalid experiment state');
  if(storageAllowed&&m.status==='RUNNING'&&!forcedArm)store.set(stickyKey,JSON.stringify({visitorId:visitor,cohortHash:m.cohortHash,variantId:selected.id}));
  state.visitorId=visitor;state.pending={experimentId:m.experimentId,slotId:m.slotId,allocationVersion:m.allocationVersion,variantId:selected.id,cohortHash:m.cohortHash};
  state.enrolled=m.status==='RUNNING'&&!forcedArm&&Boolean(persisted);state.telemetryAllowed=!qa&&state.enrolled;
  state.analyticsProps={experiment_id:m.experimentId,experiment_key:m.experimentKey,experiment_variant:rendered.key,variant_id:rendered.id,allocation_version:m.allocationVersion,cohort_hash:m.cohortHash,slot_id:m.slotId};
  state.rendered=rendered.key;state.phase='COMMITTED';state.imageReady=false;state.registered=false;state.visible=false;
  node.dataset.nhgOwned='true';node.dataset.nhgVariant=rendered.key;node.dataset.fceReady='true';
  let image;
  // Retain exact control DOM; its existing page handlers remain the only A controller.
  if(rendered.isControl){const original=template.content.firstElementChild.cloneNode(true);node.replaceChildren(...Array.from(original.childNodes));image=node.querySelector('#galMain');}
  else{
   const items=rendered.payload.items;if(!Array.isArray(items)||!items.length)throw Error('Empty gallery');
   let index=rendered.payload.initialIndex||0;if(!Number.isInteger(index)||index<0||index>=items.length)throw Error('Invalid initial index');
   const gallery=document.createElement('div');gallery.className='fce-gallery';gallery.setAttribute('role','region');gallery.setAttribute('aria-label','גלריית NovaHair');
   const stage=document.createElement('figure');stage.className='fce-gallery__stage';
   image=new Image();image.className='fce-gallery__image';image.loading='eager';image.fetchPriority='high';image.decoding='async';image.width=1000;image.height=1000;
   const caption=document.createElement('figcaption');caption.className='fce-gallery__caption';
   const thumbs=document.createElement('div');thumbs.className='fce-gallery__thumbs';const buttons=[];
   function show(i,reason){index=(i+items.length)%items.length;const entry=items[index],u=new URL(entry.src,location.href);if(u.protocol!=='https:'||u.hostname!=='cdn.shopify.com'||!u.pathname.startsWith('/s/files/'))throw Error('Unapproved image source');image.src=entry.src;image.alt=entry.alt;caption.textContent=entry.caption||'';caption.hidden=!entry.caption;buttons.forEach((b,j)=>b.setAttribute('aria-current',String(j===index)));event('image_selected',{index,image_id:entry.id,image_index:index+1,reason});}
   items.forEach((entry,i)=>{const button=document.createElement('button');button.type='button';button.className='fce-gallery__thumb';button.setAttribute('aria-label','תמונה '+(i+1));const thumb=new Image();thumb.alt='';thumb.loading='lazy';thumb.src=entry.src;button.append(thumb);button.addEventListener('click',()=>show(i,'thumbnail'));buttons.push(button);thumbs.append(button);});
   let x=null;stage.style.touchAction='pan-y';stage.addEventListener('pointerdown',e=>{x=e.clientX;});stage.addEventListener('pointercancel',()=>{x=null;});stage.addEventListener('pointerup',e=>{if(x===null)return;const d=e.clientX-x;x=null;if(Math.abs(d)>=45)show(index+(d<0?1:-1),'swipe');});
   stage.append(image,caption);gallery.append(stage);if(rendered.payload.showThumbnails!==false)gallery.append(thumbs);node.replaceChildren(gallery);show(index,'initial');
  }
  node.hidden=false;event('gallery_committed',{variant:rendered.key,enrolled:state.enrolled,qa});
  const ready=()=>{if(!image||!image.complete||image.naturalWidth===0)return;Promise.resolve(image.decode?image.decode():null).then(()=>{state.imageReady=true;node.querySelector('[data-nhg-image-error]')?.remove();state.phase='IMAGE_READY';event('image_ready',{variant:rendered.key});maybeExpose();}).catch(()=>{state.errors.push('decode');});};
  const failed=()=>{state.errors.push('image');state.phase='IMAGE_FAILED';event('image_failed',{variant:rendered.key});if(!rendered.isControl&&!node.querySelector('[data-nhg-image-error]')){const message=document.createElement('p');message.dataset.nhgImageError='true';message.setAttribute('role','status');message.textContent='התמונה לא נטענה כרגע. אפשר להמשיך לבחור גוון וחבילה.';node.append(message);}};
  if(image){image.addEventListener('load',ready,{once:true});image.addEventListener('error',failed,{once:true});ready();}
  let observer;
  if(root.IntersectionObserver){observer=new IntersectionObserver(entries=>{state.visible=entries.some(e=>e.isIntersecting&&e.intersectionRatio>=0.25);maybeExpose();},{threshold:[0.25]});observer.observe(node);}
  document.addEventListener('visibilitychange',maybeExpose);
  function context(assignment){let c={};try{c=JSON.parse(store.cookie('_funnel_context')||'{}');}catch(_){}c.visitorId=visitor;c.pendingGalleryBootstrap=state.pending;if(assignment){c.elementAssignments=(Array.isArray(c.elementAssignments)?c.elementAssignments:[]).filter(a=>a.experimentId!==assignment.experimentId);c.elementAssignments.push({assignmentId:assignment.assignmentId,experimentId:assignment.experimentId,variantId:assignment.variantId,slotId:assignment.slotId});}const encoded=JSON.stringify(c);if(encodeURIComponent(encoded).length>3700){event('context_unavailable',{reason:'cookie_capacity'});return;}store.writeCookie('_funnel_context',encoded);}
  async function post(path,payload){const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),keepalive:true});if(!response.ok)throw Error('HTTP '+response.status);return response.json();}
  function maybeExpose(){
   if(!state.imageReady||!state.visible||document.hidden||!state.enrolled||state.exposureQueued)return;
   if(qa){state.exposureQueued=true;event('qa_visible',{variant:rendered.key});return;}
   if(!state.registered)return;state.exposureQueued=true;
   const key='_nhg_exposure:'+m.experimentId+':'+m.allocationVersion+':'+sha256(visitor).slice(0,24);let record;try{record=JSON.parse(store.session(key)||'null');}catch(_){}
   if(record&&record.acked)return;record=record||{eventId:uuid(),acked:false};store.session(key,JSON.stringify(record));
   const a=state.assignment,payload={eventId:record.eventId,visitorId:visitor,assignmentId:a.assignmentId,experimentId:a.experimentId,variantId:a.variantId,slotId:a.slotId,isInternal:false};
   async function attempt(i){try{await post('/apps/funnels/element-exposure',payload);record.acked=true;store.session(key,JSON.stringify(record));event('exposure_acknowledged',{variant:rendered.key});observer&&observer.disconnect();}catch(e){if(i<2)setTimeout(()=>attempt(i+1),[300,1200][i]);else{state.errors.push('exposure');event('exposure_failed',{});}}}attempt(0);
  }
  if(!qa&&state.enrolled){
   context();if(root.FunnelControlAttribution&&typeof root.FunnelControlAttribution.persist==='function')root.FunnelControlAttribution.persist({visitorId:visitor});
   (async()=>{for(let retry=0;retry<2;retry++){try{
    const a=await post('/apps/funnels/gallery-bootstrap/register',{visitorId:visitor,pending:state.pending,isInternal:false});
    if(!a.accepted||a.variantId!==selected.id||a.allocationVersion!==m.allocationVersion||a.cohortHash!==m.cohortHash)throw Error('Registration conflict');
    state.assignment=a;state.registered=true;context(a);
    fetch('/cart.js',{credentials:'same-origin',headers:{Accept:'application/json'}}).then(r=>{if(!r.ok)throw Error('cart');return r.json();}).then(cart=>{const token=String(cart.token||'').split('?')[0];if(!token)return;const key='_nhg_cart:'+sha256(token)+':'+a.assignmentId;if(store.session(key))return;return post('/apps/funnels/element-cart-attribution',{cartToken:token,visitorId:visitor,elementAssignments:[{assignmentId:a.assignmentId,experimentId:a.experimentId,variantId:a.variantId,slotId:a.slotId}]}).then(()=>store.session(key,'1'));}).catch(()=>event('cart_attribution_pending',{}));
    if(root.FunnelControlAttribution&&typeof root.FunnelControlAttribution.persist==='function')root.FunnelControlAttribution.persist({visitorId:visitor,assignment:a});
    maybeExpose();return;
   }catch(e){state.errors.push(String(e.message));if(retry===0)await new Promise(r=>setTimeout(r,500));}}event('registration_failed',{});})();
  }
  return state;
 }catch(error){state.errors.push(String(error.message));control(String(error.message));return state;}
}
root.NHGalleryBootstrap=Object.freeze({mount,states,bucket,sha256});
})(window);

"""Gallery-only preview from real page. Commercial markup/state scripts remain unchanged; commerce is simulated."""
from pathlib import Path
import json,re,hashlib,sys
from bs4 import BeautifulSoup
HERE=Path(__file__).resolve().parent
SOURCE=Path(sys.argv[1]);UPSTREAM=Path(sys.argv[2]);OUT=Path(sys.argv[3]);OUT.mkdir(parents=True,exist_ok=True)
s=SOURCE.read_text()
start=s.index('<!-- NOVAHAIR SALES FUNNEL');end=s.index('<!-- NOVAHAIR_GALLERY_AB_RUNTIME_END v1 -->',start)+len('<!-- NOVAHAIR_GALLERY_AB_RUNTIME_END v1 -->')
body=s[start:end]
left='<!-- Gallery Column (Right on Desktop) -->';right='<!-- Purchase Column (Left on Desktop) -->'
assert body.count(left)==body.count(right)==1
before,tail=body.split(left);original_gallery,after=tail.split(right)
start_marker='<!-- NOVAHAIR_GALLERY_AB_RUNTIME_START v1 -->';end_marker='<!-- NOVAHAIR_GALLERY_AB_RUNTIME_END v1 -->'
assert after.count(start_marker)==after.count(end_marker)==1
a,rest=after.split(start_marker);_,b=rest.split(end_marker);after=a+b
soup=BeautifulSoup(body,'html.parser');original_info=str(soup.select_one('.hero-info'))
admin=(UPSTREAM/'app/cloudflare-pilot/public/admin/js/element-experiments.js').read_text()
entries=re.findall(r'\["([a-z0-9-]+)", "(https://cdn.shopify.com/[^\"]+\.webp\?v=1788823607)", "([^\"]+)"\]',admin)
assert len(entries)==10
arms=[{'id':'qa-variant-control','key':'control','isControl':True,'weightBasisPoints':5000,'revision':1,'payload':{'preserveExisting':True}},
{'id':'qa-variant-bbbbbbb','key':'variant-b','isControl':False,'weightBasisPoints':5000,'revision':1,'payload':{'items':[{'id':i,'src':u,'alt':a} for i,u,a in entries],'initialIndex':0,'showThumbnails':True}}]
arms.sort(key=lambda x:x['id'])
m={'schemaVersion':2,'environment':'STAGING','pagePath':'/pages/novahair-sales-staging','slotId':'qa-gallery-slot','slotKey':'novahair.sales.gallery.primary','experimentId':'qa-gallery-experiment','experimentKey':'qa-gallery-only-v2','allocationVersion':2,'cohortHash':'','status':'RUNNING','promotedVariantId':None,'publishedAt':'2026-09-10T00:00:00.000Z','posthogFlagKey':None,'variants':arms}
m['cohortHash']=hashlib.sha256(json.dumps([m['experimentId'],m['slotId'],m['allocationVersion'],arms],separators=(',',':'),ensure_ascii=False,sort_keys=True).encode()).hexdigest()
manifest=json.dumps(m,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
js=(HERE/'storefront/gallery-bootstrap.js').read_text();css=(HERE/'storefront/gallery-bootstrap.css').read_text()
slot=f'''<template id="nhg-control">{original_gallery}</template><div class="hero-media" id="nhg-slot" hidden></div>
<script>window.__NHG_MANIFEST={manifest};window.__NHG=NHGalleryBootstrap.mount(document.getElementById('nhg-slot'),document.getElementById('nhg-control'),window.__NHG_MANIFEST);</script>
<noscript>{original_gallery}</noscript>'''
patched=before+left+slot+right+after
assert str(BeautifulSoup(patched,'html.parser').select_one('.hero-info'))==original_info
pre_safety=patched
patched=re.sub(r'action="/contact#contact_form"','action="#preview-only"',patched)
stubs="""
window.__PREVIEW_CART=[];window.__PREVIEW_BLOCKED=[];
window.NOVASALE_VARIANT_MAP=new Proxy({}, {get:()=>123456789});
window.SalesPageCommerceAdapter=class { async addLineItem(...args){window.__PREVIEW_CART.push(args);document.getElementById('preview-status').textContent='Simulated cart only. No order or charge.';return {preview:true};} };
window.fetch=async function(url,options){window.__PREVIEW_BLOCKED.push(String(url));return new Response(JSON.stringify({items:[],item_count:0,total_price:0,token:'qa-cart'}),{status:200,headers:{'Content-Type':'application/json'}});};
document.addEventListener('submit',e=>{e.preventDefault();document.getElementById('preview-status').textContent='Form disabled in preview.';},true);
document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&!a.closest('#preview-bar')&&a.getAttribute('href')&&!a.getAttribute('href').startsWith('#'))e.preventDefault();},true);
"""
header='''<aside id="preview-bar" style="font:14px Arial;direction:ltr;text-align:center;padding:12px;background:#132b26;color:white;position:relative;z-index:2000">GALLERY-ONLY PREVIEW · Original shade & package controls preserved · No checkout<br><a style="color:#fff" href="?variant=control">A: Original</a> · <a style="color:#fff" href="?variant=variant-b">B: New</a> · <a style="color:#fff" href="?">Sticky 50/50</a><div id="preview-status" role="status"></div></aside>'''
csp="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https://cdn.shopify.com https://tigerbrandsglobal.com data:; connect-src 'none'; font-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'"
page=f'''<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="{csp}"><title>NovaHair · Gallery-only integration preview</title><style>{css}</style><script>{stubs}</script><script>{js}</script></head><body style="margin:0">{header}{patched}<cart-drawer hidden></cart-drawer></body></html>'''
(OUT/'index.html').write_text(page)
(OUT/'manifest.json').write_text(manifest)
# Archive raw public page only as a test artifact, not as a new active storefront.
report={'source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'shade_bundle_markup_unchanged':True,'original_gallery_markup_sha256':hashlib.sha256(original_gallery.encode()).hexdigest(),'changes':['Gallery subtree inert; selected gallery mounted once','Old gallery runtime removed','Preview only: commerce/forms/network disabled'],'forbidden_mutations':[]}
(OUT/'preservation-evidence.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))

"""Consent lifecycle gate for the existing candidate; ALL network mocked.
The normal preview uses STAGING mode, so this separately checks LIVE-mode logic.
No Shopify SDK setting, consent cookie, customer, or live resource is changed.
"""
import json, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
js=(ROOT/'integration/storefront/gallery-bootstrap.js').read_text()
m=json.loads((ROOT/'integration/preview/manifest.json').read_text());m['environment']='LIVE'
identity=next('consent-qa-'+str(i) for i in range(200) if int(hashlib.sha256(('consent-qa-'+str(i)+':'+m['experimentId']+':'+str(m['allocationVersion'])).encode()).hexdigest()[:12],16)%10000<5000)
assert sorted(m['variants'],key=lambda v:v['id'])[0]['key']=='variant-b'
base='http://127.0.0.1:8137'
result={'scope':'Real candidate JavaScript, synthetic privacy API, registration, images and telemetry; ALL network intercepted. NOT full Shopify SDK integration.','checks':[]}
OUT=Path('consent-qa-evidence');OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 def visit(mode):
  context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  boot="window.__calls=[];window.__consent="+('true' if mode=='allowed' else 'false')+";window.posthog={capture:(n,p)=>__calls.push({name:n}),has_opted_out_capturing:()=>false};window.Shopify="+('{}' if mode=='missing' else '{customerPrivacy:{analyticsProcessingAllowed:()=>window.__consent}}')+';'
  boot+="window.FunnelControlAttribution={persist:()=>{}};Object.defineProperty(crypto,'randomUUID',{value:()=>"+json.dumps(identity)+"});"
  html='<!doctype html><html><head><script>'+boot+'</script><script>'+js+'</script></head><body><template id="original"><div class="hero-media"><img id="galMain" src="https://cdn.shopify.com/s/files/qa/control.webp" width="200" height="200"></div></template><div id="slot" style="width:300px"></div><script>window.M='+json.dumps(m)+";window.S=NHGalleryBootstrap.mount(document.getElementById('slot'),document.getElementById('original'),M);</script></body></html>"
  def route(r):
   req=r.request
   if req.url==base+'/':r.fulfill(body=html,content_type='text/html');return
   if req.resource_type=='image':r.fulfill(body='<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#aaa"/></svg>',content_type='image/svg+xml');return
   if req.url==base+'/apps/funnels/gallery-bootstrap/register':
    q=json.loads(req.post_data);a=dict(q['pending']);a.update(assignmentId='synthetic-assignment',accepted=True);r.fulfill(json=a);return
   if req.url==base+'/cart.js':r.fulfill(json={'token':'qa-only-token'});return
   r.fulfill(json={'ok':True})
  page.route('**/*',route);page.goto(base+'/',wait_until='domcontentloaded');page.wait_for_timeout(200)
  return context,page,errors
 c,page,errors=visit('allowed')
 result['checks'].append({'name':'Permitted synthetic LIVE enrollment works','passed':page.evaluate('S.enrolled && S.registered'),'errors':errors})
 before=page.evaluate('__calls.length')
 page.evaluate("__consent=false;document.dispatchEvent(new CustomEvent('visitorConsentCollected',{detail:{analyticsAllowed:false}}));document.querySelectorAll('.fce-gallery__thumb')[1].click()")
 page.wait_for_timeout(100);after=page.evaluate('__calls.length')
 result['checks'].append({'name':'No new capture calls after consent revocation','passed':after==before,'new_capture_calls':after-before,'telemetry_flag':page.evaluate('S.telemetryAllowed')})
 c.close()
 c,page,errors=visit('missing')
 before=page.evaluate('({rendered:S.rendered,enrolled:S.enrolled,registered:S.registered})')
 page.evaluate("Shopify.customerPrivacy={analyticsProcessingAllowed:()=>true};__consent=true;document.dispatchEvent(new CustomEvent('visitorConsentCollected',{detail:{analyticsAllowed:true}}))")
 page.wait_for_timeout(100);after=page.evaluate('({rendered:S.rendered,enrolled:S.enrolled,registered:S.registered})')
 result['late_initialization_observation']={'before':before,'after':after,'note':'Needs an explicit late-consent persistence policy; do not silently rerandomize or retroactively claim exposure.'}
 c.close();browser.close()
result['release_gate_passed']=all(c['passed'] for c in result['checks'])
(OUT/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
if not result['release_gate_passed']:raise SystemExit(1)

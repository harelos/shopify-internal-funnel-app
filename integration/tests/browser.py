from pathlib import Path
from playwright.sync_api import sync_playwright
import json,time,os
HERE=Path(__file__).resolve().parents[1]
UPSTREAM=Path(os.environ['GALLERY_UPSTREAM'])
IMAGE=(UPSTREAM/'app/cloudflare-pilot/public/assets/novahair-gallery/01-roots-returned.webp').read_bytes()
(HERE/'evidence').mkdir(exist_ok=True)
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 def visit(variant='variant-b',fail=False,storage=False,js=True):
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,java_script_enabled=js)
  page=context.new_page();errors=[];network=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   u=r.request.url
   if u.startswith('http://127.0.0.1:8135'):r.continue_();return
   network.append({'url':u,'method':r.request.method})
   if r.request.resource_type=='image' and r.request.method=='GET':
    if fail:r.abort()
    elif os.getenv('GALLERY_REAL_IMAGES')=='1':r.continue_()
    else:r.fulfill(body=IMAGE,content_type='image/webp')
   else:r.abort()
  page.route('**/*',route)
  if storage:page.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}});Object.defineProperty(document,'cookie',{get(){return ''},set(){}});")
  page.goto('http://127.0.0.1:8135/index.html?'+('variant='+variant if variant else ''),wait_until='domcontentloaded')
  if js:page.wait_for_function('window.__NHG && window.__NHG.phase!=="INIT"')
  return context,page,errors,network
 def record(name,fn):
  try:detail=fn();results.append({'test':name,'pass':True,'detail':detail});print('PASS',name,flush=True)
  except Exception as e:results.append({'test':name,'pass':False,'error':str(e)});print('FAIL',name,e,flush=True)
 def commercial():
  c,page,errors,net=visit();page.wait_for_timeout(500)
  assert page.locator('.shade-option').count()==5
  assert page.locator('.bundle-card').count()==3
  page.locator('.shade-option[data-color="darkbrown"]').click()
  assert page.locator('.shade-option[data-color="darkbrown"]').evaluate('(e)=>e.classList.contains("sel")')
  page.locator('.bundle-card[data-offer="pack6"]').click()
  assert page.locator('.bundle-card[data-offer="pack6"]').evaluate('(e)=>e.classList.contains("sel")')
  page.locator('#mainCheckout').click();page.wait_for_timeout(300)
  assert page.evaluate('window.__PREVIEW_CART.length')==1
  assert not any(r['method']!='GET' for r in net)
  assert not errors,errors
  page.locator('#buy').scroll_into_view_if_needed();page.screenshot(path=str(HERE/'evidence/real-controls-B.png'))
  c.close();return '5 real shades, 3 real bundles, original state functions, simulated commerce boundary'
 def sticky():
  c,page,errors,net=visit('');v=page.evaluate('window.__NHG.rendered');visitor=page.evaluate('window.__NHG.visitorId')
  for _ in range(3):
   page.reload(wait_until='domcontentloaded');assert page.evaluate('window.__NHG.rendered')==v;assert page.evaluate('window.__NHG.visitorId')==visitor
  c.close();return v
 def no_a():
  c,page,errors,net=visit();assert page.locator('#galMain').count()==0;assert page.locator('.fce-gallery__image').count()==1
  a=page.evaluate('window.__NHG');assert a['rendered']=='variant-b' and not a['errors'],a
  for _ in range(3):page.wait_for_timeout(500);assert page.locator('#galMain').count()==0
  page.evaluate('NHGalleryBootstrap.mount(document.getElementById("nhg-slot"),document.getElementById("nhg-control"),__NHG_MANIFEST)');assert page.locator('.fce-gallery__image').count()==1
  c.close();return 'No control in active DOM; duplicate initialization ignored'
 def original():
  c,page,errors,net=visit('control');assert page.locator('#galMain').count()==1
  original=page.locator('#galMain').get_attribute('src');page.locator('.thumb').nth(1).click();page.wait_for_timeout(400);assert page.locator('#galMain').get_attribute('src')!=original
  page.screenshot(path=str(HERE/'evidence/real-controls-A.png'));assert not errors,errors;c.close();return 'Original thumbnail handlers work'
 def failed():
  c,page,errors,net=visit(fail=True);page.wait_for_timeout(300);a=page.evaluate('window.__NHG');assert a['rendered']=='variant-b';assert a['phase']=='IMAGE_FAILED';assert page.locator('#galMain').count()==0;assert not a.get('exposureQueued');c.close();return 'Failed B never switches to A or reports exposure'
 def blocked():
  c,page,errors,net=visit('',storage=True);assert page.evaluate('window.__NHG.enrolled')==False;assert page.locator('.bundle-card').count()==3;assert not errors,errors;c.close();return 'Usable page, unstable identity excluded'
 def nojs():
  c,page,errors,net=visit(js=False);assert page.locator('#galMain').count()==1;assert page.locator('#galMain').is_visible();c.close();return 'Original control without JS'
 for name,fn in [('Real controls unchanged and functional',commercial),('Same visitor sticky on reload',sticky),('B mounts once without A',no_a),('Original A controller preserved',original),('Image failure never relabels B',failed),('Storage getter blocked',blocked),('JavaScript disabled',nojs)]:record(name,fn)
 browser.close()
(HERE/'evidence/browser-results.json').write_text(json.dumps(results,indent=2))
if not all(x['pass'] for x in results):raise SystemExit(1)

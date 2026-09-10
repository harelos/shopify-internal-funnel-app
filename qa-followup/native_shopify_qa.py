"""Read-only native rendering QA. Commerce, privacy SDK, backend and publication
are explicitly simulated/disabled. Nothing here establishes a production release.
Every request except the selected QA document and public images is intercepted.
"""
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
URL='https://tigerbrandsglobal.com/pages/novahair-sales-staging?preview_theme_id=188167684391&view=nhgalleryqa20260910&variant=variant-b'
OUT=Path('native-qa-evidence');OUT.mkdir(exist_ok=True)
results={'url':URL,'scope':'Unpublished alternate-template rendering only. Backend, privacy SDK, checkout and publication NOT validated.','checks':[],'blocked_requests':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
 page=context.new_page();errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 def guard(route):
  req=route.request;u=urlparse(req.url)
  doc=u.hostname=='tigerbrandsglobal.com' and u.path=='/pages/novahair-sales-staging' and parse_qs(u.query).get('view')==['nhgalleryqa20260910']
  img=req.resource_type=='image' and u.hostname in {'cdn.shopify.com','tigerbrandsglobal.com'} and '/s/files/' in u.path
  if req.method=='GET' and (doc or img):route.continue_()
  else:
   results['blocked_requests'].append({'host':u.hostname,'path':u.path,'method':req.method,'kind':req.resource_type});route.abort()
 page.route('**/*',guard)
 def demand(value,message):
  assert value,message
 def check(label,fn):
  fn();results['checks'].append({'name':label,'passed':True})
 try:
  page.goto(URL,wait_until='domcontentloaded',timeout=45000)
  check('QA template served, not normal live page',lambda:demand(page.locator('#preview-bar').count()==1,'QA marker absent'))
  check('QA limitations visible',lambda:demand(page.get_by_text('SHOPIFY-NATIVE RENDERING QA ONLY',exact=False).count()>0,'QA warning absent'))
  page.wait_for_function('window.__NHG && window.__NHG.imageReady===true',timeout=45000)
  check('Challenger first image decoded',lambda:demand(page.evaluate('__NHG.rendered')=='variant-b','Wrong gallery'))
  check('No active old gallery in B',lambda:demand(page.locator('#galMain').count()==0,'Old gallery present'))
  check('Original five shade options and three packages',lambda:demand(page.locator('.shade-option').count()==5 and page.locator('.bundle-card').count()==3,'Controls missing'))
  page.locator('.shade-option[data-color="darkbrown"]').click();page.locator('.bundle-card[data-offer="pack6"]').click()
  check('Real selection functions update controls',lambda:demand(page.locator('.shade-option[data-color="darkbrown"].sel').count()==1 and page.locator('.bundle-card[data-offer="pack6"].sel').count()==1,'Selection failed'))
  page.locator('#mainCheckout').click()
  check('Commerce remains simulated',lambda:demand(page.evaluate('__PREVIEW_CART.length')==1,'Simulation failed'))
  page.locator('#buy').scroll_into_view_if_needed();page.screenshot(path=str(OUT/'native-gallery-B.png'))
  page.locator('#preview-bar a').filter(has_text='Sticky 50/50').click()
  page.wait_for_function('window.__NHG && __NHG.phase!=="INIT"')
  initial=page.evaluate('({visitor:__NHG.visitorId,variant:__NHG.rendered})')
  for _ in range(2):
   page.reload(wait_until='domcontentloaded');page.wait_for_function('window.__NHG && __NHG.phase!=="INIT"')
   demand(page.evaluate('({visitor:__NHG.visitorId,variant:__NHG.rendered})')==initial,'Identity/variant changed')
  check('QA identity and assignment stable on reload',lambda:demand(True,''))
  # Shopify can remove preview_theme_id after selecting the preview. The unique
  # template marker and its QA text must remain; parameter presence alone is not proof.
  check('QA navigation still serves the isolated template',lambda:demand('view=nhgalleryqa20260910' in page.url and page.locator('#preview-bar').count()==1 and page.get_by_text('SHOPIFY-NATIVE RENDERING QA ONLY',exact=False).count()>0,'QA template lost'))
  check('No page JavaScript exceptions in isolated harness',lambda:demand(not errors,str(errors)))
  check('No disallowed network requests attempted',lambda:demand(not results['blocked_requests'],str(results['blocked_requests'])))
  results['passed']=True
 except Exception as error:
  results['passed']=False;results['error']=str(error);page.screenshot(path=str(OUT/'failure.png'))
 finally:
  results['final_url']=page.url;results['javascript_errors']=errors
  results['platform_features_simulated']=True
  (OUT/'result.json').write_text(json.dumps(results,indent=2));browser.close()
print(json.dumps(results,indent=2))
if not results.get('passed'):raise SystemExit(1)

"""Verify public sandbox, preserving hosting consent and strict image readiness checks."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import os,json
HERE=Path(__file__).resolve().parents[1];OUT=HERE/'evidence';OUT.mkdir(exist_ok=True)
url=os.environ['GALLERY_PUBLIC_PREVIEW_URL']
diagnostics={'requestedUrl':url,'console':[],'errors':[],'failedRequests':[],'responses':[]}
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844})
 page.on('console',lambda message:diagnostics['console'].append({'type':message.type,'text':message.text}))
 page.on('pageerror',lambda error:diagnostics['errors'].append(str(error)))
 page.on('requestfailed',lambda request:diagnostics['failedRequests'].append({'url':request.url,'failure':request.failure}))
 page.on('response',lambda response:diagnostics['responses'].append({'url':response.url,'status':response.status}))
 try:
  page.goto(url,wait_until='domcontentloaded')
  page.wait_for_timeout(1000)
  notice=page.get_by_text('Open the page',exact=True)
  if 'External Content Notice' in page.title() and notice.count():
   diagnostics['noticeFollowed']=True
   notice.first.click()
   page.wait_for_timeout(500)
  page.wait_for_function('window.__NHG && window.__NHG.imageReady===true',timeout=20000)
  assert page.evaluate('window.__NHG.rendered')=='variant-b'
  assert page.locator('.shade-option').count()==5
  assert page.locator('.bundle-card').count()==3
  assert page.locator('#galMain').count()==0
  page.locator('#nhg-slot').scroll_into_view_if_needed()
  page.screenshot(path=str(OUT/'public-gallery-B.png'))
  page.locator('#buy').scroll_into_view_if_needed()
  page.screenshot(path=str(OUT/'public-real-controls-B.png'))
  result={'url':page.url,'imageReady':True,'shades':5,'bundles':3,'rendered':'variant-b','nativeIPhoneTest':False}
  (OUT/'public-preview.json').write_text(json.dumps(result,indent=2))
  diagnostics['passed']=True;print('PASS public original-controls preview')
 except Exception as error:
  diagnostics['passed']=False;diagnostics['failure']=str(error)
  page.screenshot(path=str(OUT/'public-preview-failure.png'),full_page=False)
  raise
 finally:
  diagnostics['url']=page.url;diagnostics['title']=page.title()
  diagnostics['bodyExcerpt']=page.locator('body').inner_text()[:2500]
  diagnostics['state']=page.evaluate('window.__NHG || null')
  diagnostics['images']=page.locator('#nhg-slot img').evaluate_all('(images)=>images.map(i=>({src:i.currentSrc||i.src,complete:i.complete,width:i.naturalWidth}))')
  (OUT/'public-preview-diagnostics.json').write_text(json.dumps(diagnostics,indent=2,ensure_ascii=False))
  print(json.dumps({k:v for k,v in diagnostics.items() if k not in ['responses','console']},ensure_ascii=False),flush=True)
  browser.close()

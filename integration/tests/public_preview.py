"""Verify the already-built public sandbox URL. No live shop runtime or checkout requests."""
from playwright.sync_api import sync_playwright
from pathlib import Path
import os,json
HERE=Path(__file__).resolve().parents[1]
url=os.environ['GALLERY_PUBLIC_PREVIEW_URL']
with sync_playwright() as p:
 browser=p.chromium.launch(args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844})
 page.goto(url,wait_until='domcontentloaded')
 if page.get_by_text('External Content Notice',exact=False).count():
  page.get_by_role('link',name='Open the page',exact=False).click()
 page.wait_for_function('window.__NHG && window.__NHG.imageReady===true',timeout=60000)
 assert page.evaluate('window.__NHG.rendered')=='variant-b'
 assert page.locator('.shade-option').count()==5
 assert page.locator('.bundle-card').count()==3
 assert page.locator('#galMain').count()==0
 page.locator('#buy').scroll_into_view_if_needed()
 page.screenshot(path=str(HERE/'evidence/public-real-controls-B.png'))
 result={'url':page.url,'imageReady':True,'shades':5,'bundles':3,'rendered':'variant-b','nativeIPhoneTest':False}
 (HERE/'evidence/public-preview.json').write_text(json.dumps(result,indent=2))
 browser.close();print('PASS public original-controls preview')

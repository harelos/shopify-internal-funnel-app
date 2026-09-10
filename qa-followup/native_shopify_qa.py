"""Read-only browser QA of an optional UNPUBLISHED Shopify template.
Does not publish, edit Shopify, authenticate to backend, or send customer messages.
Every request except the selected QA document and public images is intercepted.
"""
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

URL = 'https://tigerbrandsglobal.com/pages/novahair-sales-staging?preview_theme_id=188167684391&view=nhgalleryqa20260910&variant=variant-b'
OUT = Path('native-qa-evidence')
OUT.mkdir(exist_ok=True)
results = {'url': URL, 'scope': 'Unpublished alternate-template rendering only. Backend, checkout, and publication NOT validated.', 'checks': [], 'blocked_requests': []}
with sync_playwright() as p:
    browser = p.chromium.launch(args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True, has_touch=True)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    def guard(route):
        req = route.request
        parsed = urlparse(req.url)
        qa_document = (parsed.hostname == 'tigerbrandsglobal.com' and parsed.path == '/pages/novahair-sales-staging' and parse_qs(parsed.query).get('view') == ['nhgalleryqa20260910'])
        image = req.resource_type == 'image' and parsed.hostname in {'cdn.shopify.com','tigerbrandsglobal.com'} and '/s/files/' in parsed.path
        if req.method == 'GET' and (qa_document or image):
            route.continue_()
        else:
            results['blocked_requests'].append({'host':parsed.hostname, 'path':parsed.path, 'method':req.method, 'kind':req.resource_type})
            route.abort()
    page.route('**/*', guard)
    def check(label, fn):
        fn()
        results['checks'].append({'name':label, 'passed':True})
    def demand(value, message):
        assert value, message
    try:
        response = page.goto(URL, wait_until='domcontentloaded', timeout=45000)
        check('QA template actually served, not normal live page', lambda: demand(page.locator('#preview-bar').count() == 1, 'QA template marker absent'))
        check('Native QA limitation visible', lambda: demand(page.get_by_text('SHOPIFY-NATIVE RENDERING QA ONLY', exact=False).count() > 0, 'QA warning absent'))
        page.wait_for_function('window.__NHG && window.__NHG.imageReady===true', timeout=45000)
        check('Challenger first image decoded', lambda: demand(page.evaluate('window.__NHG.rendered') == 'variant-b', 'Wrong gallery'))
        check('No active old gallery in B', lambda: demand(page.locator('#galMain').count() == 0, 'Old gallery present'))
        check('Original five shade options and three package cards', lambda: demand(page.locator('.shade-option').count()==5 and page.locator('.bundle-card').count()==3, 'Original controls missing'))
        page.locator('.shade-option[data-color="darkbrown"]').click()
        page.locator('.bundle-card[data-offer="pack6"]').click()
        check('Real selection functions update real controls', lambda: demand(page.locator('.shade-option[data-color="darkbrown"].sel').count()==1 and page.locator('.bundle-card[data-offer="pack6"].sel').count()==1, 'Selection failed'))
        page.locator('#mainCheckout').click()
        check('Commerce remains simulated', lambda: demand(page.evaluate('window.__PREVIEW_CART.length')==1, 'Simulation boundary failed'))
        page.locator('#preview-bar a').filter(has_text='Sticky 50/50').click()
        page.wait_for_function('window.__NHG && window.__NHG.phase!=="INIT"')
        original = page.evaluate('({visitor:__NHG.visitorId,variant:__NHG.rendered})')
        for _ in range(2):
            page.reload(wait_until='domcontentloaded')
            page.wait_for_function('window.__NHG && window.__NHG.phase!=="INIT"')
            demand(page.evaluate('({visitor:__NHG.visitorId,variant:__NHG.rendered})') == original, 'Sticky identity/variant changed')
        check('QA assignment remains sticky across native reloads', lambda: demand(True, ''))
        check('QA navigation keeps unpublished theme and alternate template', lambda: demand('view=nhgalleryqa20260910' in page.url and 'preview_theme_id=188167684391' in page.url, 'Navigation escaped sandbox'))
        results['javascript_errors'] = errors
        check('No page JavaScript exceptions', lambda: demand(not errors, str(errors)))
        results['passed'] = True
        page.locator('#buy').scroll_into_view_if_needed()
        page.screenshot(path=str(OUT/'native-gallery.png'))
    except Exception as error:
        results['passed'] = False
        results['error'] = str(error)
        results['javascript_errors'] = errors
        page.screenshot(path=str(OUT/'failure.png'))
    finally:
        (OUT/'result.json').write_text(json.dumps(results, indent=2))
        browser.close()
print(json.dumps(results, indent=2))
if not results.get('passed'):
    raise SystemExit(1)

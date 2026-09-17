const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const QA_URL = process.env.NHAI_QA_URL
  || 'https://tigerbrandsglobal.com/pages/novahair-sales-staging?preview_theme_id=188482584871';
const REAL_BUY_NAVIGATION = process.env.NHAI_REAL_BUY_NAVIGATION === '1';
const SHOTS = path.join(__dirname, 'shots');
const AI_FILES = [
  'novahair-popup-engine.config.js',
  'novahair-popup-engine.js',
  'novahair-ai-facts.js',
  'novahair-ai-flows.js',
  'novahair-ai-agents.js',
  'novahair-ai-attribution.js',
  'novahair-ai-tone.js',
  'novahair-ai-popup.js',
];
let activeBrowser = null;

function cartLines(cart) {
  return (cart.items || []).map(item => ({
    key: item.key,
    variantId: Number(item.variant_id),
    quantity: Number(item.quantity),
    properties: item.properties || {},
  }));
}

async function readCart(page) {
  return page.evaluate(async () => {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch('/cart.js', { cache: 'no-store' });
      lastStatus = response.status;
      if (response.ok) return response.json();
      if (response.status !== 429) break;
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    }
    throw new Error(`cart.js returned ${lastStatus}`);
  });
}

async function removePreviewBar(page) {
  await page.evaluate(() => {
    document.querySelector('#PBarNextFrameWrapper')?.remove();
    document.querySelector('#PBarNextFrame')?.remove();
  });
}

async function loadQaPage(page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(QA_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(() => document.readyState === 'complete');
      await page.waitForFunction(
        () => Boolean(window.NovaHairAIPopup && window.NovaHairPopupEngine),
        null,
        { timeout: 25_000 },
      );
      await page.waitForFunction(() => window.NovaHairPopupConfigState === 'ready', null, { timeout: 10_000 });
      await removePreviewBar(page);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function openPopup(page, trigger) {
  await page.evaluate(value => window.NovaHairAIPopup.open({
    trigger: value,
    reason: 'production-qa',
    engagementScore: 9,
    abandonScore: 5,
  }), trigger);
  await page.locator('.nhai[data-open="true"]').waitFor({ state: 'visible', timeout: 12_000 });
  await page.locator('.nhai__opt', { hasText: 'אני עדיין בודקת אם זה מתאים לי' })
    .waitFor({ state: 'visible', timeout: 12_000 });
}

async function clickOption(page, label) {
  const option = page.locator('.nhai__opt', { hasText: label }).first();
  await option.waitFor({ state: 'visible', timeout: 12_000 });
  await option.click();
}

async function typeFree(page, value) {
  const input = page.locator('.nhai__free input[type="text"]').first();
  await input.waitFor({ state: 'visible', timeout: 12_000 });
  await input.fill(value);
  await input.press('Enter');
}

async function assertPopupFits(page, viewport) {
  const box = await page.locator('.nhai__sheet').boundingBox();
  assert.ok(box, 'popup sheet must have a bounding box');
  assert.ok(box.x >= -1 && box.y >= -1, `popup starts outside viewport: ${JSON.stringify(box)}`);
  assert.ok(box.x + box.width <= viewport.width + 1, `popup overflows horizontally: ${JSON.stringify(box)}`);
  assert.ok(box.y + box.height <= viewport.height + 1, `popup overflows vertically: ${JSON.stringify(box)}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  activeBrowser = browser;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'he-IL',
    reducedMotion: 'reduce',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  const apiResponses = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => {
    const url = request.url();
    if (AI_FILES.some(file => url.includes(file)) || url.includes('/apps/funnels/api/')) {
      failedRequests.push({ url, error: request.failure()?.errorText || 'failed' });
    }
  });
  page.on('response', response => {
    if (response.url().includes('/apps/funnels/api/')) {
      apiResponses.push({ url: response.url(), status: response.status(), method: response.request().method() });
    }
  });

  await loadQaPage(page);

  const boot = await page.evaluate(async files => {
    const scripts = Array.from(document.scripts).map(script => script.src);
    const remoteResponse = await fetch('/apps/funnels/api/popup-trigger-config', { cache: 'no-store' });
    const remoteConfig = await remoteResponse.json().catch(() => ({}));
    return {
      path: location.pathname,
      handle: window.NovaHairAIOptions?.page?.handle,
      placement: window.NovaHairAIOptions?.placement,
      triggerConfigState: window.NovaHairPopupConfigState,
      triggerConfigEnabled: window.NovaHairPopupConfig?.enabled,
      remoteStatus: remoteResponse.status,
      remoteConfig,
      shadeCount: window.NovaHairAIFlows?.shades?.length,
      files: files.map(file => ({ file, loaded: scripts.some(src => src.includes(file)) })),
    };
  }, AI_FILES);
  assert.equal(boot.path, '/pages/novahair-sales-staging');
  assert.equal(boot.handle, 'novahair-sales-staging');
  assert.equal(boot.placement, 'exit_sales');
  assert.equal(boot.triggerConfigState, 'ready');
  const configRateLimited = boot.triggerConfigEnabled !== true && boot.remoteStatus === 429;
  if (configRateLimited) {
    await page.evaluate(() => { window.NovaHairPopupConfig.enabled = true; });
  } else {
    assert.equal(boot.triggerConfigEnabled, true, `signed backend config must enable the popup on QA: ${JSON.stringify(boot)}`);
  }
  assert.equal(boot.shadeCount, 5, 'all five approved shades must exist at runtime');
  assert.deepEqual(boot.files.filter(item => !item.loaded), []);

  const proxyHealth = await page.evaluate(async () => {
    let result = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetch('/apps/funnels/api/proxy-health', { cache: 'no-store' });
      result = { status: response.status, contentType: response.headers.get('content-type'), body: await response.text() };
      if (response.status !== 429) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    return result;
  });
  assert.equal(proxyHealth.status, 200, JSON.stringify(proxyHealth));
  assert.match(proxyHealth.contentType || '', /application\/json/);
  assert.equal(JSON.parse(proxyHealth.body).service, 'novahair-ai-concierge');

  await page.evaluate(async () => {
    await fetch('/cart/clear.js', { method: 'POST', headers: { Accept: 'application/json' } });
  });

  const cartBefore = await readCart(page);
  assert.equal(cartBefore.item_count, 0, 'the isolated QA cart must start empty');

  await page.evaluate(async () => {
    await window.NovaHairAttribution.writeCartAttributes({
      conversationId: 'production-qa',
      agent: 'sales',
      trigger: 'production-qa',
    });
  });
  const cartAfterAttribution = await readCart(page);
  assert.deepEqual(cartLines(cartAfterAttribution), cartLines(cartBefore), 'attribution must not alter any cart line');

  await openPopup(page, 'production-qa-mobile');
  await assertPopupFits(page, { width: 390, height: 844 });
  assert.equal(await page.locator('.nhai').getAttribute('role'), 'dialog');
  assert.equal(await page.evaluate(() => document.querySelector('.nhai').contains(document.activeElement)), true);
  const expectedOpener = 'היי, אני נעמה מ־NovaHair.\nמה יעזור לך עכשיו?';
  await page.waitForFunction(expected => Array.from(document.querySelectorAll('.nhai__msg--ai'))
    .some(message => message.textContent === expected), expectedOpener);

  await clickOption(page, 'אני עדיין בודקת אם זה מתאים לי');
  await clickOption(page, 'רק מתחילה לברר');
  await clickOption(page, 'שלא אדע לבחור גוון נכון');
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await page.locator('.nhai__consent').count(), 1);
  await clickOption(page, 'להמשיך בלי מייל');
  await clickOption(page, 'אני מעדיפה לבחור לבד');
  await clickOption(page, 'חום כהה');
  await page.locator('.nhai__sw').first().waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await page.locator('.nhai__sw').count(), 5);
  assert.deepEqual(await page.locator('.nhai__sw span').evaluateAll(spans => spans.map(span => ({
    color: getComputedStyle(span).backgroundColor,
    image: getComputedStyle(span).backgroundImage,
  }))), [
    { color: 'rgb(28, 28, 28)', image: 'none' },
    { color: 'rgb(61, 40, 23)', image: 'none' },
    { color: 'rgb(122, 82, 48)', image: 'none' },
    { color: 'rgb(74, 21, 75)', image: 'none' },
    { color: 'rgb(107, 20, 38)', image: 'none' },
  ]);
  await page.screenshot({ path: path.join(SHOTS, 'qa-unpublished-mobile-shades.png') });
  await page.locator('.nhai__x').click();

  const cartAfterShadeFlow = await readCart(page);
  assert.deepEqual(cartLines(cartAfterShadeFlow), cartLines(cartBefore), 'shade flow must not alter any cart line');

  await loadQaPage(page);
  await openPopup(page, 'production-qa-ai');
  await clickOption(page, 'אני עדיין בודקת אם זה מתאים לי');
  await clickOption(page, 'מחכה לתור הבא במספרה');
  await typeFree(page, 'אני מפחדת שהתוצאה תיראה חזקה ולא טבעית');
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 15_000 });
  const bridgeText = await page.locator('.nhai__msg--ai').last().innerText();
  assert.ok(bridgeText.split(/\s+/).filter(Boolean).length <= 18, 'email bridge must be at most 18 words');
  assert.doesNotMatch(bridgeText, /מייל|הנחה|\?/);
  await clickOption(page, 'להמשיך בלי מייל');
  await page.screenshot({ path: path.join(SHOTS, 'qa-unpublished-mobile-ai.png') });
  await page.locator('.nhai__x').click();

  const cartAfterAi = await readCart(page);
  assert.deepEqual(cartLines(cartAfterAi), cartLines(cartBefore), 'AI answer must not alter any cart line');

  await loadQaPage(page);
  await openPopup(page, 'production-qa-why-switch');
  await clickOption(page, 'אני עדיין בודקת אם זה מתאים לי');
  await clickOption(page, 'מחכה לתור הבא במספרה');
  await clickOption(page, 'השורשים חוזרים תוך שבועיים');
  await clickOption(page, 'להמשיך בלי מייל');
  await clickOption(page, 'זה בדיוק זה');
  await clickOption(page, 'לחסוך את העלות החוזרת');
  await clickOption(page, 'כן, תראי לי');
  await clickOption(page, 'למה נשים עוברות לזה');
  await page.locator('.nhai__msg--ai', { hasText: 'בעיקר בגלל השליטה' })
    .waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.nhai__msg--ai', { hasText: 'כ־₪1.99 לטיפול שורשים' })
    .waitFor({ state: 'visible', timeout: 15_000 });
  const whySwitchPopupText = await page.locator('.nhai').innerText();
  assert.doesNotMatch(whySwitchPopupText, /7 הסיבות|שבע הסיבות|קחי אותי למוצר|קחי אותי למארז/);
  assert.equal(await page.locator('.nhai__card', { hasText: 'שלושה שלבים' }).count(), 0);
  assert.deepEqual(await page.locator('.nhai__foot .nhai__opt').allInnerTexts(), [
    'כן, זה בדיוק מה שאני מחפשת',
    'עזרי לי לבחור גוון',
    'איך משתמשים בדיוק',
    'יש לי עוד שאלה',
  ]);
  await page.screenshot({ path: path.join(SHOTS, 'qa-unpublished-mobile-why-switch.png') });
  await clickOption(page, 'כן, זה בדיוק מה שאני מחפשת');
  await page.locator('.nhai__msg--ai', { hasText: 'את חוסכת ₪519 (68%)' })
    .waitFor({ state: 'visible', timeout: 15_000 });
  if (!REAL_BUY_NAVIGATION) {
    await page.evaluate(() => {
      window.NovaHairAIOptions.noRedirect = true;
      window.__lastRedirect = '';
    });
  }
  await clickOption(page, 'לבחירת הגוון ולהזמנה');
  if (REAL_BUY_NAVIGATION) {
    await page.waitForFunction(() => location.hash === '#buy', null, { timeout: 15_000 });
    await page.locator('.nhai[data-open="false"]').waitFor({ state: 'attached', timeout: 15_000 });
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
    assert.equal(await page.locator('#buy').count(), 1, 'the primary buy anchor must exist');
  } else {
    await page.waitForFunction(() => Boolean(window.__lastRedirect), null, { timeout: 15_000 });
    assert.equal(await page.evaluate(() => window.__lastRedirect), '#buy');
    await page.locator('.nhai__x').click();
  }

  const cartAfterWhySwitch = await readCart(page);
  assert.deepEqual(cartLines(cartAfterWhySwitch), cartLines(cartBefore), 'why-switch flow must not alter any cart line');

  await loadQaPage(page);
  await openPopup(page, 'production-qa-returning');
  await clickOption(page, 'כבר קניתי אצלכם');
  await clickOption(page, 'להזמין שוב');
  await page.locator('input[type="email"][placeholder="האימייל שהזמנת איתו"]')
    .waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await page.locator('.nhai__consent').count(), 0, 'identity lookup must not ask for marketing consent');
  await clickOption(page, 'להמשיך בלי לזהות');
  if (!REAL_BUY_NAVIGATION) {
    await page.waitForFunction(() => Boolean(window.__lastRedirect), null, { timeout: 15_000 });
    assert.equal(await page.evaluate(() => window.__lastRedirect), '#buy');
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await loadQaPage(page);
  await openPopup(page, 'production-qa-desktop');
  await assertPopupFits(page, { width: 1440, height: 900 });
  await page.screenshot({ path: path.join(SHOTS, 'qa-unpublished-desktop.png') });

  const protectedApiFailures = apiResponses.filter(item => item.status >= 400
    && !(item.status === 429 && item.url.includes('/popup-trigger-config')));
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors.filter(message => !/favicon/i.test(message)), []);
  assert.deepEqual(failedRequests, []);
  assert.deepEqual(protectedApiFailures, []);
  assert.ok(apiResponses.some(item => item.url.includes('/ai-chat') && item.status === 200), 'real AI endpoint must return 200');
  assert.ok(apiResponses.some(item => item.url.includes('/track') && item.status < 300), 'tracking endpoint must accept events');

  await context.close();
  await browser.close();
  console.log(JSON.stringify({
    ok: true,
    url: QA_URL,
    shades: boot.shadeCount,
    cartLinesPreserved: cartLines(cartBefore).length,
    emailBridge: bridgeText,
    apiResponses: apiResponses.length,
    configRateLimited,
    screenshots: [
      'qa-unpublished-mobile-shades.png',
      'qa-unpublished-mobile-ai.png',
      'qa-unpublished-mobile-why-switch.png',
      'qa-unpublished-desktop.png',
    ],
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  Promise.resolve(activeBrowser?.close()).finally(() => {
    process.exitCode = 1;
  });
});

const assert = require('node:assert/strict');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const LIVE_URL = 'https://tigerbrandsglobal.com/pages/novahair-sales-staging?ai_smoke=20260906&utm_source=qa&utm_medium=automation&utm_campaign=codex-ai-popup-smoke';
const SHIPPING_REPLY = 'המשלוח מגיע לכל נקודה בארץ תוך 5 עד 12 ימי עסקים, וחינם בהזמנה מעל 199 שקל.';
let activeBrowser = null;

function cartSnapshot(cart) {
  return {
    itemCount: cart.item_count,
    totalPrice: cart.total_price,
    items: cart.items.map((item) => ({
      key: item.key,
      id: item.id,
      quantity: item.quantity,
      finalLinePrice: item.final_line_price,
    })),
  };
}

async function readCart(page) {
  const delays = [0, 2_000, 4_000, 8_000, 12_000];
  let lastStatus = 0;
  for (const delay of delays) {
    if (delay) await page.waitForTimeout(delay);
    const result = await page.evaluate(async () => {
      const response = await fetch('/cart.js', { cache: 'no-store' });
      return { status: response.status, text: await response.text() };
    });
    lastStatus = result.status;
    if (result.status === 200) return JSON.parse(result.text);
    if (result.status !== 429) throw new Error(`cart.js returned ${result.status}`);
  }
  throw new Error(`cart.js remained rate-limited after retries (${lastStatus})`);
}

async function option(page, label) {
  const button = page.locator('.nhai__opt', { hasText: label }).first();
  await button.waitFor({ state: 'visible', timeout: 12_000 });
  await button.click();
}

async function freeText(page, value) {
  const input = page.locator('.nhai__free input[type="text"]').first();
  await input.waitFor({ state: 'visible', timeout: 12_000 });
  await input.fill(value);
  await input.press('Enter');
}

async function loadLivePage(browser, viewport) {
  const context = await browser.newContext({ viewport, locale: 'he-IL' });
  const page = await context.newPage();
  const popupErrors = [];
  const cartMutations = [];
  const assetStatuses = new Map();
  const trackingBodies = [];

  page.on('pageerror', (error) => {
    if (/novahair|nhai/i.test(error.message)) popupErrors.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && /\[nhai\]|novahair-ai/i.test(message.text())) {
      popupErrors.push(message.text());
    }
  });
  page.on('request', (request) => {
    if (/\/cart\/(?:add|change|clear|update)\.js(?:\?|$)/.test(request.url())) {
      cartMutations.push(request.url());
    }
  });
  page.on('response', (response) => {
    const match = response.url().match(/\/assets\/(novahair-(?:ai|popup)[^?]+|nh-(?:shade|advisor)[^?]+)/);
    if (match) assetStatuses.set(match[1], response.status());
  });
  await page.route('**/apps/funnels/api/ai-chat', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ reply: SHIPPING_REPLY, next: 'root_choice' }),
  }));
  await page.route('**/apps/funnels/api/track*', async (route) => {
    try { trackingBodies.push(route.request().postDataJSON()); } catch (_) {}
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ accepted: true, duplicate: false, eventId: 'production-smoke' }),
    });
  });

  await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => Boolean(window.NovaHairAIPopup), null, { timeout: 20_000 });
  assert.equal(await page.locator('#PBarNextFrame').count(), 0, 'live smoke test must not use a preview theme');

  return { context, page, popupErrors, cartMutations, assetStatuses, trackingBodies };
}

async function verifyAutomaticTrigger(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const page = await context.newPage();
  const trackingBodies = [];
  await page.route('**/apps/funnels/api/track*', async (route) => {
    try { trackingBodies.push(route.request().postDataJSON()); } catch (_) {}
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"accepted":true}' });
  });
  await page.goto(LIVE_URL + '&auto_trigger=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => Boolean(window.NovaHairPopupEngine && window.NovaHairAIPopup), null, { timeout: 20_000 });
  await page.waitForFunction(() => window.NovaHairPopupConfigState === 'ready', null, { timeout: 15_000 });
  const legacyBefore = await page.evaluate(() => {
    const legacy = document.querySelector('[data-nh-exit-popup]');
    return {
      present: Boolean(legacy),
      hidden: legacy ? legacy.hidden : true,
      initialized: legacy?.dataset.popupReady === 'true',
      bodyLocked: document.body.classList.contains('nh-exit-popup-open'),
      scriptLoaded: Array.from(document.scripts).some((script) =>
        /novahair-exit-popup\.js(?:\?|$)/.test(script.src)),
    };
  });
  assert.equal(legacyBefore.hidden, true, 'legacy static popup must remain hidden');
  assert.equal(legacyBefore.initialized, false, 'legacy static popup must not initialize');
  assert.equal(legacyBefore.bodyLocked, false, 'legacy static popup must not lock the page');
  assert.equal(legacyBefore.scriptLoaded, false, 'legacy static popup script must not load');
  await page.evaluate(() => {
    const maxScroll = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
    scrollTo(0, maxScroll * 0.7);
  });
  for (let i = 0; i < 10; i += 1) {
    await page.mouse.move(120 + i, 140 + (i % 2));
    await page.waitForTimeout(3_200);
  }
  await page.evaluate(() => {
    const maxScroll = Math.max(document.documentElement.scrollHeight - innerHeight, 1);
    scrollTo(0, maxScroll * 0.7);
  });
  await page.waitForFunction(() => {
    const signals = window.NovaHairPopupEngine.getState().signals;
    return signals.engagedTime >= 30 && signals.maxScrollDepth >= 0.5;
  }, null, { timeout: 8_000 });
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true,
      clientY: 0,
      relatedTarget: null,
    }));
  });
  await page.waitForSelector('.nhai[data-open="true"]', { timeout: 8_000 });
  const legacyAfter = await page.evaluate(() => {
    const legacy = document.querySelector('[data-nh-exit-popup]');
    return {
      hidden: legacy ? legacy.hidden : true,
      initialized: legacy?.dataset.popupReady === 'true',
      bodyLocked: document.body.classList.contains('nh-exit-popup-open'),
    };
  });
  assert.equal(legacyAfter.hidden, true, 'AI exit intent must not reveal the legacy popup');
  assert.equal(legacyAfter.initialized, false, 'AI exit intent must not initialize the legacy popup');
  assert.equal(legacyAfter.bodyLocked, false, 'AI exit intent must not apply the legacy body lock');
  const state = await page.evaluate(() => window.NovaHairPopupEngine.getState().signals);
  assert.ok(state.engagedTime >= 30);
  assert.ok(state.maxScrollDepth >= 0.5);
  assert.equal(state.desktopExitIntent, true);
  assert.equal(trackingBodies.filter((body) => body?.event === 'popup_eligible').length, 1,
    'one qualifying decision must create exactly one eligibility event');
  assert.equal(trackingBodies.filter((body) => body?.event === 'popup_view').length, 1,
    'one qualifying decision must create exactly one rendered popup view');
  assert.ok(trackingBodies.some((body) => body?.event === 'popup_signal'),
    'the raw abandonment signal must be measurable');
  const eventKeys = trackingBodies.map((body) => body?.explicitEventKey).filter(Boolean);
  assert.equal(new Set(eventKeys).size, eventKeys.length, 'popup event keys must be unique');
  await context.close();
}

async function verifyCartSuppression(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'he-IL' });
  const page = await context.newPage();
  await page.route('**/apps/funnels/api/track*', (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: '{"accepted":true}',
  }));
  await page.route('**/cart.js', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ item_count: 1, total_price: 23900, items: [] }),
  }));
  await page.goto(LIVE_URL + '&cart_suppression=1', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForFunction(() => Boolean(window.NovaHairPopupEngine), null, { timeout: 20_000 });
  await page.waitForTimeout(750);
  const decision = await page.evaluate(() => {
    const engine = window.NovaHairPopupEngine;
    engine.__setSignal('engagedTime', 60);
    engine.__setSignal('timeOnPage', 60);
    engine.__setSignal('maxScrollDepth', 0.75);
    engine.__setSignal('scrollDepth', 0.1);
    engine.__setSignal('desktopExitIntent', true);
    return engine.evaluate();
  });
  assert.equal(decision.show, false);
  assert.ok(decision.blockedBy.some((reason) => reason.includes('cartHasItems')));
  assert.equal(await page.locator('.nhai[data-open="true"]').count(), 0);
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  activeBrowser = browser;

  const mobile = await loadLivePage(browser, { width: 390, height: 844 });
  const cartBefore = cartSnapshot(await readCart(mobile.page));

  await mobile.page.evaluate(() => window.NovaHairAIPopup.open({ trigger: 'production_smoke' }));
  await mobile.page.waitForSelector('.nhai[data-open="true"]');
  await option(mobile.page, 'אני עדיין בודקת אם זה מתאים לי');
  await option(mobile.page, 'מחכה לתור הבא במספרה');
  await option(mobile.page, 'שלא אדע לבחור גוון נכון');
  await option(mobile.page, 'להמשיך בלי מייל');
  assert.equal(await mobile.page.getByText('בלי לערבב, בלי מברשות.', { exact: false }).count(), 0);

  await option(mobile.page, 'אני מעדיפה לבחור לבד');
  await option(mobile.page, 'חום כהה');
  await mobile.page.locator('.nhai__sw').first().waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await mobile.page.locator('.nhai__sw').count(), 5);
  assert.deepEqual(
    await mobile.page.locator('.nhai__sw > span').evaluateAll((items) => items.map((item) => ({
      color: getComputedStyle(item).backgroundColor,
      image: getComputedStyle(item).backgroundImage,
    }))),
    [
      { color: 'rgb(28, 28, 28)', image: 'none' },
      { color: 'rgb(61, 40, 23)', image: 'none' },
      { color: 'rgb(122, 82, 48)', image: 'none' },
      { color: 'rgb(74, 21, 75)', image: 'none' },
      { color: 'rgb(107, 20, 38)', image: 'none' },
    ],
    'shade swatches must use the five stable sales-page colors',
  );

  const mobileSheet = await mobile.page.locator('.nhai__sheet').boundingBox();
  assert.ok(mobileSheet && mobileSheet.x >= 0 && mobileSheet.x + mobileSheet.width <= 391);
  await mobile.page.screenshot({ path: path.join(__dirname, 'shots', 'qa-live-mobile.png') });

  const cartAfter = cartSnapshot(await readCart(mobile.page));
  assert.deepEqual(cartAfter, cartBefore, 'opening and using the concierge must not change cart lines or totals');
  assert.deepEqual(mobile.cartMutations, [], 'the tested concierge path must not call a cart mutation endpoint');
  assert.deepEqual(mobile.popupErrors, []);
  assert.ok(mobile.trackingBodies.some((body) => body?.event === 'popup_view'));
  assert.ok(mobile.trackingBodies.some((body) => body?.event === 'popup_ai_step'));
  assert.ok(Array.from(mobile.assetStatuses.values()).every((status) => status === 200));
  await mobile.context.close();

  const desktop = await loadLivePage(browser, { width: 1440, height: 900 });
  await desktop.page.evaluate(() => window.NovaHairAIPopup.open({ trigger: 'production_smoke' }));
  await desktop.page.waitForSelector('.nhai[data-open="true"]');
  const desktopSheet = await desktop.page.locator('.nhai__sheet').boundingBox();
  assert.ok(desktopSheet && desktopSheet.x >= 0 && desktopSheet.x + desktopSheet.width <= 1440);
  await desktop.page.screenshot({ path: path.join(__dirname, 'shots', 'qa-live-desktop.png') });
  assert.deepEqual(desktop.popupErrors, []);
  await desktop.context.close();

  await verifyAutomaticTrigger(browser);
  await verifyCartSuppression(browser);

  await browser.close();
  activeBrowser = null;
  console.log(JSON.stringify({
    ok: true,
    liveUrl: LIVE_URL,
    mobileCartUnchanged: true,
    cartMutationRequests: 0,
    shadeImages: 5,
    popupErrors: 0,
    automaticExitTrigger: true,
    legacyPopupInactive: true,
    cartSuppression: true,
  }, null, 2));
}

main().catch(async (error) => {
  if (activeBrowser) {
    try { await activeBrowser.close(); } catch (_) {}
  }
  console.error(error);
  process.exitCode = 1;
});

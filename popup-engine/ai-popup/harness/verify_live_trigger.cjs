const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const LIVE_URL = process.env.NHAI_LIVE_URL
  || 'https://tigerbrandsglobal.com/pages/novahair-sales-staging';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function bootPage(browser, viewport, userAgent) {
  const context = await browser.newContext({
    viewport,
    locale: 'he-IL',
    userAgent,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const url = `${LIVE_URL}?tbg_analytics_mode=qa&nhai_live_trigger_qa=${Date.now()}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(
    () => Boolean(window.NovaHairAIPopup && window.NovaHairPopupEngine),
    null,
    { timeout: 25_000 },
  );
  await page.waitForFunction(
    () => window.NovaHairPopupConfigState === 'ready',
    null,
    { timeout: 15_000 },
  );

  const boot = await page.evaluate(() => ({
    enabled: window.NovaHairPopupConfig?.enabled,
    state: window.NovaHairPopupConfigState,
    placement: window.NovaHairAIOptions?.placement,
    handle: window.NovaHairAIOptions?.page?.handle,
  }));
  assert.deepEqual(boot, {
    enabled: true,
    state: 'ready',
    placement: 'exit_sales',
    handle: 'novahair-sales-staging',
  });
  assert.equal(await page.locator('.nhai[data-open="true"]').count(), 0, 'popup must not open immediately');

  return { context, page, errors };
}

async function buildRealEngagement(page) {
  const selectors = [
    '#before-after',
    '#mechanism',
    '#formula',
    '#how-to-use',
    '#social-proof',
    '#comparison',
    '#offer-reentry',
    '#guarantee',
    '#faq',
    '#reviews-full',
    '#offer-reentry',
  ];

  for (const selector of selectors) {
    const target = page.locator(selector);
    if (await target.count()) await target.scrollIntoViewIfNeeded();
    await page.mouse.move(100, 200);
    await pause(3_000);
  }
}

async function assertPopup(page, errors, label) {
  const popup = page.locator('.nhai[data-open="true"]');
  await popup.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.nhai__msg--ai', {
    hasText: 'היי, אני נעמה מ־NovaHair.\nמה יעזור לך עכשיו?',
  }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'אני עדיין בודקת אם זה מתאים לי' }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'כבר קניתי אצלכם' }).waitFor({ state: 'visible' });

  const box = await page.locator('.nhai__sheet').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box && viewport, `${label}: popup must have a visible box`);
  assert.ok(box.x >= -1 && box.y >= -1, `${label}: popup starts outside viewport`);
  assert.ok(box.x + box.width <= viewport.width + 1, `${label}: popup overflows horizontally`);
  assert.ok(box.y + box.height <= viewport.height + 1, `${label}: popup overflows vertically`);
  assert.deepEqual(errors, [], `${label}: page errors: ${errors.join(' | ')}`);

  return {
    label,
    viewport,
    box: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    },
  };
}

async function verifyMobile(browser) {
  const { context, page, errors } = await bootPage(
    browser,
    { width: 390, height: 844 },
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0.0.0',
  );
  try {
    await buildRealEngagement(page);
    await page.locator('#buy').scrollIntoViewIfNeeded();
    return await assertPopup(page, errors, 'instagram-ios-return-to-top');
  } finally {
    await context.close();
  }
}

async function verifyDesktop(browser) {
  const { context, page, errors } = await bootPage(
    browser,
    { width: 1440, height: 900 },
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  );
  try {
    await buildRealEngagement(page);
    await page.mouse.move(720, 1);
    await page.mouse.move(720, -20);
    return await assertPopup(page, errors, 'desktop-exit-intent');
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  try {
    const results = [];
    results.push(await verifyMobile(browser));
    results.push(await verifyDesktop(browser));
    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

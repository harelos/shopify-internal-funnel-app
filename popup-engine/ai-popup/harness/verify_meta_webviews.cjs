const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const pageUrl = process.env.NHAI_META_URL || pathToFileURL(path.join(__dirname, 'index.html')).href;
const remoteTarget = /^https?:/i.test(pageUrl);

const profiles = [
  {
    name: 'instagram-ios',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 395.0.0.40.80 (iPhone17,2; iOS 18_6; en_US; en; scale=3.00; 1290x2796)'
  },
  {
    name: 'facebook-ios',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/525.0.0.45.107;FBDV/iPhone16,1;FBMD/iPhone;FBSN/iOS;FBSV/18.6;FBSS/3]'
  },
  {
    name: 'instagram-android',
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A.250805.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 Instagram 395.0.0.42.106 Android'
  },
  {
    name: 'facebook-android',
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro Build/AP3A.250805.005) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/525.0.0.45.79]'
  }
];

async function measure(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.nhai');
    const sheet = document.querySelector('.nhai__sheet');
    const close = document.querySelector('.nhai__x');
    const footer = document.querySelector('.nhai__foot');
    const input = document.querySelector('.nhai__free input');
    const viewport = window.visualViewport;
    const visibleTop = viewport ? viewport.offsetTop : 0;
    const visibleWidth = viewport ? viewport.width : window.innerWidth;
    const visibleHeight = viewport ? viewport.height : window.innerHeight;
    const visibleBottom = visibleTop + visibleHeight;
    const rootRect = root.getBoundingClientRect();
    const sheetRect = sheet.getBoundingClientRect();
    const closeRect = close.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();

    return {
      visibleTop,
      visibleBottom,
      visibleWidth,
      visibleHeight,
      rootTop: rootRect.top,
      rootBottom: rootRect.bottom,
      rootHeight: rootRect.height,
      sheetTop: sheetRect.top,
      sheetBottom: sheetRect.bottom,
      sheetWidth: sheetRect.width,
      closeTop: closeRect.top,
      closeRight: closeRect.right,
      closeWidth: closeRect.width,
      closeHeight: closeRect.height,
      footerTop: footerRect.top,
      footerBottom: footerRect.bottom,
      inputFontSize: parseFloat(getComputedStyle(input).fontSize),
      documentWidth: document.documentElement.scrollWidth,
      bodyOverflow: document.body.style.overflow,
      cssViewportHeight: parseFloat(getComputedStyle(root).getPropertyValue('--nhai-viewport-height'))
    };
  });
}

function assertVisible(profile, state, phase) {
  const label = `${profile.name} ${phase}`;
  assert.ok(Math.abs(state.rootTop - state.visibleTop) <= 2, `${label}: overlay top escaped visual viewport`);
  assert.ok(Math.abs(state.rootHeight - state.visibleHeight) <= 2, `${label}: overlay height did not follow visual viewport`);
  assert.ok(state.sheetTop >= state.visibleTop - 1, `${label}: sheet top clipped`);
  assert.ok(state.sheetBottom <= state.visibleBottom + 1, `${label}: sheet bottom clipped`);
  assert.ok(state.footerTop >= state.visibleTop, `${label}: controls clipped above viewport`);
  assert.ok(state.footerBottom <= state.visibleBottom + 1, `${label}: controls hidden below viewport`);
  assert.ok(state.closeTop >= state.visibleTop, `${label}: close button clipped`);
  assert.ok(state.closeRight <= state.visibleWidth + 1, `${label}: close button clipped horizontally`);
  assert.ok(state.closeWidth >= 44 && state.closeHeight >= 44, `${label}: close target is below 44px`);
  assert.ok(state.inputFontSize >= 16, `${label}: input can trigger iOS auto-zoom`);
  assert.ok(state.documentWidth <= state.visibleWidth + 1, `${label}: horizontal overflow`);
  assert.equal(state.bodyOverflow, 'hidden', `${label}: page scroll was not locked`);
  assert.ok(Math.abs(state.cssViewportHeight - state.visibleHeight) <= 2, `${label}: visual viewport CSS variable is stale`);
}

async function runProfile(browser, profile) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    userAgent: profile.userAgent,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    locale: 'he-IL'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (remoteTarget) {
    await page.route('**/apps/funnels/api/track*', route => route.fulfill({
      status: 204,
      headers: { 'access-control-allow-origin': '*' },
      body: ''
    }));
  }

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (remoteTarget) {
    await page.evaluate(() => {
      document.querySelector('#PBarNextFrameWrapper')?.remove();
      document.querySelector('#PBarNextFrame')?.remove();
    });
  }
  const originalBodyOverflow = await page.evaluate(() => document.body.style.overflow);
  await page.waitForFunction(() => Boolean(window.NovaHairAIPopup), null, { timeout: 20_000 });
  await page.evaluate(() => window.NovaHairAIPopup.open({ trigger: 'meta_webview_qa' }));
  await page.waitForSelector('.nhai[data-open="true"]');
  await page.locator('.nhai__opt', { hasText: 'אני עדיין בודקת אם זה מתאים לי' }).click();
  await page.locator('.nhai__opt', { hasText: 'רק מתחילה לברר' }).click();
  await page.locator('.nhai__free input[type="text"]').waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await page.locator('.nhai__name').innerText(), 'נעמה לוי');
  assert.equal(await page.locator('.nhai__sub').innerText(), 'מומחית צביעת השיער של NovaHair');
  assertVisible(profile, await measure(page), 'initial');

  const compactHeight = Math.max(480, profile.viewport.height - 290);
  await page.locator('.nhai__free input[type="text"]').focus();
  await page.setViewportSize({ width: profile.viewport.width, height: compactHeight });
  await page.waitForTimeout(120);
  assertVisible(profile, await measure(page), 'compact');

  await page.screenshot({
    path: path.join(__dirname, 'shots', `qa-${profile.name}.png`),
    fullPage: false
  });

  await page.locator('.nhai__x').click();
  assert.equal(await page.locator('.nhai').getAttribute('data-open'), 'false', `${profile.name}: close failed`);
  assert.equal(
    await page.evaluate(() => document.body.style.overflow),
    originalBodyOverflow,
    `${profile.name}: body scroll was not restored`
  );
  const relevantErrors = errors.filter(message => !(
    remoteTarget && /showPopover.*disconnected popover/i.test(message)
  ));
  assert.deepEqual(relevantErrors, [], `${profile.name}: runtime errors`);
  await context.close();
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  try {
    for (const profile of profiles) await runProfile(browser, profile);
  } finally {
    await browser.close();
  }
  console.log(`PASS: ${profiles.length} Instagram/Facebook WebView profiles target=${pageUrl}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

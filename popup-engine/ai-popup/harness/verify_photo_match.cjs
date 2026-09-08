const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const pageUrl = process.env.NHAI_TARGET_URL ||
  pathToFileURL(path.join(__dirname, 'index.html')).href;

async function clickOption(page, label) {
  const button = page.locator('.nhai__opt', { hasText: label }).first();
  await button.waitFor({ state: 'visible', timeout: 12_000 });
  await button.click();
}

async function recommend(page, imagePath) {
  await page.goto(pageUrl);
  await page.waitForFunction(() => Boolean(window.NovaHairAIPopup));
  await page.evaluate(() => window.NovaHairAIPopup.open({ trigger: 'shade_regression' }));
  await clickOption(page, 'אני עדיין בודקת אם זה מתאים לי');
  await clickOption(page, 'רק מתחילה לברר');
  await clickOption(page, 'שלא אדע לבחור גוון נכון');
  await clickOption(page, 'להמשיך בלי מייל');

  const input = page.locator('.nhai__photo input[type="file"]');
  await input.waitFor({ state: 'attached', timeout: 12_000 });
  await input.setInputFiles(imagePath);
  await page.waitForFunction(() => {
    return Boolean(document.querySelector('.nhai__swatches')) ||
      Array.from(document.querySelectorAll('.nhai__opt')).some(option =>
        option.textContent.includes('אני לא בטוחה'));
  }, null, { timeout: 12_000 });

  if (process.env.NHAI_SCREENSHOT) {
    await fs.promises.mkdir(path.dirname(process.env.NHAI_SCREENSHOT), { recursive: true });
    await page.screenshot({ path: process.env.NHAI_SCREENSHOT, fullPage: false });
  }

  const context = await page.evaluate(() => window.NovaHairAIPopup.getContext());
  return context.shadeKey || 'manual';
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    const cartLineMutations = [];
    const shadeResponses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (new URL(response.url()).pathname.endsWith('/apps/funnels/api/ai-shade')) {
        shadeResponses.push(response.status());
      }
    });
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (/\/cart\/(?:add|change|clear)\.js$/.test(pathname)) {
        cartLineMutations.push(`${request.method()} ${pathname}`);
      }
    });

    const shadeDir = path.resolve(__dirname, '..', 'assets', 'img');
    const fixtures = process.env.NHAI_PORTRAIT_ONLY === '1' ? [] : [
      ['black', path.join(shadeDir, 'shade-black.png')],
      ['dark_brown', path.join(shadeDir, 'shade-dark_brown.png')],
      ['light_brown', path.join(shadeDir, 'shade-light_brown.png')],
      ['eggplant', path.join(shadeDir, 'shade-eggplant.png')],
      ['wine_red', path.join(shadeDir, 'shade-wine_red.png')],
    ];

    const portrait = process.argv[2];
    if (portrait) {
      assert.equal(fs.existsSync(portrait), true, `portrait fixture missing: ${portrait}`);
      fixtures.push([process.argv[3] || 'dark_brown', path.resolve(portrait)]);
    }

    for (const [expected, fixture] of fixtures) {
      const actual = await recommend(page, fixture);
      assert.equal(actual, expected, `${path.basename(fixture)} matched ${actual}, expected ${expected}`);
      console.log(`PASS ${path.basename(fixture)} -> ${actual}`);
    }

    assert.deepEqual(errors, []);
    assert.deepEqual(cartLineMutations, [], 'shade matching must not mutate cart lines');
    if (process.env.NHAI_REQUIRE_VISION === '1') {
      assert.ok(shadeResponses.includes(200), `vision endpoint did not return 200: ${shadeResponses.join(',')}`);
      console.log(`PASS: live vision endpoint ${shadeResponses.join(',')}`);
    }
    console.log('PASS: photo shade regression QA');
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

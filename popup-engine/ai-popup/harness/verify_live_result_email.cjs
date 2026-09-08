const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

function loadEnv(file) {
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

async function shopEmail(env) {
  const response = await fetch(`https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query: '{ shop { email } }' }),
  });
  assert.equal(response.status, 200, `Shopify shop query returned ${response.status}`);
  const json = await response.json();
  assert.equal(json.errors, undefined, JSON.stringify(json.errors));
  return json.data.shop.email;
}

async function option(page, label) {
  const button = page.locator('.nhai__opt', { hasText: label }).first();
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click();
}

async function main() {
  const env = loadEnv(path.join(__dirname, '..', '..', '..', 'app', '.env'));
  const recipient = await shopEmail(env);
  assert.match(recipient, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL' });
    const page = await context.newPage();
    const resultResponses = [];
    const cartMutations = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/cart\/(?:add|change|clear)\.js(?:\?|$)/.test(request.url())) cartMutations.push(request.url());
    });
    page.on('response', async response => {
      if (/\/apps\/funnels\/api\/popup\/customer\/(?:capture|result-email)(?:\?|$)/.test(response.url())) {
        resultResponses.push({ url: response.url(), status: response.status(), body: await response.json().catch(() => ({})) });
      }
    });

    const stamp = Date.now();
    await page.goto(`https://tigerbrandsglobal.com/pages/novahair-sales-staging?utm_source=codex_qa&utm_medium=production_test&utm_campaign=concierge_email_release_${stamp}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await page.waitForFunction(() => Boolean(window.NovaHairAIPopup), null, { timeout: 25_000 });
    await page.evaluate(() => window.NovaHairAIPopup.open({ trigger: 'production_email_qa' }));
    await page.waitForSelector('.nhai[data-open="true"]', { timeout: 10_000 });
    await option(page, 'אני עדיין בודקת אם זה מתאים לי');
    await option(page, 'מחכה לתור הבא במספרה');
    await option(page, 'כמה זה עולה לי בסוף');

    const email = page.locator('.nhai__free input[type="email"]');
    await email.waitFor({ state: 'visible', timeout: 15_000 });
    await email.fill(recipient);
    assert.equal(await page.locator('.nhai__consent input[type="checkbox"]').isChecked(), false);
    const captureResponsePromise = page.waitForResponse(response => /\/apps\/funnels\/api\/popup\/customer\/capture(?:\?|$)/.test(response.url()), { timeout: 25_000 });
    const resultResponsePromise = page.waitForResponse(response => /\/apps\/funnels\/api\/popup\/customer\/result-email(?:\?|$)/.test(response.url()), { timeout: 30_000 });
    await page.getByRole('button', { name: 'שלחי לי', exact: true }).click();
    const captureResponse = await captureResponsePromise;
    await page.getByText('מארז 4 הבקבוקים', { exact: false }).first().waitFor({ state: 'visible', timeout: 20_000 });
    const resultResponse = await resultResponsePromise;

    const capture = { status: captureResponse.status(), body: await captureResponse.json().catch(() => ({})) };
    const emailResult = { status: resultResponse.status(), body: await resultResponse.json().catch(() => ({})) };
    assert.equal(capture?.status, 200, JSON.stringify(capture));
    assert.ok(capture?.body?.customerToken, 'capture must return a signed customer token');
    assert.equal(emailResult?.status, 200, JSON.stringify(emailResult));
    assert.equal(emailResult?.body?.sent, true, JSON.stringify(emailResult?.body));
    await page.waitForFunction(() => window.NovaHairAIPopup.getContext().resultEmailSent === true, null, { timeout: 5_000 });
    assert.deepEqual(cartMutations, [], 'email flow must not add, remove, or duplicate cart lines');
    assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);

    console.log(JSON.stringify({
      ok: true,
      recipient: recipient.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
      customerSaved: true,
      marketingCheckboxUnchecked: true,
      resultEmailSent: true,
      cartMutationRequests: 0,
    }, null, 2));
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

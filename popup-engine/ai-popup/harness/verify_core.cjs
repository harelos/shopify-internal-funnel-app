const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const pageUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;

async function waitForPopup(page) {
  await page.waitForFunction(() => Boolean(window.NovaHairAIPopup));
  await page.evaluate(() => window.NovaHairAIPopup.open({ trigger: 'qa' }));
  await page.waitForSelector('.nhai[data-open="true"]');
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

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__posthogCaptures = [];
    window.posthog = {
      capture: function (event, properties) { window.__posthogCaptures.push({ event, properties }); }
    };
  });

  await page.goto(pageUrl + '?utm_source=instagram&utm_medium=paid_social&utm_campaign=qa_roots');
  const serializedFlow = await page.evaluate(() => JSON.stringify(window.NovaHairAIFlows));
  assert.doesNotMatch(serializedFlow, /7[ _-]?(?:reasons?|reasons_page)|7 הסיבות|שבע הסיבות|to_7r|read_7r/i);
  assert.doesNotMatch(serializedFlow, /קחי אותי ל(?:מוצר|מארז)/);
  assert.deepEqual(
    await page.evaluate(() => {
      const nodes = window.NovaHairAIFlows.nodes;
      const targets = [];
      Object.values(nodes).forEach(node => {
        (node.options || []).forEach(item => targets.push(item.next));
        if (node.next) targets.push(node.next);
        if (node.skipNext) targets.push(node.skipNext);
      });
      return targets.filter(target => !nodes[target]);
    }),
    [],
  );
  assert.equal(
    await page.evaluate(() => window.NovaHairAIFlows.nodes.proof_roots.messages[0]),
    'שמפו הצבע שלנו בנוי לצביעת שורשים בבית, לתקופה שבין הצבע המלא לתור הבא.',
  );
  assert.equal(await page.evaluate(() => 'card' in window.NovaHairAIFlows.nodes.proof_roots), false);
  assert.deepEqual(
    await page.evaluate(() => {
      const option = window.NovaHairAIFlows.nodes.price_compare.options
        .find(item => item.id === 'show_bundle');
      return { label: option.label, next: option.next, tag: option.tag };
    }),
    {
      label: 'כן, נשמע טוב, אני רוצה',
      next: 'price_bundle_confirmed',
      tag: 'bundle_cta',
    },
  );
  assert.deepEqual(
    await page.evaluate(() => {
      const option = window.NovaHairAIFlows.nodes.price_compare.options
        .find(item => item.id === 'why_switch');
      return { label: option.label, next: option.next, tag: option.tag };
    }),
    {
      label: 'למה נשים עוברות לזה',
      next: 'why_switch',
      tag: 'wants_reason',
    },
  );
  await waitForPopup(page);
  assert.equal(await page.locator('.nhai').getAttribute('role'), 'dialog');
  assert.equal(await page.locator('.nhai__name').innerText(), 'נעמה לוי');
  assert.equal(await page.locator('.nhai__sub').innerText(), 'מומחית צביעת השיער של NovaHair');
  const expectedOpener = 'היי, אני נעמה מ־NovaHair.\nמה יעזור לך עכשיו?';
  await page.waitForFunction(expected => Array.from(document.querySelectorAll('.nhai__msg--ai'))
    .some(message => message.textContent === expected), expectedOpener);
  assert.equal(
    await page.locator('.nhai__msg--ai', { hasText: expectedOpener }).first().innerText(),
    expectedOpener,
  );
  const prospectOption = page.locator('.nhai__opt', { hasText: 'אני עדיין בודקת אם זה מתאים לי' });
  await prospectOption.waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await prospectOption.count(), 1);
  assert.equal(await page.locator('.nhai__opt', { hasText: 'כבר קניתי אצלכם' }).count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('.nhai').contains(document.activeElement)), true);

  await option(page, 'אני עדיין בודקת אם זה מתאים לי');
  await option(page, 'מחכה לתור');
  await page.evaluate(() => { window.__mockAI = { reply: 'נשמע שהחשש העיקרי שלך הוא לבחור גוון שישתלב טבעי.', next: '' }; });
  await freeText(page, 'אני לא בטוחה איזה גוון מתאים');
  await page.waitForFunction(() => (window.__aiRequests || []).length > 0);
  const aiRequest = await page.evaluate(() => window.__aiRequests.at(-1));
  assert.equal('goal' in aiRequest, false);
  assert.equal('style' in aiRequest, false);
  assert.equal(aiRequest.agent, 'sales');
  assert.equal(aiRequest.placement, 'exit_sales');
  assert.equal(aiRequest.mode, 'email_bridge');
  await page.locator('input[type="email"]').waitFor({ state: 'visible', timeout: 12_000 });

  await page.screenshot({ path: path.join(__dirname, 'shots', 'qa-mobile-safe.png') });

  await page.reload();
  await waitForPopup(page);
  await option(page, 'אני עדיין בודקת אם זה מתאים לי');
  await option(page, 'מחכה לתור');
  await option(page, 'השורשים חוזרים');
  await option(page, 'להמשיך בלי מייל');
  await option(page, 'זה בדיוק זה');
  await option(page, 'לחסוך את העלות החוזרת');
  await option(page, 'כן, תראי לי');
  await option(page, 'למה נשים עוברות לזה');
  await page.locator('.nhai__msg--ai', { hasText: 'בעיקר בגלל השליטה' })
    .waitFor({ state: 'visible', timeout: 12_000 });
  await page.locator('.nhai__msg--ai', { hasText: 'כ־₪1.99 לטיפול שורשים' })
    .waitFor({ state: 'visible', timeout: 12_000 });
  assert.equal(await page.locator('.nhai__card', { hasText: 'שלושה שלבים' }).count(), 0);
  assert.deepEqual(
    await page.locator('.nhai__foot .nhai__opt').allInnerTexts(),
    [
      'כן, זה בדיוק מה שאני מחפשת',
      'עזרי לי לבחור גוון',
      'איך משתמשים בדיוק',
      'יש לי עוד שאלה',
    ],
  );
  await option(page, 'כן, זה בדיוק מה שאני מחפשת');
  await page.locator('.nhai__msg--ai', { hasText: 'את חוסכת ₪519 (68%)' })
    .waitFor({ state: 'visible', timeout: 12_000 });
  await option(page, 'לבחירת הגוון ולהזמנה');
  await page.waitForFunction(() => Boolean(window.__lastRedirect));
  assert.equal(await page.evaluate(() => window.__lastRedirect), '#buy');

  await page.reload();
  await waitForPopup(page);
  await option(page, 'אני עדיין בודקת אם זה מתאים לי');
  await option(page, 'מחכה לתור');
  await option(page, 'כמה זה עולה');
  await page.locator('input[type="email"]').fill('noa@example.com');
  await page.locator('button[type="submit"]').click();
  const costAnswer = page.locator('.nhai__msg--ai', { hasText: 'חיסכון של ₪519 (68%)' });
  await costAnswer.waitFor({ state: 'visible', timeout: 12_000 });
  const bundleCard = await page.locator('.nhai__card').last().innerText();
  assert.match(bundleCard, /₪519/);
  assert.match(bundleCard, /68%/);
  assert.match(bundleCard, /מתנה · שווי ₪79/);
  await page.waitForFunction(() => (window.__resultEmails || []).length === 1);
  const resultEmail = await page.evaluate(() => window.__resultEmails[0]);
  assert.equal(resultEmail.mainConcern, 'price');
  assert.equal(resultEmail.recommendedBundle, 'מארז 4 בקבוקים');
  assert.equal(resultEmail.kind, 'summary');
  await option(page, 'עוד לא');
  await option(page, 'כן, אשמח לקוד');
  await page.waitForSelector('.nhai__coupon-code', { timeout: 12_000 });
  assert.equal(await page.locator('.nhai__coupon-code').innerText(), 'NOVA10');

  const lead = await page.evaluate(() => (window.__customerCaptures || []).at(-1));
  assert.equal(lead.email, 'noa@example.com');
  assert.equal(lead.intent, 'prospect');
  assert.equal(lead.mainConcern, 'price');
  assert.equal(lead.marketingConsent, false);

  await page.evaluate(async () => {
    window.__queueKeys = [];
    window.novaFunnelEnqueueCartMutation = function (key, job) {
      window.__queueKeys.push(key);
      return Promise.resolve().then(job);
    };
    await window.NovaHairAttribution.writeCartAttributes({ conversationId: 'qa', agent: 'sales', lead: true });
  });
  const queueKeys = await page.evaluate(() => window.__queueKeys);
  assert.equal(queueKeys.length, 1);
  assert.match(queueKeys[0], /^ai-attribution:/);
  const cartAttribution = await page.evaluate(() => window.__cartWrites.at(-1));
  assert.equal(cartAttribution._nh_popup, '1');
  assert.equal(cartAttribution._nh_conversation_id, 'qa');
  assert.equal(cartAttribution._nh_utm_source, 'instagram');
  assert.equal(cartAttribution._nh_utm_medium, 'paid_social');
  assert.equal(cartAttribution._nh_utm_campaign, 'qa_roots');

  const posthogCaptures = await page.evaluate(() => window.__posthogCaptures);
  assert.ok(posthogCaptures.some(item => item.event === 'popup_ai_step'));
  const eventIds = posthogCaptures.map(item => item.properties.event_id);
  assert.equal(new Set(eventIds).size, eventIds.length, 'every PostHog mirror event id must be unique');
  posthogCaptures.forEach(item => {
    assert.equal(item.properties.event_id, item.properties.$insert_id);
    assert.equal(item.properties.source, 'novahair_ai_concierge');
    assert.equal(item.properties.utm_source, 'instagram');
    assert.equal(item.properties.utm_medium, 'paid_social');
    assert.equal(item.properties.utm_campaign, 'qa_roots');
    assert.equal('freeText' in item.properties, false);
    assert.equal('email' in item.properties, false);
    assert.equal('customerKey' in item.properties, false);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(__dirname, 'shots', 'qa-desktop-safe.png'), fullPage: true });
  assert.deepEqual(errors, []);

  await browser.close();
  console.log('PASS: AI popup core browser QA');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

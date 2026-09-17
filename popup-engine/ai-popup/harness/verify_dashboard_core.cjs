const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const dashboardPath = path.join(__dirname, '..', 'admin', 'dashboard.html');

const stepsFixture = {
  days: 14,
  conversations: 42,
  steps: [
    {
      stepId: 'root_choice',
      stepType: 'ask',
      shown: 100,
      answered: 80,
      exits: 5,
      dropOffRate: 20,
      avgDwellSeconds: 4.2,
      choices: [{ label: 'הגוון', count: 50 }],
      freeTexts: ['<img src=x onerror=window.__XSS=1>', 'רגיל'],
    },
    {
      stepId: 'shade_photo',
      stepType: 'photo',
      shown: 60,
      answered: 20,
      exits: 10,
      dropOffRate: 66.7,
      avgDwellSeconds: 9.1,
      choices: [{ label: 'דילוג', count: 20 }],
      freeTexts: [],
    },
  ],
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/' || req.url === '/dashboard.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        fs.createReadStream(dashboardPath).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/dashboard.html` });
    });
  });
}

async function main() {
  const { server, url } = await startServer();
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    const authHeaders = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.shopify = { idToken: () => Promise.resolve('qa-session-token') };
    });
    await page.route('https://cdn.shopify.com/shopifycloud/app-bridge.js', route => {
      route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    });
    await page.route('**/api/ai-steps*', route => {
      authHeaders.push(route.request().headers().authorization || '');
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stepsFixture) });
    });
    await page.route('**/api/ai-models', route => {
      authHeaders.push(route.request().headers().authorization || '');
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          mode: 'fallback_ladder',
          deadlineMs: 8000,
          models: ['z-ai/glm-5.3-flash', 'minimax/minimax-m2.7:free'],
        }),
      });
    });

    await page.goto(url);
    assert.equal(await page.locator('.tab-btn').count(), 3);
    assert.equal(await page.locator('input[type="number"]').count(), 13);
    assert.notEqual(await page.locator('input[type="number"]').first().inputValue(), '');

    await page.getByRole('button', { name: 'שלבי שיחה', exact: true }).click();
    await page.locator('#steps-list h3', { hasText: 'shade_photo' }).waitFor();
    assert.match(await page.locator('body').innerText(), /42/);
    assert.match(await page.locator('body').innerText(), /66\.7%/);
    assert.equal(authHeaders[0], 'Bearer qa-session-token');
    assert.equal(await page.evaluate(() => window.__XSS === 1), false);
    assert.equal(await page.locator("img[src='x']").count(), 0);
    await page.locator('details').first().evaluate(element => { element.open = true; });
    assert.match(await page.locator('details').first().innerText(), /onerror=window\.__XSS/);

    await page.getByRole('button', { name: 'מודלים', exact: true }).click();
    await page.locator('#models-list li').first().waitFor();
    const modelText = await page.locator('#panel-models').innerText();
    assert.match(modelText, /glm-5\.3-flash/);
    assert.match(modelText, /minimax-m2\.7/);
    assert.equal(authHeaders.at(-1), 'Bearer qa-session-token');
    assert.doesNotMatch(await page.content(), /\/api\/model-split/);
    assert.deepEqual(errors, []);

    await page.screenshot({
      path: path.join(__dirname, 'shots', 'qa-dashboard-safe.png'),
      fullPage: true,
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log('PASS: AI dashboard browser QA');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

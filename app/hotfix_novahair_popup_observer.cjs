const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const STORE = 'jacobfelipe.myshopify.com';
const API_VERSION = '2024-10';
const PAGE_ID = 162313240871;
const EXPECTED_HANDLE = 'novahair-sales-staging';

const OLD_FUNCTION = 'function s(){var r=document.querySelector("[data-nh-exit-popup]");if(!r)return;try{if(localStorage.getItem(q)||sessionStorage.getItem(c)){r.hidden=true;document.body.classList.remove("nh-exit-popup-open");}}catch(_){}}';
const NEW_FUNCTION = 'function s(){var r=document.querySelector("[data-nh-exit-popup]");if(!r)return;try{if(localStorage.getItem(q)||sessionStorage.getItem(c)){if(!r.hidden)r.hidden=true;if(document.body&&document.body.classList.contains("nh-exit-popup-open"))document.body.classList.remove("nh-exit-popup-open");}}catch(_){}}';
const OLD_OBSERVER = 'if(window.MutationObserver)new MutationObserver(s).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden"]});';
const NEW_OBSERVER = 'document.addEventListener("shopify:section:load",s);';

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function patchBody(body) {
  const functionCount = occurrences(body, OLD_FUNCTION);
  const observerCount = occurrences(body, OLD_OBSERVER);

  if (functionCount === 0 && observerCount === 0 && body.includes(NEW_FUNCTION) && body.includes(NEW_OBSERVER)) {
    return { body, changed: false };
  }

  if (functionCount !== 1 || observerCount !== 1) {
    throw new Error(`Expected one popup function and one risky observer, found ${functionCount} and ${observerCount}.`);
  }

  return {
    body: body.replace(OLD_FUNCTION, NEW_FUNCTION).replace(OLD_OBSERVER, NEW_OBSERVER),
    changed: true
  };
}

function readEnvFile(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function shopifyRequest(token, method, endpoint, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const request = https.request({
      hostname: STORE,
      path: `/admin/api/${API_VERSION}${endpoint}`,
      method,
      headers: {
        'X-Shopify-Access-Token': token,
        Accept: 'application/json',
        ...(body ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body)
        } : {})
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Shopify returned HTTP ${response.statusCode}.`));
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`Shopify returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function storefrontRequest() {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: 'tigerbrandsglobal.com',
      path: `/pages/${EXPECTED_HANDLE}?hotfix_check=${Date.now()}`,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36'
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', reject);
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = readEnvFile(path.join(__dirname, '.env'));
  const token = env.SHOPIFY_ACCESS_TOKEN;
  if (!token) throw new Error('SHOPIFY_ACCESS_TOKEN is missing from app/.env.');

  const endpoint = `/pages/${PAGE_ID}.json`;
  const current = (await shopifyRequest(token, 'GET', endpoint)).page;
  if (!current || String(current.id) !== String(PAGE_ID) || current.handle !== EXPECTED_HANDLE) {
    throw new Error(`Refusing to update unexpected page ${current?.id || 'unknown'} (${current?.handle || 'unknown'}).`);
  }

  const originalBody = String(current.body_html || '');
  const patched = patchBody(originalBody);
  console.log(`Target: ${current.handle} (${current.id})`);
  console.log(`Current SHA-256: ${sha256(originalBody)}`);
  console.log(`Patch required: ${patched.changed ? 'YES' : 'NO'}`);

  if (!apply || !patched.changed) {
    console.log(apply ? 'The hotfix is already present.' : 'Dry run only. Re-run with --apply to update Shopify.');
    return;
  }

  const backupDirectory = path.join(__dirname, 'backups_live_hotfix');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `${EXPECTED_HANDLE}-${PAGE_ID}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    page: current,
    captured_at: new Date().toISOString(),
    body_sha256: sha256(originalBody)
  }, null, 2), 'utf8');

  await shopifyRequest(token, 'PUT', endpoint, {
    page: { id: PAGE_ID, body_html: patched.body }
  });

  const verified = (await shopifyRequest(token, 'GET', endpoint)).page;
  const verifiedBody = String(verified.body_html || '');
  if (verified.handle !== EXPECTED_HANDLE || verifiedBody !== patched.body) {
    throw new Error('Post-update Shopify verification did not match the intended body exactly.');
  }
  if (verifiedBody.includes(OLD_OBSERVER) || !verifiedBody.includes(NEW_OBSERVER)) {
    throw new Error('Post-update verification found an unexpected popup observer state.');
  }

  const storefront = await storefrontRequest();
  if (storefront.status !== 200 || storefront.body.includes(OLD_OBSERVER) || !storefront.body.includes(NEW_OBSERVER)) {
    throw new Error(`Storefront verification failed with HTTP ${storefront.status}.`);
  }

  console.log(`Backup: ${backupPath}`);
  console.log(`Verified SHA-256: ${sha256(verifiedBody)}`);
  console.log(`Storefront HTTP: ${storefront.status}`);
  console.log('Risky popup MutationObserver removed from the live rendered page.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { OLD_FUNCTION, NEW_FUNCTION, OLD_OBSERVER, NEW_OBSERVER, patchBody };

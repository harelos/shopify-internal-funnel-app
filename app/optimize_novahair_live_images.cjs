const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const STORE = 'jacobfelipe.myshopify.com';
const STOREFRONT = 'tigerbrandsglobal.com';
const API_VERSION = '2024-10';
const PAGE_ID = 162313240871;
const EXPECTED_HANDLE = 'novahair-sales-staging';

const FONT_IMPORT = "@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700;800;900&display=swap');";
const FONT_REPLACEMENT = '/* Open Sans is loaded once by the dedicated NovaHair layout. */';

const IMAGE_TARGETS = [
  {
    name: 'topbar shipping icon',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/icon_8.png?v=1787159191',
    classToken: 'topbar-icon-img',
    width: 40
  },
  {
    name: 'topbar guarantee icon',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/icon_9.png?v=1787159195',
    classToken: 'topbar-icon-img',
    width: 40
  },
  {
    name: 'hero image',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-pdp-gallery-1.png?v=1786836267',
    id: 'galMain',
    width: 1000,
    srcsetWidths: [480, 800, 1000],
    sizes: '(min-width:990px) 48vw, calc(100vw - 32px)'
  },
  {
    name: 'gallery thumbnail 1',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-pdp-gallery-1.png?v=1786836267',
    classToken: 'thumb',
    width: 120,
    height: 120,
    fullWidth: 1000
  },
  {
    name: 'gallery thumbnail 2',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-pdp-gallery-2.png?v=1786836270',
    classToken: 'thumb',
    width: 120,
    height: 120,
    fullWidth: 1000
  },
  {
    name: 'gallery thumbnail 3',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-pdp-gallery-3.png?v=1786836273',
    classToken: 'thumb',
    width: 120,
    height: 120,
    fullWidth: 1000
  },
  {
    name: 'gallery thumbnail 4',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/c5c5abd1-264a-4b54-ad1e-b30dc95b6076.webp?v=1786913190',
    classToken: 'thumb',
    width: 120,
    height: 120,
    fullWidth: 1000
  },
  {
    name: 'gallery thumbnail 5',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-pdp-gallery-5.png?v=1786836279',
    classToken: 'thumb',
    width: 120,
    height: 120,
    fullWidth: 1000
  },
  {
    name: 'gallery thumbnail 6',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-pdp-gallery-6.png?v=1786836282',
    classToken: 'thumb',
    width: 120,
    height: 120,
    fullWidth: 1000
  },
  {
    name: 'two-bottle bundle thumbnail',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/batch4_2.png?v=1787166132',
    classToken: 'bundle-card__thumb',
    width: 120,
    height: 120
  },
  {
    name: 'four-bottle bundle thumbnail',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/batch4_1.png?v=1787166128',
    classToken: 'bundle-card__thumb',
    width: 120,
    height: 120
  },
  {
    name: 'six-bottle bundle thumbnail',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/batch4_3.png?v=1787166137',
    classToken: 'bundle-card__thumb',
    width: 120,
    height: 120
  },
  {
    name: 'proof icon time',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/icon_5.png?v=1787159178',
    classToken: 'proof-icon-img',
    width: 200,
    height: 200
  },
  {
    name: 'proof icon shades',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/icon_6.png?v=1787159183',
    classToken: 'proof-icon-img',
    width: 200,
    height: 200
  },
  {
    name: 'proof icon treatments',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/icon_7.png?v=1787159187',
    classToken: 'proof-icon-img',
    width: 200,
    height: 200
  },
  {
    name: 'proof icon guarantee',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/icon_9.png?v=1787159195',
    classToken: 'proof-icon-img',
    width: 200,
    height: 200
  },
  {
    name: 'coloring kit thumbnail',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/t/9/assets/novahair-coloring-kit-480.webp',
    width: 160,
    expectedMatches: 1
  },
  {
    name: 'before-after image',
    url: 'https://cdn.shopify.com/s/files/1/0719/2628/4583/files/08723e1e-9f39-41c3-b7c5-7c76c9696610.png?v=1787154002',
    classToken: 'ba-img',
    width: 900
  }
];

const BASIC_GALLERY_OLD = "galMain.src = t.src;\n        galMain.alt = t.alt;";
const BASIC_GALLERY_NEW = "galMain.removeAttribute('srcset');\n        galMain.removeAttribute('sizes');\n        galMain.src = t.getAttribute('data-full-src') || t.src;\n        galMain.alt = t.alt;";

const ENHANCED_GALLERY_OLD = "var thumb=thumbs[index],src=thumb.getAttribute('src');\n      main.classList.add('is-changing');\n      main.removeAttribute('srcset');main.removeAttribute('sizes');\n      main.src=src;main.alt=thumb.alt||'NovaHair';";
const ENHANCED_GALLERY_NEW = "var thumb=thumbs[index],src=thumb.getAttribute('data-full-src')||thumb.getAttribute('src');\n      var keepInitialResponsive=index===0&&main.hasAttribute('srcset')&&!main.dataset.galleryReady;\n      main.classList.add('is-changing');\n      if(!keepInitialResponsive){main.removeAttribute('srcset');main.removeAttribute('sizes');main.src=src;}\n      main.dataset.galleryReady='true';main.alt=thumb.alt||'NovaHair';";

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function encodedWidthUrl(url, width) {
  return `${url}${url.includes('?') ? '&amp;' : '?'}width=${width}`;
}

function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

function setAttribute(tag, name, value) {
  const expression = new RegExp(`(\\s${name}=)"[^"]*"`, 'i');
  if (expression.test(tag)) return tag.replace(expression, `$1"${value}"`);
  return tag.replace(/\s*\/>$|>$/, (closing) => ` ${name}="${value}"${closing}`);
}

function removeAttribute(tag, name) {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`, 'i'), '');
}

function hasClassToken(tag, token) {
  const className = getAttribute(tag, 'class') || '';
  return className.split(/\s+/).includes(token);
}

function matchesTarget(tag, target) {
  const source = getAttribute(tag, 'src');
  const baseSource = source ? source.replace(/(?:\?width=|&amp;width=|&width=)\d+$/, '') : null;
  if (baseSource !== target.url) return false;
  if (target.id && getAttribute(tag, 'id') !== target.id) return false;
  if (target.classToken && !hasClassToken(tag, target.classToken)) return false;
  return true;
}

function optimizeImageTags(body, target) {
  const tags = body.match(/<img\b[^>]*>/gi) || [];
  const matches = tags.filter((tag) => matchesTarget(tag, target));
  const expectedMatches = target.expectedMatches || 1;
  if (matches.length !== expectedMatches) {
    throw new Error(`${target.name}: expected ${expectedMatches} matching image tag(s), found ${matches.length}.`);
  }

  let output = body;
  for (const original of matches) {
    let optimized = setAttribute(original, 'src', encodedWidthUrl(target.url, target.width));
    if (target.width) optimized = setAttribute(optimized, 'width', String(target.width));
    if (target.height) optimized = setAttribute(optimized, 'height', String(target.height));
    if (target.fullWidth) {
      optimized = setAttribute(optimized, 'data-full-src', encodedWidthUrl(target.url, target.fullWidth));
    }
    if (target.srcsetWidths) {
      const srcset = target.srcsetWidths.map((width) => `${encodedWidthUrl(target.url, width)} ${width}w`).join(', ');
      optimized = setAttribute(optimized, 'srcset', srcset);
    }
    if (target.sizes) optimized = setAttribute(optimized, 'sizes', target.sizes);
    output = output.replace(original, optimized);
  }
  return output;
}

function replaceExactlyOnce(body, oldValue, newValue, name) {
  if (!body.includes(oldValue) && body.includes(newValue)) return body;
  const count = occurrences(body, oldValue);
  if (count !== 1) throw new Error(`${name}: expected one source marker, found ${count}.`);
  return body.replace(oldValue, newValue);
}

function deferReviewModalImage(body) {
  const tags = body.match(/<img\b[^>]*>/gi) || [];
  const matches = tags.filter((tag) => getAttribute(tag, 'id') === 'ugcModalImg');
  if (matches.length !== 1) throw new Error(`review modal image: expected one tag, found ${matches.length}.`);
  const original = matches[0];
  if (!getAttribute(original, 'src')) return body;
  return body.replace(original, removeAttribute(original, 'src'));
}

function patchBody(body) {
  let output = replaceExactlyOnce(body, FONT_IMPORT, FONT_REPLACEMENT, 'duplicate font import');
  for (const target of IMAGE_TARGETS) output = optimizeImageTags(output, target);
  output = deferReviewModalImage(output);
  output = replaceExactlyOnce(output, BASIC_GALLERY_OLD, BASIC_GALLERY_NEW, 'basic gallery source');
  output = replaceExactlyOnce(output, ENHANCED_GALLERY_OLD, ENHANCED_GALLERY_NEW, 'enhanced gallery source');
  return output;
}

function validatePageBody(body) {
  const required = [
    'id="buy"',
    'id="mainCheckout"',
    'data-full-src=',
    'document.addEventListener("shopify:section:load",s);',
    'cart-drawer'
  ];
  for (const marker of required) {
    if (!body.includes(marker)) throw new Error(`Required live-page marker is missing: ${marker}`);
  }
  if (body.includes(FONT_IMPORT)) throw new Error('The duplicate page-level font import is still present.');
  if (occurrences(body, 'data-full-src=') !== 6) throw new Error('Expected six optimized gallery thumbnails.');
  if (getModalImageSrc(body)) throw new Error('The hidden review modal still has an eager source URL.');
}

function getModalImageSrc(body) {
  const tag = (body.match(/<img\b[^>]*id="ugcModalImg"[^>]*>/i) || [])[0];
  return tag ? getAttribute(tag, 'src') : null;
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
      hostname: STOREFRONT,
      path: `/pages/${EXPECTED_HANDLE}?perf_check=${Date.now()}`,
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
  const patchedBody = patchBody(originalBody);
  validatePageBody(patchedBody);
  const changed = patchedBody !== originalBody;
  console.log(`Target: ${current.handle} (${current.id})`);
  console.log(`Current SHA-256: ${sha256(originalBody)}`);
  console.log(`Optimized SHA-256: ${sha256(patchedBody)}`);
  console.log(`Patch required: ${changed ? 'YES' : 'NO'}`);

  if (!apply || !changed) {
    console.log(apply ? 'The performance patch is already present.' : 'Dry run only. Re-run with --apply to update Shopify.');
    return;
  }

  const backupDirectory = path.join(__dirname, 'backups_live_performance');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `${EXPECTED_HANDLE}-${PAGE_ID}-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    page: current,
    captured_at: new Date().toISOString(),
    body_sha256: sha256(originalBody)
  }, null, 2), 'utf8');

  await shopifyRequest(token, 'PUT', endpoint, {
    page: { id: PAGE_ID, body_html: patchedBody }
  });

  const verified = (await shopifyRequest(token, 'GET', endpoint)).page;
  const verifiedBody = String(verified.body_html || '');
  if (verified.handle !== EXPECTED_HANDLE || verifiedBody !== patchedBody) {
    throw new Error('Post-update Shopify verification did not match the intended body exactly.');
  }
  validatePageBody(verifiedBody);

  const storefront = await storefrontRequest();
  if (storefront.status !== 200 || !storefront.body.includes('data-full-src=') || storefront.body.includes(FONT_IMPORT)) {
    throw new Error(`Storefront verification failed with HTTP ${storefront.status}.`);
  }

  console.log(`Backup: ${backupPath}`);
  console.log(`Verified SHA-256: ${sha256(verifiedBody)}`);
  console.log(`Storefront HTTP: ${storefront.status}`);
  console.log('NovaHair image delivery and hidden-modal loading are optimized on the live page.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  BASIC_GALLERY_NEW,
  BASIC_GALLERY_OLD,
  ENHANCED_GALLERY_NEW,
  ENHANCED_GALLERY_OLD,
  FONT_IMPORT,
  IMAGE_TARGETS,
  getModalImageSrc,
  patchBody,
  validatePageBody
};

#!/usr/bin/env node
/**
 * Checks the surfaces a deploy can silently break.
 *
 * Mounting the tracking page with `requireShopifySession` on the whole
 * /apps/funnels prefix took every storefront API call down for hours: popup,
 * concierge and cart offers all returned 401 and nothing failed loudly. Unit
 * tests could not see it because the fault was in the mount order. This runs
 * against a deployed Worker and the live storefront.
 *
 *   node scripts/smoke.mjs                      # production
 *   node scripts/smoke.mjs --worker <url>       # a staging deploy
 */
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const worker = flag("worker", "https://shopify-funnel-control.tigerbrands-funnel.workers.dev").replace(/\/$/, "");
const storefront = flag("storefront", "https://tigerbrandsglobal.com").replace(/\/$/, "");
const skipStorefront = args.includes("--no-storefront");

const results = [];
async function check(name, url, accept) {
  try {
    const response = await fetch(url, { redirect: "manual" });
    const body = await response.text();
    const ok = accept(response.status, body);
    results.push({ name, ok, detail: `${response.status}` });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error?.message || error).slice(0, 80) });
  }
}

const is = (...codes) => status => codes.includes(status);
const ADMIN_PAGES = [
  "index.html", "growth-cockpit.html", "journeys.html", "analytics.html",
  "shipment-control.html", "support.html", "operations.html", "ai-concierge.html",
  "cart-offers.html", "element-experiments.html", "popup-analytics.html", "funnel.html", "editor.html",
];

for (const page of ADMIN_PAGES) {
  await check(`admin/${page}`, `${worker}/admin/${page}`, is(200));
}
for (const asset of ["js/overview.js", "js/money.js", "js/support.js", "css/overview.css"]) {
  await check(`admin/${asset}`, `${worker}/admin/${asset}`, is(200));
}
// An admin API must refuse an unauthenticated caller — never 200, never 500.
await check("admin API is protected", `${worker}/api/growth-cockpit/finance?preset=today`, is(401, 403));
await check("health", `${worker}/api/health`, is(200));
// A 500 must not carry a stack trace.
await check("errors hide internals", `${worker}/api/health`, (status, body) => status === 200 && !body.includes("stack"));

if (!skipStorefront) {
  // These reach the Worker through Shopify's signed app proxy. A 401 here is
  // the exact failure that took the storefront down.
  await check("storefront track page", `${storefront}/apps/funnels/track`, is(200));
  for (const path of ["proxy-health", "popup-trigger-config", "cart-offers-config"]) {
    await check(`storefront api/${path}`, `${storefront}/apps/funnels/api/${path}`, status => status !== 401 && status < 500);
  }
  await check("storefront renders", `${storefront}/`, is(200));
  await check("visitor snippet is live", `${storefront}/`, (status, body) => status === 200 && body.includes("_fc_visitor"));
}

const failed = results.filter(result => !result.ok);
for (const result of results) console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name.padEnd(34)} ${result.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

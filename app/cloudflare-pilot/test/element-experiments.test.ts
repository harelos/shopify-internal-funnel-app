import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeGalleryPayload } from "../src/lib/element-templates.js";
import {
  canReuseElementAssignment,
  chooseElementVariant,
  elementBucket,
  simulateElementAllocation,
} from "../src/services/element-ab-engine.js";
import { buildElementExperimentResults } from "../src/services/element-results.js";
import {
  buildElementExposureProperties,
  buildElementPurchaseProperties,
} from "../src/services/element-posthog.js";
import { normalizeShopifyCartToken } from "../src/lib/shopify-cart-token.js";

test("NovaHair preset uses all ten approved ready Shopify CDN images in order", () => {
  const source = readFileSync("public/admin/js/element-experiments.js", "utf8");
  const urls = [...source.matchAll(/https:\/\/cdn\.shopify\.com\/s\/files\/1\/0719\/2628\/4583\/files\/(\d{2}-[a-z-]+\.webp)\?v=1788823607/g)]
    .map(match => match[1]);
  assert.deepEqual(urls, [
    "01-roots-returned.webp",
    "02-shades.webp",
    "03-ten-minute-routine.webp",
    "04-reclaim-time.webp",
    "05-shade-guidance.webp",
    "06-three-step-routine.webp",
    "07-hair-textures.webp",
    "08-no-ammonia.webp",
    "09-original-brand.webp",
    "10-emotional-close.webp",
  ]);
});

test("Worker-hosted element runtime stays byte-identical to the Shopify extension runtime", () => {
  for (const filename of ["funnel-control-elements.js", "funnel-control-attribution.js", "funnel-control-elements.css"]) {
    const extension = readFileSync(`../extensions/funnel-control-elements/assets/${filename}`);
    const workerAsset = readFileSync(`public/assets/${filename}`);
    assert.deepEqual(workerAsset, extension);
  }
});

test("element runtime persists attribution without mutating cart line items", () => {
  const experimentRuntime = readFileSync("public/assets/funnel-control-elements.js", "utf8");
  const attributionRuntime = readFileSync("public/assets/funnel-control-attribution.js", "utf8");
  assert.match(experimentRuntime, /cart\.js/);
  assert.match(experimentRuntime, /element-cart-attribution/);
  assert.match(attributionRuntime, /cart\.js/);
  assert.match(attributionRuntime, /cart\/update\.js/);
  assert.match(attributionRuntime, /__funnel_context__/);
  assert.match(attributionRuntime, /elementAssignments/);
  assert.doesNotMatch(experimentRuntime + attributionRuntime, /cart\/add\.js|cart\/change\.js/);
  assert.doesNotMatch(attributionRuntime, /["']updates["']\s*:|["']note["']\s*:/);
});

test("element runtime prevents control-to-challenger flicker and fails open safely", () => {
  const runtime = readFileSync("public/assets/funnel-control-elements.js", "utf8");
  const attributionRuntime = readFileSync("public/assets/funnel-control-attribution.js", "utf8");
  const liquid = readFileSync("../extensions/funnel-control-elements/blocks/experiment-runtime.liquid", "utf8");
  const stylesheet = readFileSync("../extensions/funnel-control-elements/assets/funnel-control-elements.css", "utf8");
  assert.match(liquid, /"target": "body"/);
  assert.match(liquid, /revealTimeoutMs/);
  assert.match(stylesheet, /\.nova \.hero-media:not\(\[data-fce-ready="true"\]\)/);
  assert.match(stylesheet, /funnel-control-gallery-fail-open/);
  assert.match(runtime, /Control revealed after runtime timeout/);
  assert.match(runtime, /image_error/);
  assert.match(runtime, /new Image/);
  assert.match(attributionRuntime, /_funnel_context/);
  assert.match(runtime, /element-cart-attribution/);
  assert.match(runtime, /fceReady/);
  assert.match(runtime, /\/apps\/funnels\/public/);
  assert.match(runtime, /credentials:[a-zA-Z_$][\w$]*\?"omit":"same-origin"/);
});

test("fast public assignment is storefront-origin scoped while tracking stays signed", () => {
  const route = readFileSync("src/routes/element-experiments.ts", "utf8");
  assert.match(route, /req\.get\("origin"\)/);
  assert.match(route, /requestOrigin !== allowedOrigin/);
  assert.match(route, /Access-Control-Allow-Origin/);
  assert.match(route, /get\("\/public\/element-runtime\/:slotKey"/);
  assert.match(route, /sendPublicElementRuntime\(req, res\)/);
  assert.match(route, /runtimeD1\(\)/);
  assert.match(route, /INSERT OR IGNORE INTO ElementAssignment/);
  assert.match(route, /get\("\/element-runtime\/:slotKey"/);
  assert.match(route, /sendElementRuntime\(req, res, true\)/);
  assert.match(route, /post\("\/element-exposure"/);
  assert.match(route, /verifyShopifyAppProxyRequest\(req\)/);
});

test("Shopify cart tokens are normalized consistently between Ajax cart and order webhooks", () => {
  assert.equal(normalizeShopifyCartToken("hWNGZwzghba0PrMBxF0L3g3f?key=secret"), "hWNGZwzghba0PrMBxF0L3g3f");
  assert.equal(normalizeShopifyCartToken(" hWNGa6uRtc3k2QREIVMkeXel "), "hWNGa6uRtc3k2QREIVMkeXel");
  assert.equal(normalizeShopifyCartToken("bad token"), "");
});

test("PostHog element events carry the same flag variant from exposure through paid order", () => {
  const shared = {
    experimentId: "experiment-1",
    experimentKey: "novahair_gallery_v1",
    posthogFlagKey: "novahair_gallery_v1",
    variantId: "variant-b",
    variantKey: "variant-b",
    slotId: "slot-1",
    slotKey: "novahair.sales.gallery.primary",
    pagePath: "/pages/novahair-sales-staging",
  };
  const exposure = buildElementExposureProperties({
    ...shared,
    eventId: "exposure-1",
    assignmentId: "assignment-1",
    allocationVersion: 1,
    isInternal: false,
  });
  const purchase = buildElementPurchaseProperties({
    ...shared,
    eventId: "purchase-1",
    assignmentId: "assignment-1",
    orderId: "gid://shopify/Order/1",
    checkoutToken: "checkout-1",
    revenue: 239,
    currency: "ILS",
  });
  assert.equal(exposure["$feature/novahair_gallery_v1"], "variant-b");
  assert.equal(purchase["$feature/novahair_gallery_v1"], "variant-b");
  assert.equal(purchase.revenue, 239);
  assert.equal(purchase.currency, "ILS");
  assert.equal(purchase.is_internal, false);
});

test("gallery control preserves the existing element without accepting arbitrary markup", () => {
  assert.deepEqual(normalizeGalleryPayload({ preserveExisting: true, html: "<script>alert(1)</script>" }), {
    preserveExisting: true,
    initialIndex: 0,
    showThumbnails: true,
    items: [],
  });
});

test("gallery challenger normalizes a safe responsive image payload", () => {
  const payload = normalizeGalleryPayload({
    initialIndex: 9,
    showThumbnails: false,
    items: [
      { id: "proof-1", src: "https://cdn.shopify.com/image.jpg", alt: "NOVAHAIR bottles", caption: "What arrives" },
    ],
  });
  assert.equal(payload.initialIndex, 0);
  assert.equal(payload.showThumbnails, false);
  assert.equal(payload.items[0].id, "proof-1");
});

test("gallery challenger rejects insecure URLs and duplicate image ids", () => {
  assert.throws(() => normalizeGalleryPayload({ items: [{ id: "one", src: "http://example.com/a.jpg", alt: "A" }] }), /HTTPS/);
  assert.throws(() => normalizeGalleryPayload({
    items: [
      { id: "same", src: "/a.jpg", alt: "A" },
      { id: "same", src: "/b.jpg", alt: "B" },
    ],
  }), /duplicated/);
});

test("element assignment bucket is deterministic and honors basis-point boundaries", () => {
  assert.equal(elementBucket("visitor-1", "experiment-1", 1), elementBucket("visitor-1", "experiment-1", 1));
  const allocations = [
    { variantId: "a-control", weightBasisPoints: 5000 },
    { variantId: "b-challenger", weightBasisPoints: 5000 },
  ];
  assert.equal(chooseElementVariant(allocations, 0), "a-control");
  assert.equal(chooseElementVariant(allocations, 4999), "a-control");
  assert.equal(chooseElementVariant(allocations, 5000), "b-challenger");
  assert.equal(chooseElementVariant(allocations, 9999), "b-challenger");
});

test("element assignments are reused only for the current allocation version and an active variant", () => {
  const allocations = [
    { variantId: "control", weightBasisPoints: 0 },
    { variantId: "winner", weightBasisPoints: 10000 },
  ];
  assert.equal(canReuseElementAssignment({ variantId: "winner", allocationVersion: 2 }, 2, allocations), true);
  assert.equal(canReuseElementAssignment({ variantId: "control", allocationVersion: 2 }, 2, allocations), false);
  assert.equal(canReuseElementAssignment({ variantId: "winner", allocationVersion: 1 }, 2, allocations), false);
});

test("50/50 allocation stays balanced across many synthetic visitor ids and replays deterministically", () => {
  const allocations = [
    { variantId: "control", weightBasisPoints: 5000 },
    { variantId: "gallery-top-10", weightBasisPoints: 5000 },
  ];
  const report = simulateElementAllocation(
    allocations,
    "novahair-gallery-v1",
    1,
    20_000,
    "novahair-gallery-qa",
  );
  assert.equal(report.totalAssigned, 20_000);
  assert.equal(report.deterministicReplayPassed, true);
  assert.equal(report.sampleAssignments.length, 20);
  for (const row of report.rows) {
    assert.ok(Math.abs(row.deviationPercentagePoints) < 1, `${row.variantId} deviated by ${row.deviationPercentagePoints}pp`);
  }
  const replay = simulateElementAllocation(
    allocations,
    "novahair-gallery-v1",
    1,
    20_000,
    "novahair-gallery-qa",
  );
  assert.deepEqual(replay, report);
});

test("sales results use unique visitors and paid non-test net revenue", () => {
  const results = buildElementExperimentResults({
    variants: [
      { id: "control", key: "control", name: "Control", isControl: true },
      { id: "variant-b", key: "variant-b", name: "Variant B", isControl: false },
    ],
    exposures: [
      { visitorId: "c1", variantId: "control", isInternal: false },
      { visitorId: "c1", variantId: "control", isInternal: false },
      { visitorId: "c2", variantId: "control", isInternal: false },
      { visitorId: "b1", variantId: "variant-b", isInternal: false },
      { visitorId: "b2", variantId: "variant-b", isInternal: false },
      { visitorId: "internal", variantId: "variant-b", isInternal: true },
    ],
    checkouts: [
      { checkoutToken: "cc", visitorId: "c1", variantId: "control" },
      { checkoutToken: "bc1", visitorId: "b1", variantId: "variant-b" },
      { checkoutToken: "bc2", visitorId: "b1", variantId: "variant-b" },
    ],
    orders: [
      { orderId: "co", variantId: "control", currency: "ILS", netRevenueAmount: 100, isTest: false, status: "PAID" },
      { orderId: "bo1", variantId: "variant-b", currency: "ILS", netRevenueAmount: 120, isTest: false, status: "PAID" },
      { orderId: "bo2", variantId: "variant-b", currency: "ILS", netRevenueAmount: 120, isTest: false, status: "PAID" },
      { orderId: "test", variantId: "variant-b", currency: "ILS", netRevenueAmount: 999, isTest: true, status: "PAID" },
      { orderId: "refund", variantId: "variant-b", currency: "ILS", netRevenueAmount: 0, isTest: false, status: "REFUNDED_OR_CANCELLED" },
    ],
  });
  const control = results.variants.find(row => row.variantId === "control")!;
  const challenger = results.variants.find(row => row.variantId === "variant-b")!;
  assert.equal(control.exposedVisitors, 2);
  assert.equal(control.conversionRate, 50);
  assert.equal(challenger.orders, 2);
  assert.equal(challenger.checkouts, 2);
  assert.equal(challenger.checkoutVisitors, 1);
  assert.equal(challenger.checkoutRate, 50);
  assert.equal(challenger.revenue, 240);
  assert.equal(challenger.conversionRate, 100);
  assert.equal(challenger.conversionUpliftPercent, 100);
});

test("sales results never sum revenue across currencies", () => {
  const results = buildElementExperimentResults({
    variants: [{ id: "control", key: "control", name: "Control", isControl: true }],
    exposures: [{ visitorId: "v1", variantId: "control", isInternal: false }],
    checkouts: [],
    orders: [
      { orderId: "ils", variantId: "control", currency: "ILS", netRevenueAmount: 100, isTest: false, status: "PAID" },
      { orderId: "usd", variantId: "control", currency: "USD", netRevenueAmount: 10, isTest: false, status: "PAID" },
    ],
  });
  assert.equal(results.mixedCurrencies, true);
  assert.equal(results.variants[0].revenue, null);
  assert.deepEqual(results.variants[0].revenueByCurrency, { ILS: 100, USD: 10 });
});

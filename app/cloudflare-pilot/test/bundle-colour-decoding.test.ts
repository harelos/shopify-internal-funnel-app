import assert from "node:assert/strict";
import test from "node:test";
import { BOTTLE_KEYS, BOTTLE_ORDER_BY_SEGMENTS, buildNovaHairCjProductLines, CJ_PHYSICAL_MAPPINGS, decodeBundleSku } from "../src/lib/novahair-cj-auto-order.js";

/**
 * A sixth shade, Medium Brown, was added to the catalogue and inserted third,
 * so a newer SKU lists six colours where an older one lists five. The decoder
 * only understood five, so every order for the new shades was never queued and
 * never reached CJ: the customer paid and nothing shipped.
 *
 * The mapping below is read from the live catalogue, not guessed: the
 * single-colour variants NOVASALE-{2,4,6}-0-0-{n}-0-0-0 are all titled
 * "חום בינוני", which places Medium Brown at the third position.
 */
test("a six-colour SKU puts the bottles on the shade the catalogue names", () => {
  const bundle = decodeBundleSku("NOVASALE-4-0-0-4-0-0-0");
  assert.ok(bundle);
  assert.equal(bundle.medium_brown, 4, "NOVASALE-4-0-0-4-0-0-0 is 4 x Medium Brown");
  assert.equal(bundle.light_brown, 0, "reading it with the old order would have shipped Light Brown");
  assert.equal(bundle.bundle_size, 4);
  assert.equal(bundle.free_kit, 1);
});

test("the five-colour SKUs still decode the way they always did", () => {
  const bundle = decodeBundleSku("NOVASALE-4-0-0-4-0-0");
  assert.ok(bundle);
  assert.equal(bundle.light_brown, 4, "the older SKU shape is Light Brown at that position");
  assert.equal(bundle.medium_brown, 0);
});

test("a mixed six-colour bundle splits across the right two shades", () => {
  // Catalogue title: "חום כהה 2 + חום בינוני 2".
  const bundle = decodeBundleSku("NOVASALE-4-0-2-2-0-0-0");
  assert.ok(bundle);
  assert.equal(bundle.dark_brown, 2);
  assert.equal(bundle.medium_brown, 2);
  assert.equal(bundle.light_brown, 0);
});

test("every shade the decoder can emit is orderable from CJ", () => {
  for (const key of BOTTLE_KEYS) {
    const mapping = CJ_PHYSICAL_MAPPINGS[key];
    assert.ok(mapping, `${key} has no CJ variant, so an order for it could not be placed`);
    assert.match(mapping.vid, /^\d{19}$/);
    assert.match(mapping.sku, /^CJYD\d{9}[A-Z]{2}$/);
    assert.ok(mapping.weight_g > 0, `${key} has no weight, so CJ could not quote postage for it`);
  }
  // Six shades share one listing at 330 g; Golden Blonde is sourced from a
  // second listing, so it weighs and costs differently and must not be
  // assumed to match the others.
  assert.equal(CJ_PHYSICAL_MAPPINGS.golden_blonde.weight_g, 370);
  assert.equal(CJ_PHYSICAL_MAPPINGS.golden_blonde.sku, "CJYD316315806FU");
  // Verified against CJ product 2412030839551623800 on 2026-09-16.
  assert.equal(CJ_PHYSICAL_MAPPINGS.medium_brown.sku, "CJYD223160006FU");
  assert.equal(CJ_PHYSICAL_MAPPINGS.medium_brown.vid, "2507140803121609000");
});

test("both SKU shapes are understood and quantities must add up", () => {
  assert.deepEqual(Object.keys(BOTTLE_ORDER_BY_SEGMENTS).sort(), ["5", "6", "7"]);
  assert.equal(BOTTLE_ORDER_BY_SEGMENTS[6][2], "medium_brown");
  assert.equal(BOTTLE_ORDER_BY_SEGMENTS[5][2], "light_brown");
  // A SKU whose colours do not sum to the bundle size is not a bundle.
  assert.equal(decodeBundleSku("NOVASALE-4-0-0-3-0-0-0"), null);
  // Eight colour segments is a shape nobody has defined yet.
  assert.equal(decodeBundleSku("NOVASALE-4-0-0-4-0-0-0-0-0"), null);
  assert.equal(decodeBundleSku("NOVASALE-3-3-0-0-0-0"), null);
  // Quantity multiplies every shade, not just the first.
  const doubled = decodeBundleSku("NOVASALE-2-0-0-2-0-0-0", 3);
  assert.equal(doubled?.medium_brown, 6);
  assert.equal(doubled?.bundle_size, 6);
});

test("a medium brown bundle becomes real CJ lines, not a rejected bundle", () => {
  const bundle = decodeBundleSku("NOVASALE-4-0-0-4-0-0-0");
  assert.ok(bundle);
  // The guard summed five named shades, so a six-colour bundle looked empty
  // and every order for the new shade was refused after decoding correctly.
  const lines = buildNovaHairCjProductLines(bundle, "line-1");
  assert.equal(lines.length, 2, "four bottles of one shade plus the free kit");
  const bottles = lines.find(line => line.sku === CJ_PHYSICAL_MAPPINGS.medium_brown.sku);
  assert.ok(bottles, "the CJ order must contain the Medium Brown variant");
  assert.equal(bottles.quantity, 4);
  assert.equal(bottles.vid, "2507140803121609000");
  assert.ok(lines.some(line => line.sku === CJ_PHYSICAL_MAPPINGS.free_kit.sku));
});

test("a mixed bundle orders both shades in the right quantities", () => {
  const bundle = decodeBundleSku("NOVASALE-4-0-2-2-0-0-0");
  assert.ok(bundle);
  const lines = buildNovaHairCjProductLines(bundle);
  const quantityBySku = Object.fromEntries(lines.map(line => [line.sku, line.quantity]));
  assert.equal(quantityBySku[CJ_PHYSICAL_MAPPINGS.dark_brown.sku], 2);
  assert.equal(quantityBySku[CJ_PHYSICAL_MAPPINGS.medium_brown.sku], 2);
  assert.equal(quantityBySku[CJ_PHYSICAL_MAPPINGS.light_brown.sku], undefined);
});

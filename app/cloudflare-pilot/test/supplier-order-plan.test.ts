import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNovaHairCjCreateOrderPayload,
  buildNovaHairCjProductLines,
  CJ_ADDON_MAPPINGS,
  CJ_PHYSICAL_MAPPINGS,
  decodeBundleSku,
  decodeExtraBottlesSku,
  NovaHairCjAutoOrderError,
} from "../src/lib/novahair-cj-auto-order.js";
import { planSupplierOrder } from "../src/lib/supplier-order-plan.js";

const bySku = (lines: Array<{ sku: string; quantity: number }>) => Object.fromEntries(lines.map(line => [line.sku, line.quantity]));

/**
 * Golden Blonde was added as a seventh colour and appended last. Read from
 * the live catalogue on 2026-09-17: NOVASALE-4-0-0-0-0-0-0-4 is titled
 * "בלונד זהוב" and NOVASALE-4-2-0-0-0-0-0-2 "שחור 2 + בלונד זהוב 2". CJ has
 * no variant for it.
 */
test("a seven-colour SKU decodes with Golden Blonde last and the older shades in place", () => {
  const blonde = decodeBundleSku("NOVASALE-4-0-0-0-0-0-0-4");
  assert.ok(blonde);
  assert.equal(blonde.golden_blonde, 4);
  assert.equal(blonde.red, 0);
  assert.equal(blonde.bundle_size, 4);
  const mix = decodeBundleSku("NOVASALE-4-2-0-0-0-0-0-2");
  assert.equal(mix?.black, 2);
  assert.equal(mix?.golden_blonde, 2);
  const medium = decodeBundleSku("NOVASALE-4-0-0-4-0-0-0-0");
  assert.equal(medium?.medium_brown, 4, "the six older shades keep their positions in the wider SKU");
});

test("a parcel needing Golden Blonde is refused, not shipped short or forgotten", () => {
  // #4481: paid on 2026-09-16, never ordered, never mentioned anywhere.
  const plan = planSupplierOrder([{ sku: "NOVASALE-4-0-0-0-0-0-0-4", quantity: 1 }]);
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.equal(plan.code, "NO_SUPPLIER_MAPPING");
    assert.match(plan.reason, /Golden Blonde/);
  }
  const bundle = decodeBundleSku("NOVASALE-4-2-0-0-0-0-0-2");
  assert.ok(bundle);
  assert.throws(
    () => buildNovaHairCjProductLines(bundle),
    (error: unknown) => error instanceof NovaHairCjAutoOrderError && error.code === "NO_SUPPLIER_MAPPING",
  );
});

test("the extra-bottle upsell is read and folded into the parcel", () => {
  // #4486 on 2026-09-17: a four-pack plus NOVAEXTRA-2-black-black. Six
  // bottles paid for; the automatic order would have carried four.
  assert.deepEqual(decodeExtraBottlesSku("NOVAEXTRA-2-black-dark_brown"),
    { black: 1, dark_brown: 1, medium_brown: 0, light_brown: 0, purple: 0, red: 0, golden_blonde: 0 });
  assert.equal(decodeExtraBottlesSku("NOVAEXTRA-2-black"), null, "two bottles need two shades");
  assert.equal(decodeExtraBottlesSku("NOVAEXTRA-1-teal"), null);
  const plan = planSupplierOrder([
    { sku: "NOVASALE-4-4-0-0-0-0", quantity: 1 },
    { sku: "NOVAEXTRA-2-black-black", quantity: 1 },
  ]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.expected.black, 6);
  assert.equal(plan.expected.bundle_size, 6);
  assert.equal(plan.expected.free_kit, 1);
  assert.deepEqual(plan.expected.extras, [{ sku: "NOVAEXTRA-2-black-black", quantity: 1 }]);
  const lines = bySku(buildNovaHairCjProductLines(plan.expected));
  assert.equal(lines[CJ_PHYSICAL_MAPPINGS.black.sku], 6);
  assert.equal(lines[CJ_PHYSICAL_MAPPINGS.free_kit.sku], 1);
});

test("extra bottles bought on their own become their own parcel, without a kit", () => {
  const plan = planSupplierOrder([{ sku: "NOVAEXTRA-1-purple", quantity: 2 }]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.expected.purple, 2);
  assert.equal(plan.expected.free_kit, 0);
  assert.deepEqual(buildNovaHairCjProductLines(plan.expected), [
    { vid: CJ_PHYSICAL_MAPPINGS.purple.vid, sku: CJ_PHYSICAL_MAPPINGS.purple.sku, quantity: 2 },
  ]);
});

test("blonde extra bottles are refused like a blonde bundle", () => {
  const plan = planSupplierOrder([
    { sku: "NOVASALE-2-2-0-0-0-0", quantity: 1 },
    { sku: "NOVAEXTRA-1-blonde", quantity: 1 },
  ]);
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.equal(plan.code, "NO_SUPPLIER_MAPPING");
});

test("add-ons sold beside the bundle travel in the same CJ order", () => {
  // #4468: a two-pack with the gloss, the serum and the mask; the automatic
  // order carried the two-pack alone.
  const plan = planSupplierOrder([
    { id: "li-1", sku: "NOVASALE-2-0-0-2-0-0-0", quantity: 1 },
    { id: "li-2", sku: "CJJT228873001AZ", quantity: 1 },
    { id: "li-3", sku: "CJYD268780701AZ", quantity: 1 },
    { id: "li-4", sku: "CJYD231269201AZ", quantity: 2 },
  ]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.expected.medium_brown, 2);
  assert.deepEqual(plan.expected.addons?.map(addon => [addon.sku, addon.vid, addon.quantity]), [
    ["CJJT228873001AZ", "2502110727121606600", 1],
    ["CJYD268780701AZ", "2512250315511638400", 1],
    ["CJYD231269201AZ", "2503011116441608900", 2],
  ]);
  const payload = buildNovaHairCjCreateOrderPayload({
    name: "#4468",
    shipping_address: { name: "T", address1: "1 St", city: "Haifa", province: "Haifa", country: "Israel", country_code: "IL", zip: "3100000" },
    line_items: [{ id: "li-1", sku: "NOVASALE-2-0-0-2-0-0-0" }, { id: "li-4", sku: "CJYD231269201AZ" }],
  }, plan.expected);
  const lines = bySku(payload.products);
  assert.equal(lines[CJ_PHYSICAL_MAPPINGS.medium_brown.sku], 2);
  assert.equal(lines[CJ_PHYSICAL_MAPPINGS.free_kit.sku], 1);
  assert.equal(lines.CJYD231269201AZ, 2);
  assert.equal(lines.CJJT228873001AZ, 1);
  assert.equal(payload.products.find(line => line.sku === "CJYD231269201AZ")?.storeLineItemId, "li-4", "an add-on points at its own Shopify line");
  assert.match(payload.remark, /add-ons CJJT228873001AZ x1/);
});

test("every add-on the store sells is mapped to a real CJ variant", () => {
  // Verified against CJ's variant list on 2026-09-17; the brush was the one
  // nobody had looked up.
  assert.equal(CJ_ADDON_MAPPINGS.CJYD197393402BY.vid, "1760593893348872192");
  for (const mapping of Object.values(CJ_ADDON_MAPPINGS)) assert.match(mapping.vid, /^\d{19}$/);
});

test("a CJ product with no mapping refuses the parcel; another supplier's goods are simply not CJ's", () => {
  const unknown = planSupplierOrder([
    { sku: "NOVASALE-2-2-0-0-0-0", quantity: 1 },
    { sku: "CJYD999999901AZ", quantity: 1 },
  ]);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.equal(unknown.code, "NO_SUPPLIER_MAPPING");
    assert.equal(unknown.sku, "CJYD999999901AZ");
  }
  const collective = planSupplierOrder([
    { sku: "NOVASALE-2-2-0-0-0-0", quantity: 1 },
    { sku: "KB-SERUM-30", quantity: 1 },
  ]);
  assert.ok(collective.ok);
  if (collective.ok) assert.equal(collective.expected.addons, undefined);
  const none = planSupplierOrder([{ sku: "KB-SERUM-30", quantity: 1 }]);
  assert.equal(none.ok, false);
  if (!none.ok) assert.equal(none.code, "NO_SUPPLIER_LINES");
});

test("a bundle SKU of a shape nobody defined fails loudly instead of vanishing", () => {
  const plan = planSupplierOrder([{ sku: "NOVASALE-4-0-0-4-0-0-0-0-0", quantity: 1 }]);
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.equal(plan.code, "UNDECODABLE_SKU");
});

test("two bundles on one order become one parcel", () => {
  const plan = planSupplierOrder([
    { sku: "NOVASALE-2-2-0-0-0-0", quantity: 1 },
    { sku: "NOVASALE-4-0-4-0-0-0", quantity: 1 },
  ]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.expected.black, 2);
  assert.equal(plan.expected.dark_brown, 4);
  assert.equal(plan.expected.free_kit, 2);
  assert.equal(plan.expected.bundle_size, 6);
  assert.equal(bySku(buildNovaHairCjProductLines(plan.expected))[CJ_PHYSICAL_MAPPINGS.free_kit.sku], 2);
});

test("the bundle arriving as component SKUs is still understood", () => {
  const plan = planSupplierOrder([
    { sku: "CJYD223160001AZ", quantity: 3 },
    { sku: "CJYD223160002BY", quantity: 1 },
    { sku: "CJBJMRPF00756-Suit", quantity: 1 },
  ]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.expected.black, 3);
  assert.equal(plan.expected.dark_brown, 1);
  assert.equal(plan.expected.free_kit, 1);
  assert.equal(plan.expected.original_sku, "DECOMPOSED-BUNDLE-4B");
});

test("an OceAura bundle rides the same planner and keeps its own lines", () => {
  const plan = planSupplierOrder([
    { sku: "OCEASALE-1-1-1", quantity: 1 },
    { sku: "CJYD231269201AZ", quantity: 1 },
  ]);
  assert.ok(plan.ok);
  if (!plan.ok) return;
  assert.equal(plan.expected.brand, "oceaura");
  assert.equal(buildNovaHairCjProductLines(plan.expected).length, 4, "three OceAura products plus the mask, no kit");
});

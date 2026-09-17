import assert from "node:assert/strict";
import test from "node:test";
import { buildNovaHairCjCreateOrderPayload, buildNovaHairCjProductLines, decodeBundleSku } from "../src/lib/novahair-cj-auto-order.js";
import { decodeAnyBundleSku, decodeOceAuraBundleSku, isOceAuraBundleSku, OCEAURA_CJ_MAPPINGS } from "../src/lib/oceaura-cj-auto-order.js";

/**
 * The three bundles sold on the OceAura page, exactly as their variants are
 * configured in Shopify: OCEASALE-{shampoo}-{conditioner}-{oil}.
 */
test("each OceAura bundle becomes one CJ line per product it contains", () => {
  const starter = decodeOceAuraBundleSku("OCEASALE-1-1-0");
  assert.ok(starter);
  assert.equal(starter.brand, "oceaura");
  assert.deepEqual(starter.lines, [
    { vid: OCEAURA_CJ_MAPPINGS.shampoo.vid, sku: "CJST202283801AZ", quantity: 1 },
    { vid: OCEAURA_CJ_MAPPINGS.conditioner.vid, sku: "CJST202282501AZ", quantity: 1 },
  ]);
  assert.equal(starter.bundle_size, 2);
  assert.equal(starter.expected_weight_g, 296);

  const full = decodeOceAuraBundleSku("OCEASALE-3-3-1");
  assert.ok(full);
  assert.equal(full.lines?.length, 3, "the full ritual adds the oil as a third line");
  assert.equal(full.lines?.[2].sku, "CJST202282001AZ");
  assert.equal(full.bundle_size, 7);
  assert.equal(full.expected_weight_g, 3 * 148 + 3 * 148 + 90);
});

test("two of the same bundle on one order doubles every component", () => {
  const doubled = decodeOceAuraBundleSku("OCEASALE-2-2-0", 2);
  assert.ok(doubled);
  assert.deepEqual(doubled.lines?.map(line => line.quantity), [4, 4]);
  assert.equal(doubled.bundle_size, 8);
});

test("an OceAura bundle never needs the NovaHair colouring kit", () => {
  const bundle = decodeOceAuraBundleSku("OCEASALE-2-2-0");
  assert.ok(bundle);
  assert.equal(bundle.free_kit, 0);
  // The NovaHair line builder would refuse a bundle with no kit; it must
  // pass component bundles straight through instead.
  const lines = buildNovaHairCjProductLines(bundle, "line-9");
  assert.equal(lines.length, 2);
  assert.ok(lines.every(line => line.storeLineItemId === "line-9"));
});

test("the CJ order remark names the brand it is for", () => {
  const bundle = decodeOceAuraBundleSku("OCEASALE-1-1-0");
  assert.ok(bundle);
  const payload = buildNovaHairCjCreateOrderPayload({
    name: "#5001",
    line_items: [{ id: 77, sku: "OCEASALE-1-1-0", quantity: 1 }],
    shipping_address: { first_name: "Dana", last_name: "L", address1: "Herzl 1", city: "Tel Aviv", zip: "6100000", country: "Israel", country_code: "IL", phone: "0501234567" },
  }, bundle);
  assert.match(payload.remark, /OceAura/);
  assert.equal(payload.products.length, 2);
  assert.equal(payload.products[0].storeLineItemId, "77");
});

test("malformed or empty OceAura SKUs are refused", () => {
  assert.equal(decodeOceAuraBundleSku("OCEASALE-0-0-0"), null);
  assert.equal(decodeOceAuraBundleSku("OCEASALE-1-1"), null);
  assert.equal(decodeOceAuraBundleSku("NOVASALE-2-2-0-0-0-0"), null);
  assert.equal(isOceAuraBundleSku("OCEASALE-3-3-1"), true);
  assert.equal(isOceAuraBundleSku("CJST202283801AZ"), false);
});

test("the shared decoder still reads NovaHair first and OceAura second", () => {
  assert.equal(decodeAnyBundleSku("NOVASALE-2-2-0-0-0-0")?.bundle_size, decodeBundleSku("NOVASALE-2-2-0-0-0-0")?.bundle_size);
  assert.equal(decodeAnyBundleSku("OCEASALE-3-3-1")?.brand, "oceaura");
  assert.equal(decodeAnyBundleSku("nothing"), null);
});

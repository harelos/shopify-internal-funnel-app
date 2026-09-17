import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildNovaHairCjCreateOrderPayload,
  cjStreetLine,
  decodeBundleSku,
  isUsableCjPostcode,
  NovaHairCjAutoOrderError,
  type ExpectedBundle,
} from "../src/lib/novahair-cj-auto-order.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = decodeBundleSku("NOVASALE-2-2-0-0-0-0") as ExpectedBundle;

const order = (address: Record<string, unknown>) => ({
  name: "#4482",
  email: "buyer@example.com",
  shipping_address: { name: "Test Buyer", city: "תל אביב", province: "תל אביב", country: "Israel", country_code: "IL", phone: "0500000000", ...address },
  line_items: [{ id: "line-1", sku: "NOVASALE-2-2-0-0-0-0" }],
});

/**
 * Israeli shoppers split an address across Shopify's two lines however they
 * like: #4485 is address1 "25", address2 "64, ליאון בלום". Sending address1
 * alone put "25" on CJ's label. The path that delivered 79 parcels joins both
 * lines into the one field, so this does too.
 */
test("both Shopify address lines go into the one field CJ prints", () => {
  assert.equal(cjStreetLine({ address1: "25", address2: "64, ליאון בלום" }), "25 64, ליאון בלום");
  assert.equal(cjStreetLine({ address1: "הצופים 2", address2: null }), "הצופים 2");
  assert.equal(cjStreetLine({ address1: "", address2: "" }), "");
  const payload = buildNovaHairCjCreateOrderPayload(order({ address1: "25", address2: "64, ליאון בלום", zip: "3385300" }), bundle);
  assert.equal(payload.shippingAddress, "25 64, ליאון בלום");
  // Sending it twice would print the street line twice on the label.
  assert.equal(payload.shippingAddress2, undefined);
});

/**
 * CJ refuses an Israeli order with no postcode, and this store's plan hides
 * the field from most API surfaces, so eight paid orders sat unsent. The
 * merchant-approved placeholder (recipient_supplement.json default_zip) is
 * what the Python path has always used; Israeli couriers route on street,
 * city and phone. It is recorded in the remark, never passed off as real.
 */
test("a blank postcode falls back to the merchant's placeholder and says so", () => {
  const payload = buildNovaHairCjCreateOrderPayload(
    order({ address1: "הדודאים 9", zip: "" }), bundle, { fallbackPostcode: "6100000" },
  );
  assert.equal(payload.shippingZip, "6100000");
  assert.match(payload.remark, /postcode 6100000 is a placeholder/);
});

test("a real postcode always wins, and the remark stays clean", () => {
  const payload = buildNovaHairCjCreateOrderPayload(
    order({ address1: "הצופים 2", zip: "7570000" }), bundle, { fallbackPostcode: "6100000" },
  );
  assert.equal(payload.shippingZip, "7570000");
  assert.doesNotMatch(payload.remark, /placeholder/);
});

test("the billing address is tried before the placeholder", () => {
  const payload = buildNovaHairCjCreateOrderPayload(
    { ...order({ address1: "הצופים 2", zip: "" }), billing_address: { zip: "4550000" } },
    bundle, { fallbackPostcode: "6100000" },
  );
  assert.equal(payload.shippingZip, "4550000");
  assert.doesNotMatch(payload.remark, /placeholder/);
});

test("no fallback configured leaves the order to fail at CJ rather than inventing one", () => {
  const payload = buildNovaHairCjCreateOrderPayload(order({ address1: "הצופים 2", zip: "" }), bundle);
  assert.equal(payload.shippingZip, undefined);
});

test("CJ's postcode rule is enforced, so a junk placeholder is never sent", () => {
  // CJ rule 4001: digits, spaces and hyphens, 4-12 characters.
  assert.equal(isUsableCjPostcode("6100000"), true);
  assert.equal(isUsableCjPostcode("12 34"), true);
  assert.equal(isUsableCjPostcode("SW1A 1AA"), false);
  assert.equal(isUsableCjPostcode("123"), false);
  assert.equal(isUsableCjPostcode(""), false);
  const payload = buildNovaHairCjCreateOrderPayload(
    order({ address1: "הצופים 2", zip: "n/a" }), bundle, { fallbackPostcode: "not-a-postcode" },
  );
  assert.equal(payload.shippingZip, undefined, "neither the junk zip nor the junk fallback may be sent");
});

/**
 * A postcode can be placeholdered. A street cannot: a parcel with no street
 * line simply cannot be delivered, so it must stop here, not at CJ.
 */
test("a missing street line still refuses the order", () => {
  assert.throws(
    () => buildNovaHairCjCreateOrderPayload(order({ address1: "", address2: "", zip: "6100000" }), bundle),
    (error: unknown) => error instanceof NovaHairCjAutoOrderError && error.code === "MISSING_SHIPPING_FIELDS",
  );
});

/**
 * The address-hold gate used to wait for a real postcode before retrying, so
 * an order the shopper never gave one for waited for ever. Eight paid parcels
 * sat unsent behind exactly this line.
 */
test("an order held for a postcode is released once a placeholder is configured", () => {
  const monitor = readFileSync(path.join(root, "src/services/novahair-monitor.ts"), "utf8").replace(/\r\n/g, "\n");
  const gate = monitor.slice(monitor.indexOf('if (row.syncState === "NEEDS_ADDRESS_FIX")'), monitor.indexOf("const firstSeen"));
  assert.doesNotMatch(gate, /if \(!address \|\| !String\(address\.zip/, "the gate still waits for a real postcode");
  assert.match(gate, /zips\.some\(isUsableCjPostcode\)/);
  assert.match(gate, /NOVAHAIR_CJ_FALLBACK_POSTCODE/);
});

test("a parcel sent on a placeholder postcode is recorded where a person sees it", () => {
  const monitor = readFileSync(path.join(root, "src/services/novahair-monitor.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(monitor, /fallbackPostcode: getEnvVar\("NOVAHAIR_CJ_FALLBACK_POSTCODE"\)/);
  assert.match(monitor, /PLACEHOLDER_POSTCODE/);
  const config = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
  // Production carries the merchant's approved value; staging must never post real orders.
  assert.match(config, /"NOVAHAIR_CJ_FALLBACK_POSTCODE": "6100000"/);
  assert.match(config, /"NOVAHAIR_CJ_FALLBACK_POSTCODE": ""/);
});

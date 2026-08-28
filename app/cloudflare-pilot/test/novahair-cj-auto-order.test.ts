import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNovaHairCjCreateOrderPayload,
  buildNovaHairCjProductLines,
  novaHairAutoCjOrderNumber,
  NovaHairCjAutoOrderError,
  type ExpectedBundle,
} from "../src/lib/novahair-cj-auto-order.js";

const expectedFourPack: ExpectedBundle = {
  bundle_size: 4,
  black: 3,
  dark_brown: 1,
  light_brown: 0,
  purple: 0,
  red: 0,
  free_kit: 1,
  expected_weight_g: 1430,
  original_sku: "NOVASALE-4-3-1-0-0-0",
};

test("NovaHair auto CJ lines decompose the bundle into physical CJ SKUs plus free kit", () => {
  const lines = buildNovaHairCjProductLines(expectedFourPack, "line-1");
  assert.deepEqual(lines, [
    { vid: "2412030839551624000", sku: "CJYD223160001AZ", quantity: 3, storeLineItemId: "line-1" },
    { vid: "2412030839551624200", sku: "CJYD223160002BY", quantity: 1, storeLineItemId: "line-1" },
    { vid: "ED56BD86-3AF9-4E8E-9855-FBD046D33613", sku: "CJBJMRPF00756-Suit", quantity: 1, storeLineItemId: "line-1" },
  ]);
});

test("NovaHair auto CJ payload creates order-picking order without payment", () => {
  const payload = buildNovaHairCjCreateOrderPayload({
    id: 4378,
    name: "#4378",
    created_at: "2026-08-28T12:00:00Z",
    email: "customer@example.com",
    shipping_address: {
      name: "Test Customer",
      address1: "1 Test Street",
      city: "Tel Aviv",
      province: "Center",
      country: "Israel",
      country_code: "IL",
      zip: "5851222",
      phone: "00972 54-000-0000",
    },
    line_items: [{ id: "line-1", sku: "NOVASALE-4-3-1-0-0-0" }],
  }, expectedFourPack);

  assert.equal(payload.orderNumber, "AUTO-4378");
  assert.equal(payload.payType, 3);
  assert.equal(payload.platform, "shopify");
  assert.equal(payload.orderFlow, 1);
  assert.equal(payload.logisticName, "CJPacket YP Special Line");
  assert.equal(payload.shippingPhone, "+972540000000");
  assert.equal(payload.products.length, 3);
});

test("NovaHair auto CJ payload fails closed without required shipping fields", () => {
  assert.throws(
    () => buildNovaHairCjCreateOrderPayload({ name: "#4378", shipping_address: {} }, expectedFourPack),
    (error: unknown) => error instanceof NovaHairCjAutoOrderError && error.code === "MISSING_SHIPPING_FIELDS",
  );
});

test("NovaHair auto CJ order number is deterministic and CJ-length safe", () => {
  assert.equal(novaHairAutoCjOrderNumber("#4378"), "AUTO-4378");
  assert.equal(novaHairAutoCjOrderNumber(" 4378 "), "AUTO-4378");
});


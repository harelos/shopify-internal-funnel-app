import assert from "node:assert/strict";
import test from "node:test";
import { extractDiscountCodes, extractPopupAttribution } from "../src/lib/popup-attribution.ts";

test("extracts popup attribution from Shopify array line-item properties", () => {
  const result = extractPopupAttribution({
    line_items: [{ properties: [
      { name: "_NOVA_EXIT_POPUP", value: "1" },
      { name: "_NOVA_EXIT_COUPON", value: "FIRST10" },
      { name: "_NOVA_EXIT_VISITOR", value: "nhv_123" },
      { name: "_NOVA_EXIT_SESSION", value: "nhs_456" },
      { name: "_NOVA_EXIT_VERSION", value: "novahair_popup_v1" },
      { name: "_NOVA_EXIT_DEVICE", value: "mobile" },
    ] }],
  });
  assert.deepEqual(result, {
    code: "FIRST10", visitorId: "nhv_123", sessionId: "nhs_456",
    version: "novahair_popup_v1", device: "mobile",
  });
});

test("extracts object properties and rejects orders without the popup marker", () => {
  assert.deepEqual(extractPopupAttribution({
    line_items: [{ properties: { _NOVA_EXIT_POPUP: "0", _NOVA_EXIT_COUPON: "FIRST10" } }],
  }), null);
  assert.deepEqual(extractPopupAttribution({
    line_items: [{ properties: { _NOVA_EXIT_POPUP: "1", _NOVA_EXIT_COUPON: "FIRST10" } }],
  }), { code: "FIRST10" });
});

test("extracts and normalizes authoritative Shopify discount codes", () => {
  assert.deepEqual(extractDiscountCodes({
    discount_codes: [{ code: "nova10" }, { code: "NOVA10" }, { code: "VIP" }],
  }), ["NOVA10", "VIP"]);
});

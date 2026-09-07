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
    method: "LINE_ITEM_PROPERTIES",
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
  }), { method: "LINE_ITEM_PROPERTIES", code: "FIRST10" });
});

test("extracts current Concierge attribution from Shopify order note attributes", () => {
  assert.deepEqual(extractPopupAttribution({
    note_attributes: [
      { name: "_nh_popup", value: "1" },
      { name: "_nh_conversation_id", value: "c_123" },
      { name: "_nh_visitor_id", value: "visitor_123" },
      { name: "_nh_session_id", value: "session_123" },
      { name: "_nh_version", value: "novahair_ai_v1" },
      { name: "_nh_agent", value: "sales" },
      { name: "_nh_trigger", value: "bundle" },
      { name: "_nh_page", value: "/pages/novahair-sales-staging" },
      { name: "_nh_device", value: "mobile" },
      { name: "_nh_utm_source", value: "instagram" },
      { name: "_nh_utm_medium", value: "paid_social" },
      { name: "_nh_utm_campaign", value: "roots_test" },
    ],
  }), {
    method: "CART_NOTE_ATTRIBUTES",
    conversationId: "c_123",
    visitorId: "visitor_123",
    sessionId: "session_123",
    version: "novahair_ai_v1",
    agent: "sales",
    trigger: "bundle",
    page: "/pages/novahair-sales-staging",
    device: "mobile",
    utmSource: "instagram",
    utmMedium: "paid_social",
    utmCampaign: "roots_test",
  });
});

test("does not attribute arbitrary order note attributes without the Concierge marker", () => {
  assert.equal(extractPopupAttribution({
    note_attributes: [{ name: "_nh_utm_source", value: "instagram" }],
  }), null);
});

test("extracts and normalizes authoritative Shopify discount codes", () => {
  assert.deepEqual(extractDiscountCodes({
    discount_codes: [{ code: "nova10" }, { code: "NOVA10" }, { code: "VIP" }],
  }), ["NOVA10", "VIP"]);
});

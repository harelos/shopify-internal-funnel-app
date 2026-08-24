import assert from "node:assert/strict";
import test from "node:test";
import { normalizePopupEventInput, percentage } from "../src/lib/popup-analytics.ts";

function eventBody(event = "popup_view") {
  return {
    event,
    visitorId: "nhv_test",
    occurredAt: new Date().toISOString(),
    explicitEventKey: `${event}:novahair_popup_v1:nhs_test:page_abc`,
    payload: {
      popupId: "novahair-sales",
      popupVersion: "novahair_popup_v1",
      sessionId: "nhs_test",
      path: "/pages/novahair-sales",
      template: "page.novafunnel",
      device: "mobile",
      email: "must-not-persist@example.com",
    },
    utm_source: "facebook",
  };
}

test("normalizes canonical popup context and strips PII-like unknown fields", () => {
  const result = normalizePopupEventInput(eventBody());
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.event, "popup_view");
  assert.equal(result.payload.path, "/pages/novahair-sales");
  assert.equal(result.payload.email, undefined);
  assert.equal(result.device, "mobile");
  assert.equal(result.utmSource, "facebook");
});

test("rejects storefront success and purchase events without server confirmation", () => {
  assert.deepEqual(normalizePopupEventInput(eventBody("popup_submit_success")), {
    error: "This event requires server confirmation.",
  });
  assert.deepEqual(normalizePopupEventInput(eventBody("popup_purchase")), {
    error: "This event requires server confirmation.",
  });
});

test("normalizes unsupported close methods and calculates guarded rates", () => {
  const body = eventBody("popup_closed");
  body.payload.closeMethod = "mystery";
  const result = normalizePopupEventInput(body);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.payload.closeMethod, "other");
  assert.equal(percentage(3, 4), 75);
  assert.equal(percentage(1, 0), 0);
});

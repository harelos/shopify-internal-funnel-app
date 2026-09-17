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
    utm_medium: "paid_social",
    utm_campaign: "roots_test",
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
  assert.equal(result.utmMedium, "paid_social");
  assert.equal(result.utmCampaign, "roots_test");
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

test("redacts contact details from shopper free text before persistence", () => {
  const body = eventBody("popup_ai_step");
  body.payload.freeText = "חזרו אליי ב-050-123-4567 או dana@example.com https://example.com";
  const result = normalizePopupEventInput(body);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.payload.freeText, "חזרו אליי ב-[phone] או [email] [link]");
});

test("accepts privacy-safe exit signal and experiment diagnostics", () => {
  const body = eventBody("popup_signal");
  Object.assign(body.payload, {
    trigger: "return_to_top",
    qualified: false,
    currentScrollDepth: 8,
    scrollDepth: 78,
    scrollVelocity: 1337,
    timeOnPage: 54,
    engagedSeconds: 31,
    failedGates: "engagementScore",
    blockedBy: "",
    evaluationSource: "fast_scroll_up",
    experimentId: "novahair_exit_timing_v1",
    experimentVariant: "treatment",
    experimentBucket: 72,
    holdoutPercent: 0,
  });
  const result = normalizePopupEventInput(body);
  assert.ok(!("error" in result));
  if ("error" in result) return;
  assert.equal(result.payload.trigger, "return_to_top");
  assert.equal(result.payload.experimentVariant, "treatment");
  assert.equal(result.payload.scrollVelocity, 1337);
  assert.equal(result.payload.qualified, false);
});

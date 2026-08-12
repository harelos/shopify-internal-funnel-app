import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelReport } from "../src/analytics.js";
import { createScenario } from "./helpers.js";

test("report filters by source, campaign, device, date, and variant without mixing live data", () => {
  const { service, shop, funnel, step, control } = createScenario();
  const context = {
    shopId: shop.id,
    visitorId: "visitor-filtered",
    funnelId: funnel.id,
    stepId: step.id,
    variantId: control.id,
    source: "STOREFRONT" as const,
    isTest: true,
    utmSource: "instagram",
    utmMedium: "paid-social",
    utmCampaign: "summer",
    deviceClass: "mobile" as const,
    occurredAt: new Date("2026-08-10T12:00:00.000Z"),
  };
  service.ingestEvent({ ...context, eventKey: "filter-entry", name: "FUNNEL_STEP_ENTERED" });
  service.ingestEvent({ ...context, eventKey: "filter-view", name: "FUNNEL_PAGE_VIEWED" });
  service.ingestEvent({ ...context, eventKey: "filter-cta", name: "FUNNEL_CTA_CLICKED" });
  service.ingestEvent({ ...context, eventKey: "filter-checkout", name: "CART_CHECKOUT_STARTED", checkoutToken: "filter-checkout" });
  service.ingestEvent({ ...context, eventKey: "filter-paid", name: "SHOPIFY_ORDER_PAID", checkoutToken: "filter-checkout", orderGid: "gid://shopify/Order/filter", currency: "USD", grossAmount: 42.5 });

  service.ingestEvent({ ...context, eventKey: "live-entry", name: "FUNNEL_STEP_ENTERED", isTest: false, visitorId: "live-visitor" });

  const report = buildFunnelReport(service.store, funnel.id, {
    dataMode: "TEST",
    from: new Date("2026-08-10T00:00:00.000Z"),
    to: new Date("2026-08-11T00:00:00.000Z"),
    source: "STOREFRONT",
    utmSource: "instagram",
    utmMedium: "paid-social",
    utmCampaign: "summer",
    deviceClass: "mobile",
    variantId: control.id,
  });

  assert.equal(report.uniqueStepEntries, 1);
  assert.equal(report.pageViews, 1);
  assert.equal(report.ctaClicks, 1);
  assert.equal(report.checkoutStartsObserved, 1);
  assert.equal(report.paidOrdersConfirmed, 1);
  assert.equal(report.attributedRevenue, 42.5);
  assert.equal(report.stepMetrics[0]?.ctaRate, 100);
  assert.equal(report.stepMetrics[0]?.checkoutRate, 100);
  assert.deepEqual(report.filters, {
    dataMode: "TEST",
    from: "2026-08-10T00:00:00.000Z",
    to: "2026-08-11T00:00:00.000Z",
    source: "STOREFRONT",
    utmSource: "instagram",
    utmMedium: "paid-social",
    utmCampaign: "summer",
    deviceClass: "mobile",
    variantId: control.id,
  });
});

test("live mode is an explicit empty local boundary, never an accidental mixed report", () => {
  const { service, funnel } = createScenario();
  const report = buildFunnelReport(service.store, funnel.id, { dataMode: "LIVE" });
  assert.equal(report.dataMode, "LIVE");
  assert.equal(report.uniqueStepEntries, 0);
  assert.equal(report.paidOrdersConfirmed, 0);
});

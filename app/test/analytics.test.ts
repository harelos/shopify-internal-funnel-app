import assert from "node:assert/strict";
import test from "node:test";
import { buildFunnelReport } from "../src/analytics.js";
import { createScenario } from "./helpers.js";

test("analytics separates observed checkout signal from confirmed attributed paid revenue", () => {
  const { service, shop, funnel, step, control } = createScenario();
  const base = { shopId: shop.id, visitorId: "visitor-report", funnelId: funnel.id, stepId: step.id, variantId: control.id };
  service.ingestEvent({ ...base, eventKey: "entry-report", name: "FUNNEL_STEP_ENTERED" });
  service.ingestEvent({ ...base, eventKey: "cta-report", name: "FUNNEL_CTA_CLICKED" });
  service.ingestEvent({ ...base, eventKey: "checkout-report", name: "CART_CHECKOUT_STARTED", checkoutToken: "checkout-report" });
  service.ingestEvent({ ...base, eventKey: "paid-report", name: "SHOPIFY_ORDER_PAID", checkoutToken: "checkout-report", orderGid: "gid://shopify/Order/report", currency: "USD", grossAmount: 75 });
  const report = buildFunnelReport(service.store, funnel.id);
  assert.equal(report.dataMode, "TEST");
  assert.equal(report.uniqueStepEntries, 1);
  assert.equal(report.ctaClicks, 1);
  assert.equal(report.checkoutStartsObserved, 1);
  assert.equal(report.paidOrdersConfirmed, 1);
  assert.equal(report.attributedRevenue, 75);
  assert.equal(report.aov, 75);
});

test("unknown checkout token remains unattributed and does not inflate funnel revenue", () => {
  const { service, shop, funnel, step, control } = createScenario();
  service.ingestEvent({ shopId: shop.id, eventKey: "paid-unmatched", name: "SHOPIFY_ORDER_PAID", visitorId: "visitor-unmatched", funnelId: funnel.id, stepId: step.id, variantId: control.id, checkoutToken: "not-seen", orderGid: "gid://shopify/Order/unmatched", currency: "USD", grossAmount: 100 });
  const report = buildFunnelReport(service.store, funnel.id);
  assert.equal(report.paidOrdersConfirmed, 0);
  assert.equal(report.attributedRevenue, 0);
  assert.equal(report.unattributedPaidOrders, 1);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createScenario } from "./helpers.js";

test("checkout token links one paid order to funnel revenue and duplicate order delivery does not add revenue", () => {
  const { service, shop, funnel, step, control } = createScenario();
  const base = { shopId: shop.id, visitorId: "visitor-1", funnelId: funnel.id, stepId: step.id, variantId: control.id };
  service.ingestEvent({ ...base, eventKey: "entry", name: "FUNNEL_STEP_ENTERED" });
  service.ingestEvent({ ...base, eventKey: "checkout", name: "CART_CHECKOUT_STARTED", checkoutToken: "checkout-123" });
  const first = service.ingestEvent({ ...base, eventKey: "paid-first", name: "SHOPIFY_ORDER_PAID", checkoutToken: "checkout-123", orderGid: "gid://shopify/Order/123", currency: "USD", grossAmount: 87.5 });
  const second = service.ingestEvent({ ...base, eventKey: "paid-retry-different-event", name: "SHOPIFY_ORDER_PAID", checkoutToken: "checkout-123", orderGid: "gid://shopify/Order/123", currency: "USD", grossAmount: 87.5 });
  assert.equal(first.orderAttribution?.funnelId, funnel.id);
  assert.equal(second.orderAttribution?.id, first.orderAttribution?.id);
  assert.equal(service.store.orderAttributions.size, 1);
  assert.equal(service.revenueForFunnel(funnel.id), 87.5);
});

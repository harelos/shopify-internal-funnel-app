import assert from "node:assert/strict";
import test from "node:test";
import { seedExampleFunnel } from "../src/example-funnel.js";
import { FunnelService } from "../src/funnel-service.js";

test("example funnel seeds the requested pre-sell, sales, and Shopify boundary flow", () => {
  const service = new FunnelService();
  const shop = service.createShop("example.myshopify.test");
  const example = seedExampleFunnel(service, shop);
  const steps = service.store.stepsForFunnel(example.funnel.id);

  assert.deepEqual(steps.map((step) => step.kind), ["ADVERTORIAL", "SALES", "CHECKOUT_HANDOFF"]);
  assert.deepEqual(service.store.variantsForStep(example.presell.step.id).map((variant) => variant.name), ["A · Advertorial", "B · 7 Reasons Listicle"]);
  assert.deepEqual(service.store.variantsForStep(example.sales.step.id).map((variant) => variant.name), ["A · Story & Proof", "B · Offer & Value"]);
  assert.equal(service.store.values(service.store.experiments).length, 2);
  assert.equal(service.store.values(service.store.experiments).every((experiment) => experiment.allocationVersion === 1), true);
  assert.equal(service.store.versions.size, 4);
});

test("checkout handoff can exist but cannot receive variants or an experiment", () => {
  const service = new FunnelService();
  const shop = service.createShop("boundary.myshopify.test");
  const funnel = service.createFunnel(shop.id, "Boundary test", "boundary-test");
  const checkout = service.addStep(funnel.id, "Native Shopify checkout", "CHECKOUT_HANDOFF");
  assert.throws(() => service.createVariant(checkout.id, "Checkout A"), /cannot have variants/);
  assert.throws(() => service.createExperiment(checkout.id, []), /cannot be A\/B tested/);
});

test("funnel names can be changed without changing the slug or steps", () => {
  const service = new FunnelService();
  const shop = service.createShop("rename.myshopify.test");
  const funnel = service.createFunnel(shop.id, "Old name", "stable-slug");
  const step = service.addStep(funnel.id, "Pre-sell", "ADVERTORIAL");
  const renamed = service.updateFunnel(funnel.id, { name: "New example name" });
  assert.equal(renamed.name, "New example name");
  assert.equal(renamed.slug, "stable-slug");
  assert.equal(service.store.steps.get(step.id)?.funnelId, funnel.id);
});

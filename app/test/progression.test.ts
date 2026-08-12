import assert from "node:assert/strict";
import test from "node:test";
import { createScenario } from "./helpers.js";

test("CTA requires step entry and then records ordered progression", () => {
  const { service, shop, funnel, step, control } = createScenario();
  const base = { shopId: shop.id, visitorId: "visitor-1", funnelId: funnel.id, stepId: step.id, variantId: control.id };
  assert.throws(() => service.ingestEvent({ ...base, eventKey: "cta-before-entry", name: "FUNNEL_CTA_CLICKED" }), /prior step-entry/);
  service.ingestEvent({ ...base, eventKey: "entry-first", name: "FUNNEL_STEP_ENTERED" });
  const cta = service.ingestEvent({ ...base, eventKey: "cta-after-entry", name: "FUNNEL_CTA_CLICKED" });
  assert.equal(cta.event.name, "FUNNEL_CTA_CLICKED");
  assert.equal(service.store.events.size, 2);
});

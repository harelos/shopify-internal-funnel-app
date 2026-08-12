import assert from "node:assert/strict";
import test from "node:test";
import { createScenario } from "./helpers.js";

test("event key replay is idempotent", () => {
  const { service, shop, funnel, step, control } = createScenario();
  const input = { shopId: shop.id, eventKey: "entry-once", name: "FUNNEL_STEP_ENTERED" as const, visitorId: "visitor-1", funnelId: funnel.id, stepId: step.id, variantId: control.id };
  const first = service.ingestEvent(input);
  const replay = service.ingestEvent(input);
  assert.equal(first.duplicate, false);
  assert.equal(replay.duplicate, true);
  assert.equal(service.store.events.size, 1);
});

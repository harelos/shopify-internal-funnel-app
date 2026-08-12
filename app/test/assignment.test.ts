import assert from "node:assert/strict";
import test from "node:test";
import { createScenario } from "./helpers.js";

test("assignment remains stable after allocation change", () => {
  const { service, shop, control, alternate, experiment } = createScenario();
  const first = service.assignVariant(shop.id, "visitor-stable", experiment.id);
  service.setAllocations(experiment.id, [
    { variantId: control.id, weightBasisPoints: 9_000 },
    { variantId: alternate.id, weightBasisPoints: 1_000 },
  ]);
  const returned = service.assignVariant(shop.id, "visitor-stable", experiment.id);
  assert.equal(returned.variantId, first.variantId);
  assert.equal(returned.id, first.id);
  assert.equal(returned.allocationVersion, 1);
});

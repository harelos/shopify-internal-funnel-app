import test from "node:test";
import assert from "node:assert/strict";
import { buildAdaptiveResults, variantFromOrder } from "../src/lib/adaptive-experiments.js";
import { DEFAULT_POPUP_WEIGHTS, EXPERIMENTS, POPUP_EXPERIMENT_KEY, bucketVisitor, knownExperimentKey, weightsFromFlag } from "../src/lib/cro-assignment.js";
import { normalizeBeaconBatch } from "../src/lib/live-activity.js";

test("every experiment reports add-to-cart and checkout rates, and an estimated ROAS from its share of spend", () => {
  const results = buildAdaptiveResults({
    variants: [{ key: "control", percentage: 50 }, { key: "full_adaptive", percentage: 50 }],
    exposures: [
      { variant: "control", visitors: 100, addToCart: 20, checkout: 10 },
      { variant: "full_adaptive", visitors: 100, addToCart: 30, checkout: 15 },
    ],
    orders: [
      { orderId: "1", variant: "control", amount: 239, currency: "ILS", cancelled: false },
      { orderId: "2", variant: "full_adaptive", amount: 239, currency: "ILS", cancelled: false },
      { orderId: "3", variant: "full_adaptive", amount: 239, currency: "ILS", cancelled: false },
    ],
    spend: { amount: 1000, currency: "ILS", note: "test" },
  });
  const [control, adaptive] = results.variants;
  assert.equal(control.addToCartRate, 0.2);
  assert.equal(adaptive.checkoutRate, 0.15);
  // spend follows visitors: half each
  assert.equal(control.spendShare, 500);
  assert.equal(control.roas, 0.48);
  assert.equal(adaptive.roas, 0.96);
  assert.equal(results.totals.spend, 1000);
});

test("ROAS is withheld when spend is in a different currency from revenue", () => {
  const results = buildAdaptiveResults({
    variants: [{ key: "control", percentage: 100 }],
    exposures: [{ variant: "control", visitors: 10, addToCart: 1, checkout: 1 }],
    orders: [{ orderId: "1", variant: "control", amount: 239, currency: "ILS", cancelled: false }],
    spend: { amount: 100, currency: "USD", note: "no rate" },
  });
  assert.equal(results.variants[0].roas, null);
  assert.equal(results.spend, null);
});

test("the popup test names its own control and reads the variant from the order's cart attribute", () => {
  assert.equal(EXPERIMENTS[POPUP_EXPERIMENT_KEY].control, "email_gate");
  const results = buildAdaptiveResults({
    variants: [{ key: "email_gate", percentage: 50 }, { key: "instant_code", percentage: 50 }],
    exposures: [{ variant: "email_gate", visitors: 5, addToCart: 0, checkout: 0 }, { variant: "instant_code", visitors: 5, addToCart: 0, checkout: 0 }],
    orders: [],
    controlKey: "email_gate",
  });
  assert.equal(results.variants.find(v => v.isControl)?.key, "email_gate");
  const order = { customAttributes: [{ key: "nova_popup_variant", value: "instant_code" }], lineItems: { nodes: [{ customAttributes: [{ key: "_nova_cro_variant", value: "control" }] }] } };
  assert.equal(variantFromOrder(order, POPUP_EXPERIMENT_KEY), "instant_code");
  assert.equal(variantFromOrder(order, "nova_adaptive_cro_v2"), "control");
  assert.equal(variantFromOrder({ lineItems: { nodes: [] } }, POPUP_EXPERIMENT_KEY), null);
});

test("only this app's experiments are accepted, each with its own fallback split", () => {
  assert.equal(knownExperimentKey("nova_popup_offer_v1"), "nova_popup_offer_v1");
  assert.equal(knownExperimentKey("nova_adaptive_cro_v2"), "nova_adaptive_cro_v2");
  assert.equal(knownExperimentKey("drop table"), null);
  assert.deepEqual(weightsFromFlag(null, DEFAULT_POPUP_WEIGHTS), DEFAULT_POPUP_WEIGHTS);
  // the same key always lands in the same arm
  const first = bucketVisitor("nhv_abcdefgh_1234", DEFAULT_POPUP_WEIGHTS);
  assert.equal(bucketVisitor("nhv_abcdefgh_1234", DEFAULT_POPUP_WEIGHTS), first);
  assert.ok(["email_gate", "instant_code"].includes(first!));
});

test("a beacon batch may carry assignments for other tests, shape-checked", () => {
  const batch = normalizeBeaconBatch({
    sessionKey: "nhs_session_key_1", visitorKey: "nhv_visitor_key_1", page: "/pages/novahair-sales-staging",
    variant: "control",
    experiments: { nova_popup_offer_v1: "instant_code", "bad key!": "x", ok_key: "bad variant!" },
    events: [{ kind: "popup", label: "offer instant_code", at: Date.now() }],
  });
  assert.deepEqual(batch.experiments, { nova_popup_offer_v1: "instant_code" });
  const bare = normalizeBeaconBatch({ sessionKey: "nhs_session_key_1", visitorKey: "nhv_visitor_key_1", page: "/", events: [{ kind: "view", label: "landed", at: Date.now() }] });
  assert.deepEqual(bare.experiments, {});
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildBotDecisionPlan, isToolAllowed } from "../src/lib/bot-orchestrator.js";

const models = [
  { id: "a", provider: "openai", model: "model-a", trafficBasisPoints: 5000 },
  { id: "b", provider: "google", model: "model-b", trafficBasisPoints: 5000 },
];

test("support route blocks sales tools and allows scoped order tools", () => {
  const plan = buildBotDecisionPlan({
    visitorKey: "visitor-1",
    models,
    signals: {
      pageType: "ORDER_TRACKING",
      customerMessages: 2,
      orderIssue: true,
      purchaseIntent: "HIGH",
      priceObjection: true,
    },
  });

  assert.equal(plan.route.role, "SUPPORT");
  assert.equal(plan.safeguards.canSell, false);
  assert.equal(plan.safeguards.canAccessOrders, true);
  assert.equal(plan.safeguards.canRequestOffer, false);
  assert.equal(plan.discount.action, "NO_OFFER");
  assert.equal(isToolAllowed("SUPPORT", "order.read_scoped"), true);
  assert.equal(isToolAllowed("SUPPORT", "offer.request"), false);
});

test("security route has no tools", () => {
  const plan = buildBotDecisionPlan({
    visitorKey: "visitor-2",
    models,
    signals: {
      pageType: "PRODUCT",
      customerMessages: 1,
      promptInjectionSuspected: true,
    },
  });

  assert.equal(plan.route.role, "SECURITY");
  assert.deepEqual(plan.allowedTools, []);
  assert.equal(plan.safeguards.canAccessOrders, false);
});

test("sales plan can request an approved offer only when deterministic policy passes", () => {
  const plan = buildBotDecisionPlan({
    visitorKey: "visitor-3",
    models,
    signals: {
      pageType: "FUNNEL",
      customerMessages: 4,
      productQuestion: true,
      purchaseIntent: "HIGH",
      priceObjection: true,
      cartValueIls: 200,
      contributionMarginBeforeDiscountIls: 100,
      minContributionMarginIls: 60,
    },
  });

  assert.equal(plan.route.role, "SALES");
  assert.equal(plan.safeguards.canRequestOffer, true);
  assert.equal(plan.discount.action, "OFFER_DISCOUNT");
  if (plan.discount.action === "OFFER_DISCOUNT") assert.equal(plan.discount.pct, 5);
});

test("model assignment is sticky for the same visitor key", () => {
  const one = buildBotDecisionPlan({
    visitorKey: "sticky-visitor",
    models,
    signals: { pageType: "PRODUCT", customerMessages: 1 },
  });
  const two = buildBotDecisionPlan({
    visitorKey: "sticky-visitor",
    models,
    signals: { pageType: "PRODUCT", customerMessages: 2 },
  });
  assert.equal(one.modelVariant.id, two.modelVariant.id);
});

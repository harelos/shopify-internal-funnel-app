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
    signals: { pageType: "ORDER_TRACKING", customerMessages: 2, orderIssue: true, purchaseIntent: "HIGH", priceObjection: true },
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
  const plan = buildBotDecisionPlan({ visitorKey: "visitor-2", models, signals: { pageType: "PRODUCT", customerMessages: 1, promptInjectionSuspected: true } });
  assert.equal(plan.route.role, "SECURITY");
  assert.deepEqual(plan.allowedTools, []);
  assert.equal(plan.safeguards.canAccessOrders, false);
});

test("sales plan can request an approved offer only when deterministic policy passes", () => {
  const plan = buildBotDecisionPlan({
    visitorKey: "visitor-3",
    models,
    signals: {
      pageType: "FUNNEL", customerMessages: 4, productQuestion: true, purchaseIntent: "HIGH", priceObjection: true,
      cartValueIls: 200, contributionMarginBeforeDiscountIls: 100, minContributionMarginIls: 60,
    },
  });
  assert.equal(plan.route.role, "SALES");
  assert.equal(plan.safeguards.canRequestOffer, true);
  assert.equal(plan.discount.action, "OFFER_DISCOUNT");
  if (plan.discount.action === "OFFER_DISCOUNT") assert.equal(plan.discount.pct, 5);
});

test("configured discount ladder is used instead of hard-coded defaults", () => {
  const plan = buildBotDecisionPlan({
    visitorKey: "discount-config",
    models,
    discountPolicy: { maxDiscountPct: 8, firstDiscountPct: 3, secondDiscountPct: 8, minMessagesBeforeDiscount: 2, minMessagesBeforeSecondDiscount: 6 },
    signals: {
      pageType: "PRODUCT", customerMessages: 3, productQuestion: true, purchaseIntent: "HIGH", priceObjection: true,
      cartValueIls: 300, contributionMarginBeforeDiscountIls: 150, minContributionMarginIls: 50,
    },
  });
  assert.equal(plan.discount.action, "OFFER_DISCOUNT");
  if (plan.discount.action === "OFFER_DISCOUNT") assert.equal(plan.discount.pct, 3);
});

test("disabling retention falls back to sales but never disables security", () => {
  const retention = buildBotDecisionPlan({
    visitorKey: "returning",
    models,
    routingPolicy: { support: true, retention: false, risk: true },
    signals: { pageType: "PRODUCT", customerMessages: 2, returningCustomer: true, productQuestion: true },
  });
  assert.equal(retention.route.role, "SALES");
  assert.equal(retention.route.reason, "RETENTION_DISABLED_FALLBACK_TO_SALES");

  const security = buildBotDecisionPlan({
    visitorKey: "attacker",
    models,
    routingPolicy: { support: false, retention: false, risk: false },
    signals: { pageType: "PRODUCT", customerMessages: 1, promptInjectionSuspected: true },
  });
  assert.equal(security.route.role, "SECURITY");
  assert.deepEqual(security.allowedTools, []);
});

test("disabled support escalates instead of falling back to sales", () => {
  const plan = buildBotDecisionPlan({
    visitorKey: "support-disabled",
    models,
    routingPolicy: { support: false, retention: true, risk: true },
    signals: { pageType: "ORDER_TRACKING", customerMessages: 2, orderIssue: true },
  });
  assert.equal(plan.route.role, "SUPPORT");
  assert.equal(plan.safeguards.canSell, false);
  assert.equal(plan.safeguards.requiresHumanEscalation, true);
  assert.equal(plan.discount.action, "NO_OFFER");
});

test("model assignment is sticky for the same visitor key", () => {
  const one = buildBotDecisionPlan({ visitorKey: "sticky-visitor", models, signals: { pageType: "PRODUCT", customerMessages: 1 } });
  const two = buildBotDecisionPlan({ visitorKey: "sticky-visitor", models, signals: { pageType: "PRODUCT", customerMessages: 2 } });
  assert.equal(one.modelVariant.id, two.modelVariant.id);
});

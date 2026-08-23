import test from "node:test";
import assert from "node:assert/strict";
import {
  assignModelVariant,
  decideDiscount,
  nextLeadField,
  routeBotConversation,
} from "../src/lib/bot-sales-brain.js";

test("active order problem routes to support and blocks selling", () => {
  const result = routeBotConversation({ pageType: "PRODUCT", customerMessages: 2, productQuestion: true, orderIssue: true });
  assert.equal(result.role, "SUPPORT");
  assert.equal(result.salesAllowed, false);
});

test("legal threat routes to risk with human escalation", () => {
  const result = routeBotConversation({ pageType: "POLICY", customerMessages: 1, legalThreat: true });
  assert.equal(result.role, "RISK");
  assert.equal(result.requiresHumanEscalation, true);
  assert.equal(result.salesAllowed, false);
});

test("returning customer with product intent routes to retention", () => {
  const result = routeBotConversation({ pageType: "PRODUCT", customerMessages: 3, returningCustomer: true, productQuestion: true });
  assert.equal(result.role, "RETENTION");
  assert.equal(result.salesAllowed, true);
});

test("default commerce conversation stays with sales", () => {
  const result = routeBotConversation({ pageType: "FUNNEL", customerMessages: 1, productQuestion: true });
  assert.equal(result.role, "SALES");
});

test("discount is blocked when attempted too early", () => {
  const result = decideDiscount({
    pageType: "PRODUCT",
    customerMessages: 1,
    productQuestion: true,
    priceObjection: true,
    purchaseIntent: "HIGH",
    cartValueIls: 239,
    contributionMarginBeforeDiscountIls: 100,
    minContributionMarginIls: 50,
  });
  assert.deepEqual(result, { action: "NO_OFFER", reason: "TOO_EARLY_FOR_DISCOUNT" });
});

test("first stage 5 percent save respects margin floor", () => {
  const result = decideDiscount({
    pageType: "PRODUCT",
    customerMessages: 4,
    productQuestion: true,
    priceObjection: true,
    purchaseIntent: "HIGH",
    cartValueIls: 200,
    contributionMarginBeforeDiscountIls: 80,
    minContributionMarginIls: 50,
  });
  assert.equal(result.action, "OFFER_DISCOUNT");
  if (result.action === "OFFER_DISCOUNT") {
    assert.equal(result.pct, 5);
    assert.equal(result.projectedMarginAfterDiscountIls, 70);
  }
});

test("second stage 10 percent save requires prior 5 percent refusal and enough conversation", () => {
  const result = decideDiscount({
    pageType: "CART",
    customerMessages: 6,
    productQuestion: true,
    priceObjection: true,
    purchaseIntent: "HIGH",
    priorDiscountPct: 5,
    declinedPriorOffer: true,
    cartValueIls: 200,
    contributionMarginBeforeDiscountIls: 70,
    minContributionMarginIls: 50,
  });
  assert.equal(result.action, "OFFER_DISCOUNT");
  if (result.action === "OFFER_DISCOUNT") assert.equal(result.pct, 10);
});

test("margin floor can veto a discount even with high purchase intent", () => {
  const result = decideDiscount({
    pageType: "CART",
    customerMessages: 5,
    priceObjection: true,
    purchaseIntent: "HIGH",
    cartValueIls: 300,
    contributionMarginBeforeDiscountIls: 55,
    minContributionMarginIls: 50,
  });
  assert.deepEqual(result, { action: "NO_OFFER", reason: "MARGIN_FLOOR_BLOCK" });
});

test("support conversation never receives an automatic sales discount", () => {
  const result = decideDiscount({
    pageType: "ORDER_TRACKING",
    customerMessages: 10,
    orderIssue: true,
    priceObjection: true,
    purchaseIntent: "HIGH",
    cartValueIls: 300,
    contributionMarginBeforeDiscountIls: 200,
    minContributionMarginIls: 10,
  });
  assert.deepEqual(result, { action: "NO_OFFER", reason: "SALES_NOT_ALLOWED_IN_CURRENT_ROUTE" });
});

test("lead capture is progressive instead of asking for every field at once", () => {
  assert.equal(nextLeadField({}, { customerMessages: 1 }), "NONE");
  assert.equal(nextLeadField({}, { customerMessages: 3 }), "NAME");
  assert.equal(nextLeadField({ name: "Dana" }, { customerMessages: 3, wantsCoupon: true }), "EMAIL");
  assert.equal(nextLeadField({ name: "Dana", email: "d@example.com" }, { customerMessages: 3, wantsCallback: true }), "PHONE");
});

test("model assignment is sticky for the same visitor", () => {
  const variants = [
    { id: "a", provider: "provider-a", model: "model-a", trafficBasisPoints: 5000 },
    { id: "b", provider: "provider-b", model: "model-b", trafficBasisPoints: 5000 },
  ];
  const first = assignModelVariant("visitor-123", variants);
  const second = assignModelVariant("visitor-123", variants);
  assert.equal(first.id, second.id);
});

test("model experiment traffic must total exactly 100 percent", () => {
  assert.throws(() => assignModelVariant("visitor-123", [
    { id: "a", provider: "provider-a", model: "model-a", trafficBasisPoints: 4000 },
    { id: "b", provider: "provider-b", model: "model-b", trafficBasisPoints: 4000 },
  ]));
});

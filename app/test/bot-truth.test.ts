import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_TRUTH_HIERARCHY,
  canExposeTruthToCustomer,
  requiresApprovedLookup,
  resolveBotTruth,
  type BotTruthCandidate,
} from "../src/lib/bot-truth.js";

function fact(authority: BotTruthCandidate["authority"], key: string, value: unknown, sourceId: string = authority): BotTruthCandidate {
  return { authority, key, value, sourceId };
}

test("truth hierarchy order is Shopify, knowledge, business rules, model prose", () => {
  assert.deepEqual(BOT_TRUTH_HIERARCHY.map(item => item.authority), [
    "SHOPIFY_STORE_FACT",
    "KNOWLEDGE_PACK",
    "BUSINESS_RULE",
    "MODEL_PROSE",
  ]);
});

test("Shopify fact beats conflicting lower-authority facts", () => {
  const result = resolveBotTruth("product_price", [
    fact("MODEL_PROSE", "product_price", 99),
    fact("BUSINESS_RULE", "product_price", 109),
    fact("KNOWLEDGE_PACK", "product_price", 119),
    fact("SHOPIFY_STORE_FACT", "product_price", 129, "shopify:variant:123"),
  ]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.candidate?.value, 129);
  assert.equal(result.candidate?.authority, "SHOPIFY_STORE_FACT");
  assert.equal(canExposeTruthToCustomer(result), true);
});

test("same-authority conflict becomes uncertain instead of guessing", () => {
  const result = resolveBotTruth("shipping_terms", [
    fact("KNOWLEDGE_PACK", "shipping_terms", "5-10 days", "pack:v4"),
    fact("KNOWLEDGE_PACK", "shipping_terms", "7-12 days", "pack:v5"),
  ]);
  assert.equal(result.status, "UNCERTAIN");
  assert.equal(result.candidate, null);
  assert.equal(result.conflictingCandidates.length, 2);
  assert.equal(requiresApprovedLookup("shipping_terms", result), true);
});

test("model prose can never become authoritative price or discount truth", () => {
  for (const key of ["product_price", "discount", "coupon_code", "guarantee", "inventory", "refund_policy"]) {
    const result = resolveBotTruth(key, [fact("MODEL_PROSE", key, "invented")]);
    assert.equal(result.status, "RESOLVED");
    assert.equal(canExposeTruthToCustomer(result), false, key);
    assert.equal(requiresApprovedLookup(key, result), true, key);
  }
});

test("missing restricted fact fails closed and requests approved lookup", () => {
  const result = resolveBotTruth("delivery_promise", []);
  assert.equal(result.status, "MISSING");
  assert.equal(canExposeTruthToCustomer(result), false);
  assert.equal(requiresApprovedLookup("delivery_promise", result), true);
});

test("internal economics are never customer-exposable", () => {
  const result = resolveBotTruth("supplier_cost", [fact("SHOPIFY_STORE_FACT", "supplier_cost", 24.4, "internal-ledger")]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(canExposeTruthToCustomer(result), false);
  assert.equal(requiresApprovedLookup("supplier_cost", result), false);
});

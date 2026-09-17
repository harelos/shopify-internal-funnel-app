import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CART_OFFER_CONFIG,
  discountPercentage,
  discountFixedAmount,
  validateCartOfferConfig,
} from "../src/lib/cart-offer-config.js";

test("production defaults contain the three compact NovaHair bump offers", () => {
  const result = validateCartOfferConfig(structuredClone(DEFAULT_CART_OFFER_CONFIG));
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(result.value.carousel, []);
  assert.deepEqual(result.value.bumps.map(item => item.variantId), [
    "gid://shopify/ProductVariant/52010595320103",
    "gid://shopify/ProductVariant/52010652401959",
    "gid://shopify/ProductVariant/50459892580647",
  ]);
  assert.deepEqual(result.value.bumps.map(item => item.priceIls), ["49.99", "44.99", "39.99"]);
  assert.deepEqual(result.value.bumps.map(item => item.compareAtIls), ["99.90", "89.90", "79.90"]);
  assert.equal(result.value.bumps[1].title, "סרום קרטין משקם");
});

test("normalizes ILS values and preserves independent copy fields", () => {
  const candidate = structuredClone(DEFAULT_CART_OFFER_CONFIG);
  candidate.bumps[0].priceIls = "₪49.9";
  candidate.bumps[0].compareAtIls = "100";
  candidate.bumps[0].anchorText = "מחיר מיוחד בסל";
  candidate.bumps[0].buttonText = "צרפי להזמנה";
  const result = validateCartOfferConfig(candidate);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.value.bumps[0].priceIls, "49.90");
  assert.equal(result.value.bumps[0].compareAtIls, "100.00");
  assert.equal(result.value.bumps[0].anchorText, "מחיר מיוחד בסל");
  assert.equal(result.value.bumps[0].buttonText, "צרפי להזמנה");
});

test("rejects invalid product bindings, prices, and unsafe images", () => {
  const candidate = structuredClone(DEFAULT_CART_OFFER_CONFIG);
  candidate.bumps[0].variantId = "50459892580647";
  candidate.bumps[0].priceIls = "free";
  candidate.bumps[0].imageUrl = "javascript:alert(1)";
  const result = validateCartOfferConfig(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes("variantId")));
  assert.ok(result.errors.some(error => error.includes("priceIls")));
  assert.ok(result.errors.some(error => error.includes("Shopify CDN")));
});

test("calculates the exact Shopify percentage needed for the ILS offer", () => {
  assert.equal(discountPercentage("100.84", "49.99"), 0.50426418);
  assert.equal(discountPercentage("19.90", "19.90"), 0);
  assert.throws(() => discountPercentage("39.99", "40.00"));
});

test("calculates an exact per-item fixed amount for the ILS offer", () => {
  assert.equal(discountFixedAmount("100.84", "49.99"), "50.85");
  assert.equal(discountFixedAmount("119.99", "39.99"), "80.00");
  assert.equal(discountFixedAmount("19.90", "19.90"), "");
  assert.throws(() => discountFixedAmount("39.99", "40.00"));
});

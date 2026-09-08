import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CART_OFFER_CONFIG,
  discountPercentage,
  discountFixedAmount,
  validateCartOfferConfig,
} from "../src/lib/cart-offer-config.js";

test("production defaults contain the mask instead of the scalp brush", () => {
  const result = validateCartOfferConfig(structuredClone(DEFAULT_CART_OFFER_CONFIG));
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.deepEqual(result.value.carousel.map(item => item.variantId), [
    "gid://shopify/ProductVariant/50459892580647",
    "gid://shopify/ProductVariant/52010595320103",
    "gid://shopify/ProductVariant/51885840400679",
  ]);
  assert.equal(result.value.carousel[1].title, "מסיכת הזנה לשיער");
  assert.equal(result.value.carousel[1].priceIls, "39.99");
});

test("normalizes ILS values and preserves independent copy fields", () => {
  const candidate = structuredClone(DEFAULT_CART_OFFER_CONFIG);
  candidate.carousel[0].priceIls = "₪29.9";
  candidate.carousel[0].compareAtIls = "120";
  candidate.carousel[0].anchorText = "מחיר מיוחד בסל";
  candidate.carousel[0].buttonText = "צרפי להזמנה";
  const result = validateCartOfferConfig(candidate);
  assert.equal(result.ok, true, result.errors.join("; "));
  assert.equal(result.value.carousel[0].priceIls, "29.90");
  assert.equal(result.value.carousel[0].compareAtIls, "120.00");
  assert.equal(result.value.carousel[0].anchorText, "מחיר מיוחד בסל");
  assert.equal(result.value.carousel[0].buttonText, "צרפי להזמנה");
});

test("rejects invalid product bindings, prices, and unsafe images", () => {
  const candidate = structuredClone(DEFAULT_CART_OFFER_CONFIG);
  candidate.carousel[0].variantId = "50459892580647";
  candidate.carousel[0].priceIls = "free";
  candidate.carousel[0].imageUrl = "javascript:alert(1)";
  const result = validateCartOfferConfig(candidate);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes("variantId")));
  assert.ok(result.errors.some(error => error.includes("priceIls")));
  assert.ok(result.errors.some(error => error.includes("Shopify CDN")));
});

test("calculates the exact Shopify percentage needed for the ILS offer", () => {
  assert.equal(discountPercentage("100.84", "39.99"), 0.60343118);
  assert.equal(discountPercentage("19.90", "19.90"), 0);
  assert.throws(() => discountPercentage("39.99", "40.00"));
});

test("calculates an exact per-item fixed amount for the ILS offer", () => {
  assert.equal(discountFixedAmount("100.84", "39.99"), "60.85");
  assert.equal(discountFixedAmount("119.99", "29.99"), "90.00");
  assert.equal(discountFixedAmount("19.90", "19.90"), "");
  assert.throws(() => discountFixedAmount("39.99", "40.00"));
});

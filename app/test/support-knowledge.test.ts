import assert from "node:assert/strict";
import test from "node:test";

import type { SupportKnowledgePack } from "../src/support/knowledge/contracts.js";
import {
  emptyKnowledgePack,
  findProduct,
  readProductFacts,
  readProductUsage,
  readShadeGuidance,
  readStorePolicy,
  validateKnowledgePack,
} from "../src/support/knowledge/store.js";

const syntheticPack: SupportKnowledgePack = {
  schemaVersion: 1,
  packId: "synthetic-test",
  version: "1.0.0",
  status: "APPROVED",
  effectiveFrom: "2026-08-24T00:00:00.000Z",
  policies: {
    shipping: {
      deliveryWindow: { state: "KNOWN", value: "TEST_WINDOW", source: "synthetic:test" },
      processingWindow: { state: "KNOWN", value: "TEST_PROCESSING", source: "synthetic:test" },
      freeShippingRule: { state: "UNKNOWN", source: "synthetic:test" },
      regions: { state: "KNOWN", value: ["TEST_REGION"], source: "synthetic:test" },
      customsAndDuties: { state: "UNKNOWN", source: "synthetic:test" },
    },
    returns: {
      eligibilityWindow: { state: "KNOWN", value: "TEST_RETURN_WINDOW", source: "synthetic:test" },
      exclusions: { state: "KNOWN", value: ["TEST_EXCLUSION"], source: "synthetic:test" },
      returnMethod: { state: "UNKNOWN", source: "synthetic:test" },
      refundTiming: { state: "UNKNOWN", source: "synthetic:test" },
    },
    guarantee: { state: "UNKNOWN", source: "synthetic:test" },
    supportContact: { state: "UNKNOWN", source: "synthetic:test" },
  },
  products: [
    {
      key: "test-product",
      title: "Test Product",
      aliases: ["tp"],
      usageInstructions: { state: "KNOWN", value: ["TEST_USAGE_STEP"], source: "synthetic:test" },
      productFacts: { state: "KNOWN", value: { material: "TEST_MATERIAL" }, source: "synthetic:test" },
      shadeGuidance: { state: "KNOWN", value: ["TEST_SHADE_RULE"], source: "synthetic:test" },
      faq: { state: "UNKNOWN", source: "synthetic:test" },
    },
  ],
};

test("unconfigured knowledge pack fails closed", () => {
  const pack = emptyKnowledgePack();
  const result = readStorePolicy(pack, "shipping.deliveryWindow");
  assert.equal(result.found, false);
  if (!result.found) assert.equal(result.reason, "PACK_NOT_APPROVED");
});

test("approved synthetic pack returns only explicitly known facts", () => {
  const delivery = readStorePolicy(syntheticPack, "shipping.deliveryWindow");
  assert.equal(delivery.found, true);
  if (delivery.found) assert.equal(delivery.value, "TEST_WINDOW");

  const freeShipping = readStorePolicy(syntheticPack, "shipping.freeShippingRule");
  assert.equal(freeShipping.found, false);
  if (!freeShipping.found) assert.equal(freeShipping.reason, "UNKNOWN_FACT");
});

test("product lookup uses exact key/title/alias rather than guessing", () => {
  assert.equal(findProduct(syntheticPack, "TP").found, true);
  const fuzzy = findProduct(syntheticPack, "test");
  assert.equal(fuzzy.found, false);
  if (!fuzzy.found) assert.equal(fuzzy.reason, "PRODUCT_NOT_FOUND");
});

test("product read tools expose approved usage, product and shade facts", () => {
  assert.equal(readProductUsage(syntheticPack, "test-product").found, true);
  assert.equal(readProductFacts(syntheticPack, "Test Product").found, true);
  assert.equal(readShadeGuidance(syntheticPack, "tp").found, true);
});

test("knowledge validation rejects KNOWN facts without values", () => {
  const broken = structuredClone(syntheticPack) as any;
  broken.policies.shipping.deliveryWindow = { state: "KNOWN", source: "synthetic:test" };
  assert.throws(() => validateKnowledgePack(broken), /KNOWN but has no value/);
});

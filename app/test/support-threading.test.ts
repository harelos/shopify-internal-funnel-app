import assert from "node:assert/strict";
import test from "node:test";

import { getSupportConfig } from "../src/support/config.js";
import { supportFixtureMessages } from "../src/support/fixture-source.js";
import { buildSupportThreads, normalizeSupportSubject } from "../src/support/threading.js";

test("support subject normalization removes reply prefixes", () => {
  assert.equal(normalizeSupportSubject("Re: FWD:  איפה המשלוח שלי? "), "איפה המשלוח שלי?");
});

test("support fixture reconstructs reply chain and classifies it", () => {
  const messages = supportFixtureMessages("support@example.test");
  const threads = buildSupportThreads(messages);
  const shipping = threads.find((thread) => thread.messages.some((message) => message.messageId === "fixture-shipping-1@example.test"));

  assert.ok(shipping);
  assert.equal(shipping.messages.length, 2);
  assert.equal(shipping.classification.category, "shipping_tracking");
  assert.equal(shipping.classification.requiresHuman, false);
});

test("support fixture marks refund and high urgency conversations for humans", () => {
  const threads = buildSupportThreads(supportFixtureMessages("support@example.test"));
  const refund = threads.find((thread) => thread.classification.category === "refund_return");
  const urgent = threads.find((thread) => thread.classification.urgency === "high");

  assert.ok(refund?.classification.requiresHuman);
  assert.ok(urgent?.classification.requiresHuman);
});

test("support config defaults to disabled fixture mode", () => {
  const config = getSupportConfig({} as NodeJS.ProcessEnv);
  assert.equal(config.stagingEnabled, false);
  assert.equal(config.syncSource, "fixture");
  assert.equal(config.sendEnabled, false);
  assert.equal(config.shopifyMutationEnabled, false);
});

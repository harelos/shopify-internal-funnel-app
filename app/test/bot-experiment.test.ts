import test from "node:test";
import assert from "node:assert/strict";
import { chooseConversationModel, type PersistedBotModelAssignment } from "../src/lib/bot-experiment.js";

const variants = [
  { id: "a", provider: "openai", model: "model-a", trafficBasisPoints: 5000 },
  { id: "b", provider: "gemini", model: "model-b", trafficBasisPoints: 5000 },
];

test("stored model assignment survives traffic allocation changes while model remains enabled", () => {
  const stored: PersistedBotModelAssignment = {
    conversationId: "conv-1",
    provider: "openai",
    model: "model-a",
    variantId: "a",
    configFingerprint: "old",
    assignedAt: "2026-08-23T00:00:00.000Z",
  };
  const changedWeights = [
    { id: "a-new", provider: "openai", model: "model-a", trafficBasisPoints: 1000 },
    { id: "b-new", provider: "gemini", model: "model-b", trafficBasisPoints: 9000 },
  ];
  const result = chooseConversationModel("visitor-1", changedWeights, stored);
  assert.equal(result.variant.provider, "openai");
  assert.equal(result.variant.model, "model-a");
  assert.equal(result.assignmentChanged, false);
});

test("assignment is deterministically reselected when its model is disabled", () => {
  const stored: PersistedBotModelAssignment = {
    conversationId: "conv-2",
    provider: "anthropic",
    model: "removed-model",
    variantId: "old",
    configFingerprint: "old",
    assignedAt: "2026-08-23T00:00:00.000Z",
  };
  const one = chooseConversationModel("visitor-sticky", variants, stored);
  const two = chooseConversationModel("visitor-sticky", variants, stored);
  assert.equal(one.assignmentChanged, true);
  assert.equal(two.assignmentChanged, true);
  assert.equal(one.variant.id, two.variant.id);
});

test("new conversations deterministically choose the same model for the same visitor key", () => {
  const one = chooseConversationModel("visitor-42", variants, null);
  const two = chooseConversationModel("visitor-42", variants, null);
  assert.equal(one.variant.id, two.variant.id);
  assert.equal(one.assignmentChanged, false);
});

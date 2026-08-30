import test from "node:test";
import assert from "node:assert/strict";
import { defaultBotConfigurationDraft, normalizeAndValidateBotConfiguration } from "../src/lib/bot-config-contract.js";

test("default bot configuration is valid", () => {
  const result = normalizeAndValidateBotConfiguration(defaultBotConfigurationDraft());
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.config?.models[0]?.provider, "mock");
});

test("model traffic must total exactly 100 percent", () => {
  const draft = defaultBotConfigurationDraft();
  draft.models = [
    { provider: "openai", model: "a", trafficPct: 40 },
    { provider: "google", model: "b", trafficPct: 40 },
  ];
  const result = normalizeAndValidateBotConfiguration(draft);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /100%/);
});

test("discount tiers cannot exceed configured cap", () => {
  const draft = defaultBotConfigurationDraft();
  draft.offers.firstPct = 15;
  draft.offers.maxPct = 10;
  const result = normalizeAndValidateBotConfiguration(draft);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /First discount tier/);
});

test("second discount cannot unlock before first tier", () => {
  const draft = defaultBotConfigurationDraft();
  draft.offers.firstMinMessages = 5;
  draft.offers.secondMinMessages = 3;
  const result = normalizeAndValidateBotConfiguration(draft);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /Second discount tier cannot unlock before/);
});

test("security hourly allowance cannot be below five minute allowance", () => {
  const draft = defaultBotConfigurationDraft();
  draft.security.messagesPer5m = 50;
  draft.security.messagesPerHour = 20;
  const result = normalizeAndValidateBotConfiguration(draft);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /Hourly message allowance/);
});

test("avatar requires HTTPS and valid URL syntax", () => {
  const draft = defaultBotConfigurationDraft();
  draft.identity.avatarUrl = "http://example.com/avatar.jpg";
  const bad = normalizeAndValidateBotConfiguration(draft);
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(" "), /Avatar URL/);

  draft.identity.avatarUrl = "https://cdn.example.com/avatar.jpg";
  const good = normalizeAndValidateBotConfiguration(draft);
  assert.equal(good.ok, true);
  assert.equal(good.config?.identity.avatarUrl, "https://cdn.example.com/avatar.jpg");
});

test("unknown or oversized input is normalized into bounded fields", () => {
  const result = normalizeAndValidateBotConfiguration({
    identity: { name: "x".repeat(200), label: "Digital assistant", welcome: "hello", placement: "all-funnels", subtitle: "s".repeat(300), trustLine: "t".repeat(500) },
    models: [{ provider: "x", model: "model", trafficPct: 100 }],
    offers: { firstPct: 5, secondPct: 10, maxPct: 10, firstMinMessages: 3, secondMinMessages: 5 },
    security: { messagesPer5m: 99999, messagesPerHour: 99999, maxUserChars: 999999 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.config?.identity.name.length, 80);
  assert.equal(result.config?.identity.subtitle?.length, 120);
  assert.equal(result.config?.identity.trustLine?.length, 180);
  assert.equal(result.config?.security.messagesPer5m, 500);
  assert.equal(result.config?.security.messagesPerHour, 5000);
  assert.equal(result.config?.security.maxUserChars, 20000);
});

import test from "node:test";
import assert from "node:assert/strict";
import { issueBotSessionToken, verifyBotSessionToken } from "../src/lib/bot-session-token.js";

const secret = "0123456789abcdef0123456789abcdef";

test("signed bot session token verifies for the expected shop", () => {
  const issued = issueBotSessionToken({ shopDomain: "example.myshopify.com", visitorId: "visitor-1", ttlSeconds: 600, secret });
  const claims = verifyBotSessionToken(issued.token, { expectedShopDomain: "example.myshopify.com", secret, nowSeconds: issued.claims.iat + 1 });
  assert.equal(claims.visitorId, "visitor-1");
  assert.equal(claims.shop, "example.myshopify.com");
});

test("tampered bot session token is rejected", () => {
  const issued = issueBotSessionToken({ shopDomain: "example.myshopify.com", secret });
  const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;
  assert.throws(() => verifyBotSessionToken(tampered, { expectedShopDomain: "example.myshopify.com", secret }), /signature/i);
});

test("bot session token cannot be replayed across shops", () => {
  const issued = issueBotSessionToken({ shopDomain: "example.myshopify.com", secret });
  assert.throws(() => verifyBotSessionToken(issued.token, { expectedShopDomain: "other.myshopify.com", secret }), /shop mismatch/i);
});

test("expired bot session token is rejected", () => {
  const issued = issueBotSessionToken({ shopDomain: "example.myshopify.com", ttlSeconds: 60, secret });
  assert.throws(() => verifyBotSessionToken(issued.token, { expectedShopDomain: "example.myshopify.com", secret, nowSeconds: issued.claims.exp + 1 }), /expired/i);
});

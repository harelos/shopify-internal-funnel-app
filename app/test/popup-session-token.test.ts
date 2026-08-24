import test from "node:test";
import assert from "node:assert/strict";
import {
  issuePopupSessionToken,
  issuePopupVisitorToken,
  verifyPopupIdentityToken,
} from "../src/lib/popup-session-token.js";

const SECRET = "test-popup-session-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const SHOP = "tigerbrandsglobal.myshopify.com";
const NOW = 1_787_536_800;

test("visitor token is shop-bound and round-trips with server-created identity", () => {
  const issued = issuePopupVisitorToken({ shopDomain: SHOP, secret: SECRET, nowSeconds: NOW, ttlSeconds: 3600 });
  const verified = verifyPopupIdentityToken(issued.token, {
    expectedShopDomain: SHOP,
    expectedKind: "visitor",
    secret: SECRET,
    nowSeconds: NOW + 10,
  });
  assert.equal(verified.kind, "visitor");
  assert.equal(verified.visitorId, issued.claims.visitorId);
  assert.equal(verified.shop, SHOP);
});

test("session token is tied to the verified visitor and contains a server session id", () => {
  const visitor = issuePopupVisitorToken({ shopDomain: SHOP, secret: SECRET, nowSeconds: NOW });
  const session = issuePopupSessionToken({
    shopDomain: SHOP,
    visitorId: visitor.claims.visitorId,
    secret: SECRET,
    nowSeconds: NOW,
  });
  const verified = verifyPopupIdentityToken(session.token, {
    expectedShopDomain: SHOP,
    expectedKind: "session",
    secret: SECRET,
    nowSeconds: NOW + 10,
  });
  assert.equal(verified.kind, "session");
  if (verified.kind !== "session") throw new Error("Expected session claims");
  assert.equal(verified.visitorId, visitor.claims.visitorId);
  assert.ok(verified.sessionId.length > 10);
});

test("token cannot be reused for a different shop or token kind", () => {
  const visitor = issuePopupVisitorToken({ shopDomain: SHOP, secret: SECRET, nowSeconds: NOW });
  assert.throws(() => verifyPopupIdentityToken(visitor.token, {
    expectedShopDomain: "other-shop.myshopify.com",
    expectedKind: "visitor",
    secret: SECRET,
    nowSeconds: NOW + 1,
  }), /shop mismatch/i);
  assert.throws(() => verifyPopupIdentityToken(visitor.token, {
    expectedShopDomain: SHOP,
    expectedKind: "session",
    secret: SECRET,
    nowSeconds: NOW + 1,
  }), /kind mismatch/i);
});

test("signature mutation is rejected", () => {
  const issued = issuePopupVisitorToken({ shopDomain: SHOP, secret: SECRET, nowSeconds: NOW });
  const [body, signature] = issued.token.split(".");
  const replacement = signature.endsWith("A") ? "B" : "A";
  const tampered = `${body}.${signature.slice(0, -1)}${replacement}`;
  assert.throws(() => verifyPopupIdentityToken(tampered, {
    expectedShopDomain: SHOP,
    expectedKind: "visitor",
    secret: SECRET,
    nowSeconds: NOW + 1,
  }), /signature/i);
});

test("expired tokens are rejected", () => {
  const issued = issuePopupSessionToken({
    shopDomain: SHOP,
    visitorId: "visitor-expiry-test",
    secret: SECRET,
    nowSeconds: NOW,
    ttlSeconds: 300,
  });
  assert.throws(() => verifyPopupIdentityToken(issued.token, {
    expectedShopDomain: SHOP,
    expectedKind: "session",
    secret: SECRET,
    nowSeconds: NOW + 301,
  }), /expired/i);
});

test("secret must meet minimum strength boundary", () => {
  assert.throws(() => issuePopupVisitorToken({ shopDomain: SHOP, secret: "too-short", nowSeconds: NOW }), /at least 32/i);
});

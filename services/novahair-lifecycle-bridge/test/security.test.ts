import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  decryptSensitive,
  encryptSensitive,
  hashEmail,
  hmacSha256Base64,
  verifyShopifyHmac,
  verifySvixSignature,
} from "../src/crypto";
import { appendLifecycleUtm, assertRecoveryIdentityPreserved, safeStorefrontUrl } from "../src/url";

test("UTMs preserve every original recovery query value and fragment", () => {
  const original = "https://jacobfelipe.myshopify.com/checkouts/cn/abc/recover?key=sensitive-token&locale=he&item=1&item=2#payment";
  const result = appendLifecycleUtm(original, "abandoned_checkout", "e01_checkout_reminder");
  assert.doesNotThrow(() => assertRecoveryIdentityPreserved(original, result.url));
  const parsed = new URL(result.url);
  assert.equal(parsed.searchParams.get("key"), "sensitive-token");
  assert.deepEqual(parsed.searchParams.getAll("item"), ["1", "2"]);
  assert.equal(parsed.hash, "#payment");
  assert.equal(parsed.searchParams.get("utm_source"), "resend");
  assert.equal(parsed.searchParams.get("utm_medium"), "email");
  assert.equal(parsed.searchParams.get("utm_campaign"), "novahair_abandoned_checkout");
  assert.equal(parsed.searchParams.get("utm_content"), "e01_checkout_reminder");
});

test("UTM fields contain no recipient PII or recovery secret", () => {
  const original = "https://example.com/recover?token=top-secret";
  const result = appendLifecycleUtm(original, "welcome", "e05_shade_guide");
  const parsed = new URL(result.url);
  const utms = [...parsed.searchParams.entries()].filter(([key]) => key.startsWith("utm_"));
  assert.ok(utms.every(([, value]) => !value.includes("@") && !value.includes("top-secret")));
});

test("sensitive recovery URLs encrypt with AES-GCM and hashes are deterministic", async () => {
  const secret = "test-only-secret";
  const recovery = "https://example.com/recover?token=sensitive";
  const encrypted = await encryptSensitive(recovery, secret);
  assert.notEqual(encrypted, recovery);
  assert.ok(!encrypted.includes("sensitive"));
  assert.equal(await decryptSensitive(encrypted, secret), recovery);
  assert.equal(await hashEmail("Test@Example.com", secret), await hashEmail(" test@example.com ", secret));
  await assert.rejects(() => decryptSensitive(encrypted, "wrong-secret"));
});

test("Shopify and Svix signatures validate raw payloads and reject tampering", async () => {
  const body = JSON.stringify({ id: 123, email: "redacted@example.com" });
  const shopifySecret = "shopify-secret";
  const hmac = await hmacSha256Base64(shopifySecret, body);
  assert.equal(await verifyShopifyHmac(body, hmac, shopifySecret), true);
  assert.equal(await verifyShopifyHmac(`${body} `, hmac, shopifySecret), false);

  const svixBytes = Buffer.from("01234567890123456789012345678901");
  const svixSecret = `whsec_${svixBytes.toString("base64")}`;
  const id = "msg_test_1";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", svixBytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  assert.equal(await verifySvixSignature({ rawBody: body, id, timestamp, signature: `v1,${signature}`, secret: svixSecret }), true);
  assert.equal(await verifySvixSignature({ rawBody: `${body}x`, id, timestamp, signature: `v1,${signature}`, secret: svixSecret }), false);
});

test("storefront URL allowlist parser rejects unsafe hosts and protocols", () => {
  assert.equal(safeStorefrontUrl("tigerbrandsglobal.com", "/pages/novahair-sales"), "https://tigerbrandsglobal.com/pages/novahair-sales");
  assert.throws(() => safeStorefrontUrl("tigerbrandsglobal.com/path", "/"));
});

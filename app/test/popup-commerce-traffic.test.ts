import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCommerceTraffic,
  commerceTrafficGateAllows,
  DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY,
} from "../src/lib/popup-commerce-traffic.js";

function base(overrides: Record<string, unknown> = {}) {
  return {
    countryCode: "IL",
    pagePath: "/products/novahair",
    trafficSource: "facebook",
    utmSource: "facebook",
    utmMedium: "paid_social",
    humanLike: true,
    suspectedBot: false,
    explicitIntent: "commerce" as const,
    ...overrides,
  };
}

test("Israeli Meta product traffic is qualified paid commerce", () => {
  const result = classifyCommerceTraffic(base());
  assert.equal(result.decision, "QUALIFIED");
  assert.equal(result.class, "QUALIFIED_PAID_COMMERCE");
  assert.equal(result.verification, "COMPLETE");
  assert.equal(result.countryCode, "IL");
});

test("internal and test sessions are excluded before commercial signals", () => {
  const internal = classifyCommerceTraffic(base({ isInternalSession: true }));
  const testSession = classifyCommerceTraffic(base({ isTestSession: true }));
  assert.equal(internal.class, "EXCLUDED_INTERNAL_TEST");
  assert.equal(testSession.class, "EXCLUDED_INTERNAL_TEST");
  assert.equal(internal.isQualified, false);
});

test("bot or scanner evidence excludes otherwise strong paid traffic", () => {
  const result = classifyCommerceTraffic(base({ suspectedBot: true }));
  assert.equal(result.class, "EXCLUDED_BOT_OR_SCANNER");
  assert.equal(result.decision, "EXCLUDED");
});

test("support, tracking and unsubscribe contexts are excluded", () => {
  assert.equal(classifyCommerceTraffic(base({ pagePath: "/pages/contact", explicitIntent: "unknown" })).class, "EXCLUDED_SUPPORT");
  assert.equal(classifyCommerceTraffic(base({ pagePath: "/pages/track-order", explicitIntent: "unknown" })).class, "EXCLUDED_ORDER_TRACKING");
  assert.equal(classifyCommerceTraffic(base({ pagePath: "/unsubscribe", explicitIntent: "unknown" })).class, "EXCLUDED_UNSUBSCRIBE");
});

test("non-target country traffic is excluded when country is known", () => {
  const result = classifyCommerceTraffic(base({ countryCode: "US" }));
  assert.equal(result.class, "EXCLUDED_NON_TARGET_MARKET");
  assert.deepEqual(DEFAULT_TIGER_COMMERCE_TRAFFIC_POLICY.targetCountries, ["IL"]);
});

test("policy and non-commercial content do not enter the commerce baseline", () => {
  const policy = classifyCommerceTraffic(base({ pagePath: "/policies/privacy-policy", explicitIntent: "unknown" }));
  const content = classifyCommerceTraffic(base({ pagePath: "/blogs/news/article", explicitIntent: "unknown", commercialIntent: null }));
  assert.equal(policy.class, "NON_COMMERCIAL");
  assert.equal(content.class, "NON_COMMERCIAL");
});

test("returning proven buyers get their own qualified class", () => {
  const result = classifyCommerceTraffic(base({ hasPurchaseHistory: true, trafficSource: null, utmSource: null, utmMedium: null }));
  assert.equal(result.class, "QUALIFIED_RETURNING_CUSTOMER_COMMERCE");
});

test("email, organic and direct commerce remain distinct", () => {
  const email = classifyCommerceTraffic(base({ trafficSource: "shopify_email", utmSource: "newsletter", utmMedium: "email" }));
  const organic = classifyCommerceTraffic(base({ trafficSource: null, utmSource: null, utmMedium: "organic", referrer: "https://www.google.com/" }));
  const direct = classifyCommerceTraffic(base({ trafficSource: null, utmSource: null, utmMedium: null, referrer: null }));
  assert.equal(email.class, "QUALIFIED_EMAIL_COMMERCE");
  assert.equal(organic.class, "QUALIFIED_ORGANIC_COMMERCE");
  assert.equal(direct.class, "QUALIFIED_DIRECT_COMMERCE");
});

test("unknown commerciality stays unknown instead of being guessed", () => {
  const result = classifyCommerceTraffic(base({ pagePath: "/mystery", explicitIntent: "unknown", commercialIntent: null }));
  assert.equal(result.decision, "UNKNOWN");
  assert.equal(result.class, "UNKNOWN");
  assert.equal(result.isQualified, false);
});

test("gate modes distinguish known-bad exclusion from strict qualification", () => {
  const unknown = classifyCommerceTraffic(base({ pagePath: "/mystery", explicitIntent: "unknown", commercialIntent: null }));
  const excluded = classifyCommerceTraffic(base({ pagePath: "/pages/contact", explicitIntent: "unknown" }));
  assert.equal(commerceTrafficGateAllows("exclude_known_bad", unknown), true);
  assert.equal(commerceTrafficGateAllows("qualified_only", unknown), false);
  assert.equal(commerceTrafficGateAllows("exclude_known_bad", excluded), false);
  assert.equal(commerceTrafficGateAllows("off", excluded), true);
});

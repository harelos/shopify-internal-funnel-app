import test from "node:test";
import assert from "node:assert/strict";
import { buildQualifiedCommerceSummary, reconstructCommerceSessions, type CommerceEventInput } from "../src/lib/qualified-commerce.js";

const policy = { targetCountries: ["IL"], sessionTimeoutMinutes: 30 };

function event(id: string, at: string, overrides: Partial<CommerceEventInput> = {}): CommerceEventInput {
  return {
    id,
    name: "page_view",
    source: "STOREFRONT",
    occurredAt: at,
    visitorId: "visitor-1",
    isTest: false,
    payload: { landingPath: "/products/novahair", countryCode: "IL", sessionId: "s1" },
    ...overrides,
  };
}

test("target-country commercial product session is qualified", () => {
  const result = buildQualifiedCommerceSummary([event("e1", "2026-08-24T10:00:00Z")], [], [], policy);
  assert.equal(result.metrics.qualifiedSessions, 1);
  assert.equal(result.sessions[0].qualification.status, "QUALIFIED");
  assert.equal(result.sessions[0].qualification.reason, "TARGET_GEO_COMMERCIAL");
});

test("missing geo remains unknown instead of being silently counted as qualified", () => {
  const result = buildQualifiedCommerceSummary([
    event("e1", "2026-08-24T10:00:00Z", { payload: { landingPath: "/products/novahair", sessionId: "s1" } }),
  ], [], [], policy);
  assert.equal(result.metrics.qualifiedSessions, 0);
  assert.equal(result.metrics.unknownSessions, 1);
  assert.equal(result.sessions[0].qualification.reason, "MISSING_GEO");
});

test("non-target geo is excluded from qualified-commerce denominator", () => {
  const result = buildQualifiedCommerceSummary([
    event("e1", "2026-08-24T10:00:00Z", { payload: { landingPath: "/products/novahair", countryCode: "US", sessionId: "s1" } }),
  ], [], [], policy);
  assert.equal(result.metrics.excludedSessions, 1);
  assert.equal(result.sessions[0].qualification.reason, "NON_TARGET_GEO");
});

test("support, unsubscribe, policy, tracking and direct checkout landings are excluded", () => {
  const paths = [
    ["/contact", "SUPPORT_ENTRY"],
    ["/pages/order-tracking", "ORDER_TRACKING_ENTRY"],
    ["/apps/seguno/unsubscribe", "UNSUBSCRIBE_ENTRY"],
    ["/policies/privacy-policy", "POLICY_ENTRY"],
    ["/checkout", "CART_OR_CHECKOUT_ENTRY"],
  ] as const;
  paths.forEach(([landingPath, reason], index) => {
    const result = buildQualifiedCommerceSummary([
      event(`e${index}`, `2026-08-24T10:0${index}:00Z`, { payload: { landingPath, countryCode: "IL", sessionId: `s${index}` } }),
    ], [], [], policy);
    assert.equal(result.sessions[0].qualification.status, "EXCLUDED", landingPath);
    assert.equal(result.sessions[0].qualification.reason, reason, landingPath);
  });
});

test("explicit test and bot traffic fail closed", () => {
  const testTraffic = buildQualifiedCommerceSummary([
    event("e1", "2026-08-24T10:00:00Z", { isTest: true }),
  ], [], [], policy);
  assert.equal(testTraffic.sessions[0].qualification.reason, "INTERNAL_OR_TEST");

  const botTraffic = buildQualifiedCommerceSummary([
    event("e2", "2026-08-24T10:00:00Z", { payload: { landingPath: "/products/novahair", countryCode: "IL", sessionId: "s2", userAgent: "Googlebot/2.1" } }),
  ], [], [], policy);
  assert.equal(botTraffic.sessions[0].qualification.reason, "AUTOMATION_NOISE");
});

test("explicit session id keeps checkout and purchase in one session", () => {
  const events: CommerceEventInput[] = [
    event("e1", "2026-08-24T10:00:00Z"),
    event("e2", "2026-08-24T10:05:00Z", { name: "checkout_started", checkoutToken: "chk-1", payload: { pagePath: "/products/novahair", countryCode: "IL", sessionId: "s1" } }),
  ];
  const summary = buildQualifiedCommerceSummary(events, [
    { checkoutToken: "chk-1", visitorId: "visitor-1", startedAt: "2026-08-24T10:05:00Z", completedAt: "2026-08-24T10:08:00Z" },
  ], [
    { id: "o1", checkoutToken: "chk-1", paidAt: "2026-08-24T10:08:30Z", netRevenueAmount: 219, status: "PAID" },
  ], policy);
  assert.equal(summary.metrics.qualifiedSessions, 1);
  assert.equal(summary.metrics.qualifiedCheckoutSessions, 1);
  assert.equal(summary.metrics.qualifiedPurchaseSessions, 1);
  assert.equal(summary.metrics.qualifiedOrders, 1);
  assert.equal(summary.metrics.qualifiedRevenue, 219);
  assert.equal(summary.metrics.landingToCheckoutPct, 100);
  assert.equal(summary.metrics.checkoutToPurchasePct, 100);
  assert.equal(summary.metrics.landingToPurchasePct, 100);
  assert.equal(summary.metrics.revenuePerQualifiedSession, 219);
});

test("visitor fallback splits sessions after inactivity timeout", () => {
  const events: CommerceEventInput[] = [
    event("e1", "2026-08-24T10:00:00Z", { payload: { landingPath: "/products/novahair", countryCode: "IL" } }),
    event("e2", "2026-08-24T10:10:00Z", { payload: { pagePath: "/products/novahair", countryCode: "IL" } }),
    event("e3", "2026-08-24T11:00:00Z", { payload: { landingPath: "/products/novahair", countryCode: "IL" } }),
  ];
  const reconstructed = reconstructCommerceSessions(events, [], [], policy);
  assert.equal(reconstructed.sessions.length, 2);
});

test("orders without a checkout-token session stay unattributed instead of inflating qualified conversion", () => {
  const summary = buildQualifiedCommerceSummary([
    event("e1", "2026-08-24T10:00:00Z"),
  ], [], [
    { id: "o1", checkoutToken: null, paidAt: "2026-08-24T10:10:00Z", netRevenueAmount: 129, status: "PAID" },
  ], policy);
  assert.equal(summary.metrics.qualifiedPurchaseSessions, 0);
  assert.equal(summary.metrics.unattributedOrders, 1);
  assert.equal(summary.metrics.unattributedRevenue, 129);
});

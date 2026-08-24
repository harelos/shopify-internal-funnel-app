import test from "node:test";
import assert from "node:assert/strict";
import { classifyCommerceTraffic } from "../src/lib/popup-commerce-traffic.js";
import {
  classifyPopupBrowser,
  edgeCountryFromHeaders,
  normalizePopupSessionContext,
  toPopupEligibilityContext,
} from "../src/lib/popup-session-context.js";

const INSTAGRAM_ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 340.0.0.0";
const FACEBOOK_IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/500.0.0.0]";

function base(overrides: Record<string, unknown> = {}) {
  return {
    pageUrl: "https://example.com/products/novahair?utm_source=facebook",
    pagePath: "/products/novahair",
    landingPath: "/products/novahair",
    referrer: "https://www.facebook.com/",
    userAgent: INSTAGRAM_ANDROID_UA,
    language: "he-IL",
    viewportWidth: 390,
    viewportHeight: 844,
    anonymousVisitorState: "new" as const,
    explicitIntent: "commerce" as const,
    commercialIntent: true,
    acquisition: {
      utmSource: "facebook",
      utmMedium: "paid_social",
      utmCampaign: "novahair-relaunch",
      adId: "120248307353480135",
      adsetId: "adset-1",
      campaignId: "campaign-1",
      creativeId: "creative-1",
      fbclid: "fbclid-value",
    },
    behavior: { interactionCount: 3, maxScrollDepthPct: 72, activeMs: 54000, visibilityChanges: 1 },
    ...overrides,
  };
}

test("edge country is server-derived and test country is opt-in only", () => {
  assert.deepEqual(edgeCountryFromHeaders({ "cf-ipcountry": "il" }), { countryCode: "IL", source: "EDGE_HEADER" });
  assert.deepEqual(edgeCountryFromHeaders({ "x-tiger-test-country": "US" }, false), { countryCode: null, source: "UNKNOWN" });
  assert.deepEqual(edgeCountryFromHeaders({ "x-tiger-test-country": "US" }, true), { countryCode: "US", source: "TEST_HEADER" });
});

test("Meta in-app browsers are first-class environments", () => {
  const instagram = classifyPopupBrowser(INSTAGRAM_ANDROID_UA);
  const facebook = classifyPopupBrowser(FACEBOOK_IOS_UA);
  assert.equal(instagram.metaEnvironment, "INSTAGRAM_ANDROID_IN_APP");
  assert.equal(instagram.isMobile, true);
  assert.equal(facebook.metaEnvironment, "FACEBOOK_IOS_IN_APP");
  assert.equal(facebook.browserFamily, "SAFARI_IOS");
});

test("normalized context preserves acquisition quality dimensions and derives human evidence", () => {
  const result = normalizePopupSessionContext(base(), { headers: { "cf-ipcountry": "IL" } });
  assert.equal(result.countryCode, "IL");
  assert.equal(result.countrySource, "EDGE_HEADER");
  assert.equal(result.trafficSource, "facebook");
  assert.equal(result.adId, "120248307353480135");
  assert.equal(result.creativeId, "creative-1");
  assert.equal(result.metaEnvironment, "INSTAGRAM_ANDROID_IN_APP");
  assert.equal(result.humanLike, true);
  assert.equal(result.humanEvidence, "CLIENT_INTERACTION");
  assert.equal(result.customerStateVerified, false);
  assert.equal(result.hasPurchaseHistory, null);
});

test("client input cannot self-declare purchase history or known-customer truth", () => {
  const forged = {
    ...base(),
    hasPurchaseHistory: true,
    customerId: "gid://shopify/Customer/123",
    visitorState: "known",
  } as any;
  const result = normalizePopupSessionContext(forged, { headers: { "cf-ipcountry": "IL" } });
  assert.equal(result.hasPurchaseHistory, null);
  assert.equal(result.customerStateVerified, false);
  assert.equal(result.visitorState, "new");
});

test("only server customer context can promote a visitor to verified known/returning state", () => {
  const result = normalizePopupSessionContext(base(), {
    headers: { "cf-ipcountry": "IL" },
    serverCustomer: {
      verified: true,
      hasPurchaseHistory: true,
      visitorState: "known",
      source: "SHOPIFY_READ_ONLY",
    },
  });
  assert.equal(result.customerStateVerified, true);
  assert.equal(result.hasPurchaseHistory, true);
  assert.equal(result.visitorState, "known");
  assert.equal(result.customerStateSource, "SHOPIFY_READ_ONLY");
});

test("automation UA overrides fake interaction evidence", () => {
  const result = normalizePopupSessionContext(base({ userAgent: "Mozilla/5.0 HeadlessChrome/128.0", behavior: { interactionCount: 50 } }), {
    headers: { "cf-ipcountry": "IL" },
  });
  assert.equal(result.suspectedBot, true);
  assert.equal(result.humanLike, false);
  assert.equal(result.humanEvidence, "AUTOMATION_UA");
});

test("collector output feeds popup QCT without inventing missing geo", () => {
  const qualified = normalizePopupSessionContext(base(), { headers: { "cf-ipcountry": "IL" } });
  const qct = classifyCommerceTraffic(toPopupEligibilityContext(qualified), { version: 1, targetCountries: ["IL"] });
  assert.equal(qct.decision, "QUALIFIED");
  assert.equal(qct.class, "QUALIFIED_PAID_COMMERCE");

  const missingGeo = normalizePopupSessionContext(base(), { headers: {} });
  const partial = classifyCommerceTraffic(toPopupEligibilityContext(missingGeo), { version: 1, targetCountries: ["IL"] });
  assert.equal(partial.countryCode, null);
  assert.equal(partial.verification, "PARTIAL");
});

test("internal test markers are exclusion signals, not customer identity", () => {
  const result = normalizePopupSessionContext(base({ clientInternalTest: true, clientTestReason: "query_marker" }), {
    headers: { "cf-ipcountry": "IL" },
  });
  const qct = classifyCommerceTraffic(toPopupEligibilityContext(result), { version: 1, targetCountries: ["IL"] });
  assert.equal(result.isInternalSession, true);
  assert.equal(qct.class, "EXCLUDED_INTERNAL_TEST");
});

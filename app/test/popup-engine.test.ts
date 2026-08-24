import test from "node:test";
import assert from "node:assert/strict";
import { defaultPopupCampaign } from "../src/lib/popup-config-contract.js";
import { assignPopupVariant, evaluatePopupEligibility } from "../src/lib/popup-engine.js";

function context(overrides: Record<string, unknown> = {}) {
  return {
    visitorId: "visitor-1",
    sessionId: "session-1",
    sessionElapsedMs: 25_000,
    scrollDepthPct: 75,
    inactiveMs: 40_000,
    pagePath: "/products/novahair",
    countryCode: "IL",
    humanLike: true,
    suspectedBot: false,
    trafficSource: "facebook",
    utmMedium: "paid_social",
    explicitIntent: "commerce" as const,
    visitorState: "new" as const,
    cartItemCount: 0,
    sessionImpressions: 0,
    visitorDayImpressions: 0,
    ...overrides,
  };
}

test("sticky assignment returns the same variant for the same visitor and experiment version", () => {
  const campaign = defaultPopupCampaign();
  const one = assignPopupVariant(campaign, "visitor-sticky");
  const two = assignPopupVariant(campaign, "visitor-sticky");
  assert.equal(one.bucket, two.bucket);
  assert.equal(one.variant.key, two.variant.key);
});

test("time trigger evaluates only after the configured threshold", () => {
  const campaign = defaultPopupCampaign();
  campaign.trigger.mode = "time";
  campaign.trigger.seconds = 20;
  assert.equal(evaluatePopupEligibility(campaign, context({ sessionElapsedMs: 19_999 })).eligible, false);
  assert.equal(evaluatePopupEligibility(campaign, context({ sessionElapsedMs: 20_000 })).eligible, true);
});

test("desktop exit intent never fires on mobile when desktopExitOnly is enabled", () => {
  const campaign = defaultPopupCampaign();
  campaign.trigger.mode = "exit";
  campaign.trigger.desktopExitOnly = true;
  const mobile = evaluatePopupEligibility(campaign, context({ isMobile: true, exitIntent: true }));
  const desktop = evaluatePopupEligibility(campaign, context({ isMobile: false, exitIntent: true }));
  assert.equal(mobile.eligible, false);
  assert.equal(mobile.reason, "trigger_not_satisfied");
  assert.equal(desktop.eligible, true);
});

test("known-bad commerce traffic is suppressed before normal popup targeting", () => {
  const campaign = defaultPopupCampaign();
  const support = evaluatePopupEligibility(campaign, context({ pagePath: "/pages/contact", explicitIntent: "support" }));
  const bot = evaluatePopupEligibility(campaign, context({ suspectedBot: true }));
  const foreign = evaluatePopupEligibility(campaign, context({ countryCode: "US" }));

  assert.equal(support.eligible, false);
  assert.equal(support.reason, "commerce_traffic_excluded");
  assert.equal(support.commerceTraffic.class, "EXCLUDED_SUPPORT");
  assert.equal(bot.commerceTraffic.class, "EXCLUDED_BOT_OR_SCANNER");
  assert.equal(foreign.commerceTraffic.class, "EXCLUDED_NON_TARGET_MARKET");
});

test("strict qualified-only mode blocks unknown commerce intent without guessing", () => {
  const campaign = defaultPopupCampaign();
  campaign.targeting.commerceTrafficMode = "qualified_only";
  const result = evaluatePopupEligibility(campaign, context({
    pagePath: "/mystery",
    explicitIntent: "unknown",
    commercialIntent: null,
  }));
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "commerce_traffic_not_qualified");
  assert.equal(result.commerceTraffic.class, "UNKNOWN");
});

test("close suppression and impression caps block repetitive popups", () => {
  const campaign = defaultPopupCampaign();
  const now = Date.parse("2026-08-24T00:00:00Z");
  const recentlyClosed = evaluatePopupEligibility(campaign, context({
    nowMs: now,
    previousCloseAtMs: now - 10 * 60_000,
  }));
  assert.equal(recentlyClosed.eligible, false);
  assert.equal(recentlyClosed.reason, "close_suppression");

  const capped = evaluatePopupEligibility(campaign, context({ sessionImpressions: 1 }));
  assert.equal(capped.eligible, false);
  assert.equal(capped.reason, "session_frequency_cap");
});

test("path, UTM and cart targeting must all match", () => {
  const campaign = defaultPopupCampaign();
  campaign.targeting.includePaths = ["/products/*"];
  campaign.targeting.utmSources = ["facebook"];
  campaign.targeting.requireCartItems = true;

  assert.equal(evaluatePopupEligibility(campaign, context({ utmSource: "facebook", cartItemCount: 1 })).eligible, true);
  assert.equal(evaluatePopupEligibility(campaign, context({ utmSource: "google", cartItemCount: 1 })).reason, "utm_not_targeted");
  assert.equal(evaluatePopupEligibility(campaign, context({ utmSource: "facebook", cartItemCount: 0 })).reason, "cart_required");
  assert.equal(evaluatePopupEligibility(campaign, context({ pagePath: "/collections/all", utmSource: "facebook", cartItemCount: 1 })).reason, "path_not_targeted");
});

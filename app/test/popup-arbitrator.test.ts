import test from "node:test";
import assert from "node:assert/strict";
import { defaultPopupCampaign } from "../src/lib/popup-config-contract.js";
import { arbitratePopupCampaigns, type PopupArbitrationContext } from "../src/lib/popup-arbitrator.js";

function context(overrides: Partial<PopupArbitrationContext> = {}): PopupArbitrationContext {
  return {
    visitorId: "visitor-arb-1",
    sessionId: "session-arb-1",
    sessionElapsedMs: 30_000,
    scrollDepthPct: 70,
    inactiveMs: 40_000,
    pagePath: "/products/novahair",
    pageRole: "product",
    countryCode: "IL",
    humanLike: true,
    suspectedBot: false,
    trafficSource: "facebook",
    utmMedium: "paid_social",
    explicitIntent: "commerce",
    visitorState: "new",
    cartItemCount: 0,
    sessionImpressions: 0,
    visitorDayImpressions: 0,
    ...overrides,
  };
}

function campaign(key: string, priority: number, type: ReturnType<typeof defaultPopupCampaign>["type"] = "lead_capture") {
  const value = defaultPopupCampaign();
  value.key = key;
  value.name = key;
  value.type = type;
  value.delivery.priority = priority;
  return value;
}

test("highest-priority eligible campaign wins and the rest defer", () => {
  const low = campaign("low", 20);
  const high = campaign("high", 90);
  const result = arbitratePopupCampaigns([low, high], context());

  assert.equal(result.action, "SHOW");
  assert.equal(result.selectedCampaignKey, "high");
  assert.equal(result.candidates.find(row => row.campaignKey === "high")?.action, "SHOW");
  assert.equal(result.candidates.find(row => row.campaignKey === "low")?.reason, "higher_priority_campaign_selected");
});

test("waiting trigger is DEFER rather than permanent suppression", () => {
  const value = campaign("later", 50);
  value.trigger.seconds = 60;
  const result = arbitratePopupCampaigns([value], context({ sessionElapsedMs: 10_000 }));
  assert.equal(result.action, "DEFER");
  assert.equal(result.candidates[0].reason, "waiting_for_trigger");
});

test("checkout suppresses all popup delivery even when campaign is otherwise eligible", () => {
  const value = campaign("checkout-blocked", 100, "cart_rescue");
  const result = arbitratePopupCampaigns([value], context({
    pagePath: "/checkout",
    pageRole: "checkout",
    checkoutInProgress: true,
    explicitIntent: "commerce",
  }));
  assert.equal(result.action, "SUPPRESS");
  assert.equal(result.candidates[0].reason, "checkout_in_progress");
});

test("support flow defers commerce popup but allows support rescue to compete", () => {
  const lead = campaign("lead", 100, "lead_capture");
  lead.targeting.commerceTrafficMode = "off";
  const support = campaign("support", 50, "support_rescue");
  support.targeting.commerceTrafficMode = "off";

  const result = arbitratePopupCampaigns([lead, support], context({
    pagePath: "/pages/contact",
    pageRole: "contact",
    explicitIntent: "support",
    supportIntentActive: true,
  }));

  assert.equal(result.selectedCampaignKey, "support");
  assert.equal(result.candidates.find(row => row.campaignKey === "lead")?.reason, "support_flow_has_priority");
});

test("cart page is reserved for cart rescue and shipping threshold campaigns", () => {
  const lead = campaign("generic", 100, "lead_capture");
  const cart = campaign("cart-rescue", 40, "cart_rescue");
  cart.trigger.mode = "cart";

  const result = arbitratePopupCampaigns([lead, cart], context({
    pagePath: "/cart",
    pageRole: "cart",
    cartItemCount: 2,
  }));

  assert.equal(result.selectedCampaignKey, "cart-rescue");
  assert.equal(result.candidates.find(row => row.campaignKey === "generic")?.reason, "cart_reserved_for_transactional_campaign");
});

test("blocking modal and global cooldown defer delivery without losing eligibility", () => {
  const value = campaign("deferred", 50);
  const overlay = arbitratePopupCampaigns([value], context({ blockingOverlayOpen: true }));
  assert.equal(overlay.action, "DEFER");
  assert.equal(overlay.candidates[0].reason, "blocking_overlay_open");

  const now = Date.parse("2026-08-24T03:00:00Z");
  const cooldown = arbitratePopupCampaigns([value], context({ nowMs: now, lastAnyPopupAtMs: now - 5_000 }));
  assert.equal(cooldown.action, "DEFER");
  assert.equal(cooldown.candidates[0].reason, "global_popup_cooldown");
});

test("per-campaign frequency state suppresses only the capped campaign", () => {
  const high = campaign("high-capped", 100);
  const low = campaign("low-free", 20);
  const result = arbitratePopupCampaigns([high, low], context({
    campaignStates: {
      "high-capped": { sessionImpressions: 1, visitorDayImpressions: 1 },
      "low-free": { sessionImpressions: 0, visitorDayImpressions: 0 },
    },
  }));

  assert.equal(result.selectedCampaignKey, "low-free");
  assert.equal(result.candidates.find(row => row.campaignKey === "high-capped")?.reason, "session_frequency_cap");
});

test("same-priority tie is deterministic for the same visitor", () => {
  const a = campaign("a", 50);
  const b = campaign("b", 50);
  const one = arbitratePopupCampaigns([a, b], context({ visitorId: "sticky-tie" }));
  const two = arbitratePopupCampaigns([b, a], context({ visitorId: "sticky-tie" }));
  assert.equal(one.selectedCampaignKey, two.selectedCampaignKey);
});

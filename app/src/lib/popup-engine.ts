import { createHash } from "node:crypto";
import type { PopupCampaignConfig, PopupVariantConfig } from "./popup-config-contract.js";
import {
  classifyCommerceTraffic,
  commerceTrafficGateAllows,
  type CommerceTrafficClassification,
  type CommerceTrafficSignals,
} from "./popup-commerce-traffic.js";

export interface PopupSessionContext extends CommerceTrafficSignals {
  visitorId: string;
  sessionId: string;
  nowMs?: number;
  sessionElapsedMs?: number;
  scrollDepthPct?: number;
  inactiveMs?: number;
  exitIntent?: boolean;
  manualTrigger?: boolean;
  isMobile?: boolean;
  productHandle?: string | null;
  utmSource?: string | null;
  cartSubtotal?: number | null;
  cartItemCount?: number;
  previousCloseAtMs?: number | null;
  previousSubmitAtMs?: number | null;
  sessionImpressions?: number;
  visitorDayImpressions?: number;
}

export interface PopupEligibilityResult {
  eligible: boolean;
  reason: string;
  variant: PopupVariantConfig | null;
  assignmentBucket: number | null;
  commerceTraffic: CommerceTrafficClassification;
}

function normalizePath(path: string | undefined): string {
  const value = String(path || "/").trim();
  return value.startsWith("/") ? value : `/${value}`;
}

function pathMatches(path: string, rule: string): boolean {
  const normalizedRule = normalizePath(rule);
  if (normalizedRule.endsWith("*")) return path.startsWith(normalizedRule.slice(0, -1));
  return path === normalizedRule || path.startsWith(`${normalizedRule}/`);
}

function listAllows(value: string | null | undefined, rules: string[]): boolean {
  if (rules.length === 0) return true;
  const normalized = String(value || "").toLowerCase();
  return rules.some(rule => normalized === rule.toLowerCase());
}

function includesAny(value: string | null | undefined, needles: string[]): boolean {
  if (needles.length === 0) return true;
  const normalized = String(value || "").toLowerCase();
  return needles.some(needle => normalized.includes(needle.toLowerCase()));
}

function stableBucket(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 10000;
}

function blocked(reason: string, commerceTraffic: CommerceTrafficClassification): PopupEligibilityResult {
  return { eligible: false, reason, variant: null, assignmentBucket: null, commerceTraffic };
}

export function assignPopupVariant(campaign: PopupCampaignConfig, visitorId: string): { variant: PopupVariantConfig; bucket: number } {
  if (!visitorId) throw new Error("visitorId is required for deterministic popup assignment");
  const bucket = stableBucket(`${campaign.key}:${campaign.experimentVersion}:${visitorId}`);
  let cursor = 0;
  for (const variant of campaign.variants) {
    cursor += variant.weightBasisPoints;
    if (bucket < cursor) return { variant, bucket };
  }
  return { variant: campaign.variants[campaign.variants.length - 1], bucket };
}

function triggerSatisfied(campaign: PopupCampaignConfig, context: PopupSessionContext): boolean {
  const trigger = campaign.trigger;
  switch (trigger.mode) {
    case "time":
      return (context.sessionElapsedMs || 0) >= trigger.seconds * 1000;
    case "scroll":
      return (context.scrollDepthPct || 0) >= trigger.scrollPct;
    case "inactivity":
      return (context.inactiveMs || 0) >= trigger.inactivitySeconds * 1000;
    case "exit":
      if (trigger.desktopExitOnly && context.isMobile) return false;
      return context.exitIntent === true;
    case "cart":
      return (context.cartItemCount || 0) > 0;
    case "manual":
      return context.manualTrigger === true;
    default:
      return false;
  }
}

export function evaluatePopupEligibility(campaign: PopupCampaignConfig, context: PopupSessionContext): PopupEligibilityResult {
  const now = context.nowMs || Date.now();
  const commerceTraffic = classifyCommerceTraffic(context, {
    version: 1,
    targetCountries: campaign.targeting.qualifiedCountries,
  });

  if (campaign.status !== "DRAFT") return blocked("campaign_paused", commerceTraffic);
  if (!context.visitorId || !context.sessionId) return blocked("identity_missing", commerceTraffic);

  if (!commerceTrafficGateAllows(campaign.targeting.commerceTrafficMode, commerceTraffic)) {
    return blocked(commerceTraffic.decision === "EXCLUDED" ? "commerce_traffic_excluded" : "commerce_traffic_not_qualified", commerceTraffic);
  }

  const path = normalizePath(context.pagePath);
  if (campaign.targeting.excludePaths.some(rule => pathMatches(path, rule))) {
    return blocked("excluded_path", commerceTraffic);
  }
  if (campaign.targeting.includePaths.length > 0 && !campaign.targeting.includePaths.some(rule => pathMatches(path, rule))) {
    return blocked("path_not_targeted", commerceTraffic);
  }
  if (!listAllows(context.productHandle, campaign.targeting.productHandles)) {
    return blocked("product_not_targeted", commerceTraffic);
  }
  if (!listAllows(context.funnelId, campaign.targeting.funnelIds)) {
    return blocked("funnel_not_targeted", commerceTraffic);
  }
  if (!listAllows(context.trafficSource, campaign.targeting.trafficSources)) {
    return blocked("traffic_source_not_targeted", commerceTraffic);
  }
  if (!listAllows(context.utmSource, campaign.targeting.utmSources)) {
    return blocked("utm_not_targeted", commerceTraffic);
  }
  if (!includesAny(context.referrer, campaign.targeting.referrerContains)) {
    return blocked("referrer_not_targeted", commerceTraffic);
  }

  if (campaign.targeting.visitorState !== "any" && campaign.targeting.visitorState !== context.visitorState) {
    return blocked("visitor_state_not_targeted", commerceTraffic);
  }

  const cartCount = context.cartItemCount || 0;
  if ((campaign.targeting.requireCartItems || campaign.trigger.requireCartItems) && cartCount < 1) {
    return blocked("cart_required", commerceTraffic);
  }
  if (campaign.targeting.cartMinSubtotal !== null && (context.cartSubtotal == null || context.cartSubtotal < campaign.targeting.cartMinSubtotal)) {
    return blocked("cart_below_minimum", commerceTraffic);
  }
  if (campaign.targeting.cartMaxSubtotal !== null && (context.cartSubtotal == null || context.cartSubtotal > campaign.targeting.cartMaxSubtotal)) {
    return blocked("cart_above_maximum", commerceTraffic);
  }

  if ((context.sessionImpressions || 0) >= campaign.frequency.maxImpressionsPerSession) {
    return blocked("session_frequency_cap", commerceTraffic);
  }
  if ((context.visitorDayImpressions || 0) >= campaign.frequency.maxImpressionsPerVisitorDay) {
    return blocked("daily_frequency_cap", commerceTraffic);
  }
  if (context.previousCloseAtMs && now - context.previousCloseAtMs < campaign.frequency.suppressAfterCloseMinutes * 60_000) {
    return blocked("close_suppression", commerceTraffic);
  }
  if (context.previousSubmitAtMs && now - context.previousSubmitAtMs < campaign.frequency.suppressAfterSubmitDays * 86_400_000) {
    return blocked("submit_suppression", commerceTraffic);
  }

  if (!triggerSatisfied(campaign, context)) {
    return blocked("trigger_not_satisfied", commerceTraffic);
  }

  const assignment = assignPopupVariant(campaign, context.visitorId);
  return {
    eligible: true,
    reason: "eligible",
    variant: assignment.variant,
    assignmentBucket: assignment.bucket,
    commerceTraffic,
  };
}

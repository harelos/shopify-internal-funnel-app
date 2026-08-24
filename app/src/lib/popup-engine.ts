import { createHash } from "node:crypto";
import type { PopupCampaignConfig, PopupVariantConfig } from "./popup-config-contract.js";

export interface PopupSessionContext {
  visitorId: string;
  sessionId: string;
  nowMs?: number;
  sessionElapsedMs?: number;
  scrollDepthPct?: number;
  inactiveMs?: number;
  exitIntent?: boolean;
  manualTrigger?: boolean;
  isMobile?: boolean;
  pagePath?: string;
  productHandle?: string | null;
  funnelId?: string | null;
  trafficSource?: string | null;
  referrer?: string | null;
  utmSource?: string | null;
  visitorState?: "new" | "returning" | "known" | "unknown";
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
  if (campaign.status !== "DRAFT") return { eligible: false, reason: "campaign_paused", variant: null, assignmentBucket: null };
  if (!context.visitorId || !context.sessionId) return { eligible: false, reason: "identity_missing", variant: null, assignmentBucket: null };

  const path = normalizePath(context.pagePath);
  if (campaign.targeting.excludePaths.some(rule => pathMatches(path, rule))) {
    return { eligible: false, reason: "excluded_path", variant: null, assignmentBucket: null };
  }
  if (campaign.targeting.includePaths.length > 0 && !campaign.targeting.includePaths.some(rule => pathMatches(path, rule))) {
    return { eligible: false, reason: "path_not_targeted", variant: null, assignmentBucket: null };
  }
  if (!listAllows(context.productHandle, campaign.targeting.productHandles)) {
    return { eligible: false, reason: "product_not_targeted", variant: null, assignmentBucket: null };
  }
  if (!listAllows(context.funnelId, campaign.targeting.funnelIds)) {
    return { eligible: false, reason: "funnel_not_targeted", variant: null, assignmentBucket: null };
  }
  if (!listAllows(context.trafficSource, campaign.targeting.trafficSources)) {
    return { eligible: false, reason: "traffic_source_not_targeted", variant: null, assignmentBucket: null };
  }
  if (!listAllows(context.utmSource, campaign.targeting.utmSources)) {
    return { eligible: false, reason: "utm_not_targeted", variant: null, assignmentBucket: null };
  }
  if (!includesAny(context.referrer, campaign.targeting.referrerContains)) {
    return { eligible: false, reason: "referrer_not_targeted", variant: null, assignmentBucket: null };
  }

  if (campaign.targeting.visitorState !== "any" && campaign.targeting.visitorState !== context.visitorState) {
    return { eligible: false, reason: "visitor_state_not_targeted", variant: null, assignmentBucket: null };
  }

  const cartCount = context.cartItemCount || 0;
  if ((campaign.targeting.requireCartItems || campaign.trigger.requireCartItems) && cartCount < 1) {
    return { eligible: false, reason: "cart_required", variant: null, assignmentBucket: null };
  }
  if (campaign.targeting.cartMinSubtotal !== null && (context.cartSubtotal == null || context.cartSubtotal < campaign.targeting.cartMinSubtotal)) {
    return { eligible: false, reason: "cart_below_minimum", variant: null, assignmentBucket: null };
  }
  if (campaign.targeting.cartMaxSubtotal !== null && (context.cartSubtotal == null || context.cartSubtotal > campaign.targeting.cartMaxSubtotal)) {
    return { eligible: false, reason: "cart_above_maximum", variant: null, assignmentBucket: null };
  }

  if ((context.sessionImpressions || 0) >= campaign.frequency.maxImpressionsPerSession) {
    return { eligible: false, reason: "session_frequency_cap", variant: null, assignmentBucket: null };
  }
  if ((context.visitorDayImpressions || 0) >= campaign.frequency.maxImpressionsPerVisitorDay) {
    return { eligible: false, reason: "daily_frequency_cap", variant: null, assignmentBucket: null };
  }
  if (context.previousCloseAtMs && now - context.previousCloseAtMs < campaign.frequency.suppressAfterCloseMinutes * 60_000) {
    return { eligible: false, reason: "close_suppression", variant: null, assignmentBucket: null };
  }
  if (context.previousSubmitAtMs && now - context.previousSubmitAtMs < campaign.frequency.suppressAfterSubmitDays * 86_400_000) {
    return { eligible: false, reason: "submit_suppression", variant: null, assignmentBucket: null };
  }

  if (!triggerSatisfied(campaign, context)) {
    return { eligible: false, reason: "trigger_not_satisfied", variant: null, assignmentBucket: null };
  }

  const assignment = assignPopupVariant(campaign, context.visitorId);
  return { eligible: true, reason: "eligible", variant: assignment.variant, assignmentBucket: assignment.bucket };
}

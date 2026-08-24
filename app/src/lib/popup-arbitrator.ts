import { createHash } from "node:crypto";
import type { CommercePageRole } from "./popup-commerce-traffic.js";
import type { PopupCampaignConfig } from "./popup-config-contract.js";
import { evaluatePopupEligibility, type PopupEligibilityResult, type PopupSessionContext } from "./popup-engine.js";

export type PopupDecisionAction = "SHOW" | "SUPPRESS" | "DEFER";

export interface PopupArbitrationContext extends PopupSessionContext {
  pageRole?: CommercePageRole;
  supportIntentActive?: boolean;
  blockingOverlayOpen?: boolean;
  checkoutInProgress?: boolean;
  lastAnyPopupAtMs?: number | null;
}

export interface PopupCandidateDecision {
  campaignKey: string;
  campaignType: PopupCampaignConfig["type"];
  priority: number;
  conflictGroup: string;
  action: PopupDecisionAction;
  reason: string;
  eligibility: PopupEligibilityResult;
}

export interface PopupArbitrationResult {
  action: PopupDecisionAction;
  reason: string;
  selectedCampaignKey: string | null;
  selectedVariantKey: string | null;
  selectedCampaign: PopupCampaignConfig | null;
  selectedEligibility: PopupEligibilityResult | null;
  candidates: PopupCandidateDecision[];
}

function stableTieBucket(visitorId: string, campaignKey: string): number {
  const digest = createHash("sha256").update(`popup-arbitration:${visitorId}:${campaignKey}`).digest();
  return digest.readUInt32BE(0);
}

function isCartTransactionalCampaign(campaign: PopupCampaignConfig): boolean {
  return campaign.type === "cart_rescue" || campaign.type === "shipping_threshold";
}

function reasonForIneligible(result: PopupEligibilityResult): { action: PopupDecisionAction; reason: string } {
  if (result.reason === "trigger_not_satisfied") return { action: "DEFER", reason: "waiting_for_trigger" };
  return { action: "SUPPRESS", reason: result.reason };
}

function globalConflictDecision(campaign: PopupCampaignConfig, context: PopupArbitrationContext): { action: PopupDecisionAction; reason: string } | null {
  if (campaign.delivery.suppressOnCheckout && (context.checkoutInProgress || context.pageRole === "checkout")) {
    return { action: "SUPPRESS", reason: "checkout_in_progress" };
  }

  if (context.supportIntentActive && campaign.type !== "support_rescue") {
    return { action: "DEFER", reason: "support_flow_has_priority" };
  }

  if (campaign.delivery.deferWhenOverlayOpen && context.blockingOverlayOpen) {
    return { action: "DEFER", reason: "blocking_overlay_open" };
  }

  if (campaign.delivery.reserveCartForCartCampaigns && context.pageRole === "cart" && !isCartTransactionalCampaign(campaign)) {
    return { action: "DEFER", reason: "cart_reserved_for_transactional_campaign" };
  }

  const now = context.nowMs || Date.now();
  if (context.lastAnyPopupAtMs && campaign.delivery.globalCooldownSeconds > 0) {
    const elapsed = now - context.lastAnyPopupAtMs;
    if (elapsed < campaign.delivery.globalCooldownSeconds * 1000) {
      return { action: "DEFER", reason: "global_popup_cooldown" };
    }
  }

  return null;
}

export function arbitratePopupCampaigns(campaigns: PopupCampaignConfig[], context: PopupArbitrationContext): PopupArbitrationResult {
  const evaluated = campaigns.map(campaign => ({
    campaign,
    eligibility: evaluatePopupEligibility(campaign, context),
  }));

  const candidateRows: Array<{ campaign: PopupCampaignConfig; eligibility: PopupEligibilityResult; forced?: { action: PopupDecisionAction; reason: string } }> = [];

  for (const row of evaluated) {
    if (!row.eligibility.eligible) {
      candidateRows.push({ ...row, forced: reasonForIneligible(row.eligibility) });
      continue;
    }
    const conflict = globalConflictDecision(row.campaign, context);
    candidateRows.push(conflict ? { ...row, forced: conflict } : row);
  }

  const showable = candidateRows
    .filter(row => row.eligibility.eligible && !row.forced)
    .sort((a, b) => {
      if (b.campaign.delivery.priority !== a.campaign.delivery.priority) {
        return b.campaign.delivery.priority - a.campaign.delivery.priority;
      }
      const aBucket = stableTieBucket(context.visitorId || "", a.campaign.key);
      const bBucket = stableTieBucket(context.visitorId || "", b.campaign.key);
      if (aBucket !== bBucket) return aBucket - bBucket;
      return a.campaign.key.localeCompare(b.campaign.key);
    });

  const selected = showable[0] || null;
  const candidates: PopupCandidateDecision[] = candidateRows.map(row => {
    if (row.forced) {
      return {
        campaignKey: row.campaign.key,
        campaignType: row.campaign.type,
        priority: row.campaign.delivery.priority,
        conflictGroup: row.campaign.delivery.conflictGroup,
        action: row.forced.action,
        reason: row.forced.reason,
        eligibility: row.eligibility,
      };
    }
    if (selected && selected.campaign.key === row.campaign.key) {
      return {
        campaignKey: row.campaign.key,
        campaignType: row.campaign.type,
        priority: row.campaign.delivery.priority,
        conflictGroup: row.campaign.delivery.conflictGroup,
        action: "SHOW",
        reason: "selected_highest_priority",
        eligibility: row.eligibility,
      };
    }
    return {
      campaignKey: row.campaign.key,
      campaignType: row.campaign.type,
      priority: row.campaign.delivery.priority,
      conflictGroup: row.campaign.delivery.conflictGroup,
      action: "DEFER",
      reason: "higher_priority_campaign_selected",
      eligibility: row.eligibility,
    };
  });

  if (!selected) {
    const hasDeferred = candidates.some(candidate => candidate.action === "DEFER");
    return {
      action: hasDeferred ? "DEFER" : "SUPPRESS",
      reason: hasDeferred ? "no_campaign_ready_yet" : "no_campaign_eligible",
      selectedCampaignKey: null,
      selectedVariantKey: null,
      selectedCampaign: null,
      selectedEligibility: null,
      candidates,
    };
  }

  return {
    action: "SHOW",
    reason: "campaign_selected",
    selectedCampaignKey: selected.campaign.key,
    selectedVariantKey: selected.eligibility.variant?.key || null,
    selectedCampaign: selected.campaign,
    selectedEligibility: selected.eligibility,
    candidates,
  };
}

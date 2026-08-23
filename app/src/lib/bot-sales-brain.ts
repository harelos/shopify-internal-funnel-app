export type BotAgentRole = "SALES" | "SUPPORT" | "RETENTION" | "RISK" | "SECURITY";
export type BotSalesStage = "DISCOVER" | "QUALIFY" | "RECOMMEND" | "OBJECTION" | "OFFER" | "CLOSE" | "FOLLOW_UP";
export type PurchaseIntent = "LOW" | "MEDIUM" | "HIGH";
export type PageType = "FUNNEL" | "PRODUCT" | "CART" | "ORDER_TRACKING" | "POLICY" | "OTHER";

export interface BotConversationSignals {
  pageType: PageType;
  customerMessages: number;
  productQuestion?: boolean;
  orderIssue?: boolean;
  refundRequest?: boolean;
  chargebackThreat?: boolean;
  legalThreat?: boolean;
  abuseOrOffTopic?: boolean;
  promptInjectionSuspected?: boolean;
  returningCustomer?: boolean;
  vipCustomer?: boolean;
  priceObjection?: boolean;
  exitOrAbandonmentSignal?: boolean;
  declinedPriorOffer?: boolean;
  purchaseIntent?: PurchaseIntent;
  priorDiscountPct?: number;
  cartValueIls?: number | null;
  contributionMarginBeforeDiscountIls?: number | null;
  minContributionMarginIls?: number | null;
}

export interface BotRouteDecision {
  role: BotAgentRole;
  reason: string;
  salesAllowed: boolean;
  requiresHumanEscalation?: boolean;
}

/**
 * Routing is deterministic and runs before the language model.
 * The LLM can suggest an intent, but it cannot override legal/security/support
 * boundaries or grant itself more tools.
 */
export function routeBotConversation(signals: BotConversationSignals): BotRouteDecision {
  if (signals.promptInjectionSuspected || signals.abuseOrOffTopic) {
    return { role: "SECURITY", reason: "SECURITY_OR_SCOPE_VIOLATION", salesAllowed: false };
  }
  if (signals.legalThreat) {
    return { role: "RISK", reason: "LEGAL_OR_COMPLIANCE_ESCALATION", salesAllowed: false, requiresHumanEscalation: true };
  }
  if (signals.chargebackThreat) {
    return { role: "RISK", reason: "CHARGEBACK_RISK", salesAllowed: false };
  }
  if (signals.orderIssue || signals.refundRequest || signals.pageType === "ORDER_TRACKING") {
    return { role: "SUPPORT", reason: "ACTIVE_ORDER_OR_SERVICE_NEED", salesAllowed: false };
  }
  if ((signals.returningCustomer || signals.vipCustomer) && signals.productQuestion) {
    return { role: "RETENTION", reason: "RETURNING_CUSTOMER_PRODUCT_INTENT", salesAllowed: true };
  }
  return { role: "SALES", reason: "DEFAULT_COMMERCE_INTENT", salesAllowed: true };
}

export interface DiscountPolicy {
  maxDiscountPct: number;
  firstDiscountPct: number;
  secondDiscountPct: number;
  minMessagesBeforeDiscount: number;
  minMessagesBeforeSecondDiscount: number;
}

export const DEFAULT_DISCOUNT_POLICY: DiscountPolicy = {
  maxDiscountPct: 10,
  firstDiscountPct: 5,
  secondDiscountPct: 10,
  minMessagesBeforeDiscount: 3,
  minMessagesBeforeSecondDiscount: 5,
};

export type DiscountDecision =
  | { action: "NO_OFFER"; reason: string }
  | { action: "OFFER_DISCOUNT"; pct: number; reason: string; projectedMarginAfterDiscountIls: number };

/**
 * The LLM never invents a coupon or decides a discount by itself.
 * This policy engine checks intent, conversation stage and unit economics first.
 */
export function decideDiscount(
  signals: BotConversationSignals,
  policy: DiscountPolicy = DEFAULT_DISCOUNT_POLICY,
): DiscountDecision {
  const route = routeBotConversation(signals);
  if (!route.salesAllowed) return { action: "NO_OFFER", reason: "SALES_NOT_ALLOWED_IN_CURRENT_ROUTE" };

  const currentDiscount = Math.max(0, Number(signals.priorDiscountPct ?? 0));
  if (currentDiscount >= policy.maxDiscountPct) return { action: "NO_OFFER", reason: "DISCOUNT_CAP_REACHED" };

  const intent = signals.purchaseIntent ?? "LOW";
  const qualifiedHesitation = Boolean(signals.priceObjection || signals.exitOrAbandonmentSignal);
  if (intent !== "HIGH" || !qualifiedHesitation) return { action: "NO_OFFER", reason: "NO_QUALIFIED_PRICE_HESITATION" };

  const messages = Math.max(0, signals.customerMessages || 0);
  if (messages < policy.minMessagesBeforeDiscount) return { action: "NO_OFFER", reason: "TOO_EARLY_FOR_DISCOUNT" };

  const cartValue = signals.cartValueIls;
  const marginBeforeDiscount = signals.contributionMarginBeforeDiscountIls;
  const minMargin = signals.minContributionMarginIls;
  if (cartValue == null || marginBeforeDiscount == null || minMargin == null) {
    return { action: "NO_OFFER", reason: "MISSING_UNIT_ECONOMICS" };
  }

  let proposed = policy.firstDiscountPct;
  if (
    currentDiscount >= policy.firstDiscountPct &&
    signals.declinedPriorOffer &&
    messages >= policy.minMessagesBeforeSecondDiscount
  ) {
    proposed = policy.secondDiscountPct;
  }
  proposed = Math.min(proposed, policy.maxDiscountPct);
  if (proposed <= currentDiscount) return { action: "NO_OFFER", reason: "NO_HIGHER_APPROVED_DISCOUNT" };

  const incrementalDiscountCost = cartValue * ((proposed - currentDiscount) / 100);
  const projectedMargin = marginBeforeDiscount - incrementalDiscountCost;
  if (projectedMargin < minMargin) return { action: "NO_OFFER", reason: "MARGIN_FLOOR_BLOCK" };

  return {
    action: "OFFER_DISCOUNT",
    pct: proposed,
    reason: proposed > policy.firstDiscountPct ? "SECOND_STAGE_SAVE" : "FIRST_STAGE_SAVE",
    projectedMarginAfterDiscountIls: Number(projectedMargin.toFixed(2)),
  };
}

export interface LeadProfileState {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface LeadCaptureContext {
  customerMessages: number;
  wantsCoupon?: boolean;
  wantsSavedRecommendation?: boolean;
  wantsCallback?: boolean;
  supportNeedsIdentityVerification?: boolean;
}

export type LeadField = "NONE" | "NAME" | "EMAIL" | "PHONE";

/** Progressive profiling: do not interrogate a prospect before delivering value. */
export function nextLeadField(profile: LeadProfileState, context: LeadCaptureContext): LeadField {
  if (context.supportNeedsIdentityVerification && !profile.email && !profile.phone) return "EMAIL";
  if (!profile.email && (context.wantsCoupon || context.wantsSavedRecommendation)) return "EMAIL";
  if (!profile.phone && context.wantsCallback) return "PHONE";
  if (!profile.name && context.customerMessages >= 2) return "NAME";
  return "NONE";
}

export interface ModelVariant {
  id: string;
  provider: string;
  model: string;
  trafficBasisPoints: number;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Sticky deterministic assignment for fair model A/B/n tests. */
export function assignModelVariant(visitorKey: string, variants: ModelVariant[]): ModelVariant {
  if (!visitorKey) throw new Error("visitorKey is required");
  if (!variants.length) throw new Error("At least one model variant is required");
  const total = variants.reduce((sum, item) => sum + item.trafficBasisPoints, 0);
  if (total !== 10_000) throw new Error("Model traffic must total 10,000 basis points");
  if (variants.some(item => item.trafficBasisPoints < 0)) throw new Error("Model traffic cannot be negative");

  const bucket = fnv1a(visitorKey) % 10_000;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.trafficBasisPoints;
    if (bucket < cursor) return variant;
  }
  return variants[variants.length - 1];
}

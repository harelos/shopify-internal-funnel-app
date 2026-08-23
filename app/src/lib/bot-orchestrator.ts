import {
  assignModelVariant,
  decideDiscount,
  nextLeadField,
  routeBotConversation,
  type BotAgentRole,
  type BotConversationSignals,
  type BotRouteDecision,
  type DiscountPolicy,
  type LeadCaptureContext,
  type LeadProfileState,
  type ModelVariant,
} from "./bot-sales-brain.js";

export type BotToolName =
  | "product.read"
  | "policy.read"
  | "shipping.read"
  | "recommendation.build"
  | "offer.request"
  | "cart.prepare"
  | "order.read_scoped"
  | "tracking.read_scoped"
  | "customer.summary_scoped"
  | "resolution.request"
  | "risk.case_append"
  | "human.escalate";

const ROLE_TOOLS: Record<BotAgentRole, readonly BotToolName[]> = {
  SALES: ["product.read", "policy.read", "shipping.read", "recommendation.build", "offer.request", "cart.prepare"],
  SUPPORT: ["policy.read", "shipping.read", "order.read_scoped", "tracking.read_scoped", "resolution.request"],
  RETENTION: ["product.read", "policy.read", "shipping.read", "customer.summary_scoped", "recommendation.build", "offer.request", "cart.prepare"],
  RISK: ["policy.read", "order.read_scoped", "tracking.read_scoped", "resolution.request", "risk.case_append", "human.escalate"],
  SECURITY: [],
};

export function toolsForRole(role: BotAgentRole): readonly BotToolName[] { return ROLE_TOOLS[role]; }
export function isToolAllowed(role: BotAgentRole, tool: BotToolName): boolean { return ROLE_TOOLS[role].includes(tool); }

export interface BotRoutingPolicy {
  support: boolean;
  retention: boolean;
  risk: boolean;
}

export interface BotDecisionPlanInput {
  visitorKey: string;
  signals: BotConversationSignals;
  profile?: LeadProfileState;
  leadContext?: LeadCaptureContext;
  models: ModelVariant[];
  discountPolicy?: DiscountPolicy;
  routingPolicy?: BotRoutingPolicy;
}

export interface BotDecisionPlan {
  route: BotRouteDecision;
  discount: ReturnType<typeof decideDiscount>;
  nextLeadField: ReturnType<typeof nextLeadField>;
  modelVariant: ModelVariant;
  allowedTools: readonly BotToolName[];
  safeguards: {
    canSell: boolean;
    canAccessOrders: boolean;
    canRequestOffer: boolean;
    requiresHumanEscalation: boolean;
  };
}

function applyRoutingPolicy(route: BotRouteDecision, policy?: BotRoutingPolicy): BotRouteDecision {
  if (!policy) return route;
  if (route.role === "RETENTION" && !policy.retention) {
    return { role: "SALES", reason: "RETENTION_DISABLED_FALLBACK_TO_SALES", salesAllowed: true };
  }
  if (route.role === "SUPPORT" && !policy.support) {
    return { role: "SUPPORT", reason: "SUPPORT_DISABLED_HUMAN_ESCALATION", salesAllowed: false, requiresHumanEscalation: true };
  }
  if (route.role === "RISK" && !policy.risk) {
    return { role: "RISK", reason: "RISK_DISABLED_HUMAN_ESCALATION", salesAllowed: false, requiresHumanEscalation: true };
  }
  return route;
}

export function buildBotDecisionPlan(input: BotDecisionPlanInput): BotDecisionPlan {
  const route = applyRoutingPolicy(routeBotConversation(input.signals), input.routingPolicy);
  // Discount logic receives the same route-sensitive signals but is always blocked
  // when the final route is not sales-enabled.
  const discount = route.salesAllowed
    ? decideDiscount(input.signals, input.discountPolicy)
    : { action: "NO_OFFER", reason: "SALES_NOT_ALLOWED_IN_CURRENT_ROUTE" } as const;
  const leadField = nextLeadField(input.profile || {}, input.leadContext || { customerMessages: input.signals.customerMessages });
  const modelVariant = assignModelVariant(input.visitorKey, input.models);
  const allowedTools = toolsForRole(route.role);

  return {
    route,
    discount,
    nextLeadField: leadField,
    modelVariant,
    allowedTools,
    safeguards: {
      canSell: route.salesAllowed,
      canAccessOrders: allowedTools.includes("order.read_scoped"),
      canRequestOffer: route.salesAllowed && allowedTools.includes("offer.request"),
      requiresHumanEscalation: Boolean(route.requiresHumanEscalation),
    },
  };
}

import {
  assignModelVariant,
  decideDiscount,
  nextLeadField,
  routeBotConversation,
  type BotAgentRole,
  type BotConversationSignals,
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

export interface BotDecisionPlanInput {
  visitorKey: string;
  signals: BotConversationSignals;
  profile?: LeadProfileState;
  leadContext?: LeadCaptureContext;
  models: ModelVariant[];
  discountPolicy?: DiscountPolicy;
}

export interface BotDecisionPlan {
  route: ReturnType<typeof routeBotConversation>;
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

export function buildBotDecisionPlan(input: BotDecisionPlanInput): BotDecisionPlan {
  const route = routeBotConversation(input.signals);
  const discount = decideDiscount(input.signals, input.discountPolicy);
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
      canRequestOffer: allowedTools.includes("offer.request"),
      requiresHumanEscalation: Boolean(route.requiresHumanEscalation),
    },
  };
}

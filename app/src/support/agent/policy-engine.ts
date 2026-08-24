import type {
  SupportAgentDecision,
  SupportAgentFacts,
  SupportIntent,
  SupportToolPlanItem,
} from "./contracts.js";
import { skillForIntent } from "./skills.js";

export type SupportPolicyDecision = {
  decision: SupportAgentDecision;
  risk: "LOW" | "MEDIUM" | "HIGH";
  requiresHuman: boolean;
  missingFacts: string[];
  toolPlan: SupportToolPlanItem[];
};

const highRiskIntents = new Set<SupportIntent>([
  "legal_chargeback",
]);

const approvalIntents = new Set<SupportIntent>([
  "order_cancel",
  "order_change",
  "address_change",
  "return_request",
  "exchange_request",
  "refund_request",
  "damaged_item",
  "wrong_missing_item",
  "delivery_issue",
  "discount_request",
]);

function missingFactsFor(intent: SupportIntent, facts: SupportAgentFacts = {}): string[] {
  const missing: string[] = [];
  const order = facts.order;
  const knowledge = facts.knowledge;

  if ([
    "shipping_status",
    "delivery_issue",
    "order_cancel",
    "order_change",
    "address_change",
    "return_request",
    "return_status",
    "exchange_request",
    "exchange_status",
    "refund_request",
    "refund_status",
    "damaged_item",
    "wrong_missing_item",
  ].includes(intent) && order?.found !== true) {
    missing.push("shopify_order");
  }

  if (intent === "shipping_policy" && !knowledge?.shippingPolicyKnown) missing.push("shipping_policy");
  if (["return_request", "exchange_request"].includes(intent) && !knowledge?.returnPolicyKnown) missing.push("return_policy");
  if (intent === "refund_request" && !knowledge?.returnPolicyKnown) missing.push("refund_policy");
  if (["return_status", "exchange_status"].includes(intent) && !knowledge?.returnStatusKnown) missing.push("return_status");
  if (intent === "product_usage" && !knowledge?.productUsageKnown) missing.push("product_usage_facts");
  if (["product_question", "product_recommendation"].includes(intent) && !knowledge?.productFactsKnown) {
    missing.push("product_facts");
  }
  if (intent === "shade_recommendation" && !knowledge?.shadeGuidanceKnown) missing.push("shade_guidance");
  if (intent === "stock_request" && !knowledge?.stockKnown) missing.push("inventory_fact");

  return missing;
}

export function decideSupportPolicy(intent: SupportIntent, facts: SupportAgentFacts = {}): SupportPolicyDecision {
  const skill = skillForIntent(intent);
  const toolPlan = [...(skill?.defaultTools || [])];
  const missingFacts = missingFactsFor(intent, facts);

  if (intent === "thanks_no_reply") {
    return { decision: "NO_REPLY", risk: "LOW", requiresHuman: false, missingFacts, toolPlan };
  }

  if (highRiskIntents.has(intent)) {
    return { decision: "HUMAN_ONLY", risk: "HIGH", requiresHuman: true, missingFacts, toolPlan };
  }

  if (intent === "other") {
    return {
      decision: "HUMAN_ONLY",
      risk: "MEDIUM",
      requiresHuman: true,
      missingFacts,
      toolPlan: [...toolPlan, { tool: "ESCALATE_HUMAN", mode: "INTERNAL", reason: "Unknown intent should not be auto-resolved." }],
    };
  }

  if (approvalIntents.has(intent)) {
    return { decision: "HUMAN_APPROVAL", risk: "MEDIUM", requiresHuman: true, missingFacts, toolPlan };
  }

  return { decision: "AUTO_DRAFT", risk: "LOW", requiresHuman: false, missingFacts, toolPlan };
}

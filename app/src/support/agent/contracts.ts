export type SupportIntent =
  | "shipping_status"
  | "shipping_policy"
  | "delivery_issue"
  | "order_cancel"
  | "order_change"
  | "address_change"
  | "return_request"
  | "refund_request"
  | "refund_status"
  | "damaged_item"
  | "wrong_missing_item"
  | "product_usage"
  | "product_question"
  | "product_recommendation"
  | "shade_recommendation"
  | "stock_request"
  | "discount_request"
  | "thanks_no_reply"
  | "legal_chargeback"
  | "other";

export type SupportAgentDecision =
  | "AUTO_DRAFT"
  | "HUMAN_APPROVAL"
  | "HUMAN_ONLY"
  | "NO_REPLY";

export type SupportToolMode = "READ" | "PROPOSE_WRITE" | "INTERNAL";

export type SupportToolName =
  | "READ_SHOPIFY_ORDER"
  | "READ_SHOPIFY_CUSTOMER"
  | "READ_PRODUCT_FACTS"
  | "READ_STORE_POLICY"
  | "READ_TRACKING"
  | "REQUEST_CUSTOMER_INFO"
  | "REQUEST_SERVER_OFFER"
  | "PROPOSE_CANCEL_ORDER"
  | "PROPOSE_ADDRESS_CHANGE"
  | "PROPOSE_ORDER_EDIT"
  | "PROPOSE_RETURN"
  | "PROPOSE_REFUND"
  | "PROPOSE_RESHIP"
  | "ESCALATE_HUMAN";

export type SupportToolPlanItem = {
  tool: SupportToolName;
  mode: SupportToolMode;
  reason: string;
};

export type SupportOrderFacts = {
  found?: boolean;
  orderName?: string;
  fulfillmentStatus?: string | null;
  financialStatus?: string | null;
  trackingAvailable?: boolean;
  trackingUrl?: string | null;
  estimatedDeliveryAt?: string | null;
  delivered?: boolean;
  unfulfilled?: boolean;
  cancelled?: boolean;
};

export type SupportKnowledgeFacts = {
  productUsageKnown?: boolean;
  productFactsKnown?: boolean;
  shippingPolicyKnown?: boolean;
  returnPolicyKnown?: boolean;
  stockKnown?: boolean;
};

export type SupportAgentFacts = {
  order?: SupportOrderFacts;
  knowledge?: SupportKnowledgeFacts;
};

export type SupportAgentInput = {
  subject?: string;
  message: string;
  locale?: string;
  facts?: SupportAgentFacts;
};

export type SupportAgentResult = {
  intent: SupportIntent;
  confidence: number;
  decision: SupportAgentDecision;
  risk: "LOW" | "MEDIUM" | "HIGH";
  requiresHuman: boolean;
  missingFacts: string[];
  toolPlan: SupportToolPlanItem[];
  draft: string | null;
  truthSources: Array<"SHOPIFY" | "KNOWLEDGE" | "RULES" | "MODEL_PROSE">;
  sendAllowed: false;
  shopifyMutationAllowed: false;
};

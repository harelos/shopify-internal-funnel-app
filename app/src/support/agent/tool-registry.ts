import type { SupportToolName } from "./contracts.js";

export type SupportToolDefinition = {
  name: SupportToolName;
  description: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  currentPhase: "AVAILABLE" | "PLANNED";
  autoExecutionAllowed: boolean;
  humanApprovalRequired: boolean;
};

export const supportToolRegistry: Record<SupportToolName, SupportToolDefinition> = {
  READ_SHOPIFY_ORDER: {
    name: "READ_SHOPIFY_ORDER",
    description: "Read a small, reduced order/fulfillment/tracking view for the identified customer.",
    risk: "LOW",
    currentPhase: "AVAILABLE",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
  READ_SHOPIFY_CUSTOMER: {
    name: "READ_SHOPIFY_CUSTOMER",
    description: "Read the minimum customer profile fields needed for support identity/context. Do not persist broad customer profiles.",
    risk: "MEDIUM",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: false,
  },
  READ_PRODUCT_FACTS: {
    name: "READ_PRODUCT_FACTS",
    description: "Read structured Shopify product data and versioned internal product knowledge.",
    risk: "LOW",
    currentPhase: "AVAILABLE",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
  READ_STORE_POLICY: {
    name: "READ_STORE_POLICY",
    description: "Read approved shipping, returns, refunds, guarantees and other policy facts from a versioned knowledge pack.",
    risk: "LOW",
    currentPhase: "AVAILABLE",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
  READ_TRACKING: {
    name: "READ_TRACKING",
    description: "Read tracking/fulfillment data from Shopify and later an approved carrier source if needed.",
    risk: "LOW",
    currentPhase: "AVAILABLE",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
  READ_RETURN_STATUS: {
    name: "READ_RETURN_STATUS",
    description: "Read return/exchange progress from an approved returns source. No status may be inferred from model prose.",
    risk: "LOW",
    currentPhase: "PLANNED",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
  REQUEST_CUSTOMER_INFO: {
    name: "REQUEST_CUSTOMER_INFO",
    description: "Prepare a request for order number/email/photo/clarification when required facts are missing.",
    risk: "LOW",
    currentPhase: "AVAILABLE",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
  REQUEST_SERVER_OFFER: {
    name: "REQUEST_SERVER_OFFER",
    description: "Ask a server-side offer engine whether an authorized discount exists. Never invent a code or percentage.",
    risk: "MEDIUM",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: false,
  },
  PROPOSE_CANCEL_ORDER: {
    name: "PROPOSE_CANCEL_ORDER",
    description: "Create a proposed cancellation action after eligibility checks; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  PROPOSE_ADDRESS_CHANGE: {
    name: "PROPOSE_ADDRESS_CHANGE",
    description: "Create a proposed shipping-address edit after confirmation; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  PROPOSE_ORDER_EDIT: {
    name: "PROPOSE_ORDER_EDIT",
    description: "Create a proposed order edit; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  PROPOSE_RETURN: {
    name: "PROPOSE_RETURN",
    description: "Create a proposed return workflow after policy eligibility checks; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  PROPOSE_EXCHANGE: {
    name: "PROPOSE_EXCHANGE",
    description: "Create a proposed exchange/replacement workflow after eligibility checks; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  PROPOSE_REFUND: {
    name: "PROPOSE_REFUND",
    description: "Create a proposed refund with exact amount and reason from server facts; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  PROPOSE_RESHIP: {
    name: "PROPOSE_RESHIP",
    description: "Create a proposed replacement/reship after policy checks; does not execute it.",
    risk: "HIGH",
    currentPhase: "PLANNED",
    autoExecutionAllowed: false,
    humanApprovalRequired: true,
  },
  ESCALATE_HUMAN: {
    name: "ESCALATE_HUMAN",
    description: "Route the conversation to a human queue with reason and relevant context.",
    risk: "LOW",
    currentPhase: "AVAILABLE",
    autoExecutionAllowed: true,
    humanApprovalRequired: false,
  },
};

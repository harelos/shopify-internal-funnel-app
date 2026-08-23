import { isToolAllowed, type BotToolName } from "./bot-orchestrator.js";
import type { BotAgentRole, DiscountDecision } from "./bot-sales-brain.js";
import { BotShopifyOrderTool, type BotVerifiedOrderSummary } from "./bot-shopify-tools.js";

export class BotToolExecutionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BotToolExecutionError";
    this.code = code;
  }
}

export interface BotToolExecutionContext {
  role: BotAgentRole;
  conversationId: string;
  discount: DiscountDecision;
  sessionToken?: string;
  verifiedCustomer?: {
    email?: string | null;
    phone?: string | null;
  } | null;
}

export interface BotToolExecutorDeps {
  orderTool?: Pick<BotShopifyOrderTool, "readVerifiedOrder">;
  onHumanEscalation?: (input: { conversationId: string; reason?: string | null }) => Promise<{ queued: boolean; reference?: string | null }>;
}

function objectArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BotToolExecutionError("INVALID_TOOL_ARGUMENTS", "Tool arguments must be an object.");
  }
  return value as Record<string, unknown>;
}

function requireAllowed(role: BotAgentRole, name: BotToolName) {
  if (!isToolAllowed(role, name)) {
    throw new BotToolExecutionError("TOOL_NOT_ALLOWED", `Tool ${name} is not allowed for ${role}.`);
  }
}

function requireConversation(context: BotToolExecutionContext) {
  if (!String(context.conversationId || "").trim()) {
    throw new BotToolExecutionError("CONVERSATION_REQUIRED", "A conversation context is required.");
  }
}

function contactFromContext(context: BotToolExecutionContext, args: Record<string, unknown>) {
  const contextEmail = String(context.verifiedCustomer?.email || "").trim();
  const contextPhone = String(context.verifiedCustomer?.phone || "").trim();
  const argEmail = String(args.email || "").trim();
  const argPhone = String(args.phone || "").trim();

  // The server may pass already-verified customer contact in context. Simulator/admin
  // callers can provide a contact argument, but the order tool still compares it to
  // Shopify before exposing any order detail.
  return {
    email: contextEmail || argEmail || null,
    phone: contextPhone || argPhone || null,
  };
}

function trackingOnly(order: BotVerifiedOrderSummary) {
  return {
    id: order.id,
    name: order.name,
    displayFulfillmentStatus: order.displayFulfillmentStatus,
    fulfillments: order.fulfillments.map(item => ({
      status: item.status,
      deliveredAt: item.deliveredAt,
      trackingInfo: item.trackingInfo,
    })),
  };
}

/**
 * Single server-side execution boundary for bot tools.
 *
 * Important: a tool being mentioned in an LLM response or prompt never grants
 * permission. Every execution must pass through this function (or an equivalent
 * production boundary) and is checked against the deterministic route.
 */
export async function executeBotTool(
  name: BotToolName,
  rawArgs: unknown,
  context: BotToolExecutionContext,
  deps: BotToolExecutorDeps = {},
): Promise<unknown> {
  requireConversation(context);
  requireAllowed(context.role, name);
  const args = objectArgs(rawArgs);

  if (name === "offer.request") {
    if (context.discount.action !== "OFFER_DISCOUNT") {
      throw new BotToolExecutionError("OFFER_NOT_AUTHORIZED", "No deterministic offer authorization exists for this turn.");
    }
    return {
      authorized: true,
      pct: context.discount.pct,
      reason: context.discount.reason,
      projectedMarginAfterDiscountIls: context.discount.projectedMarginAfterDiscountIls,
      couponCode: null,
      couponAllocated: false,
      note: "Percentage authorization only. A coupon allocator must confirm a code separately.",
    };
  }

  if (name === "order.read_scoped" || name === "tracking.read_scoped") {
    const orderName = String(args.orderName || "").trim();
    if (!orderName) throw new BotToolExecutionError("ORDER_NUMBER_REQUIRED", "Order number is required.");
    const contact = contactFromContext(context, args);
    if (!contact.email && !contact.phone) {
      throw new BotToolExecutionError("ORDER_VERIFICATION_REQUIRED", "Verified customer email or phone is required before order access.");
    }
    const orderTool = deps.orderTool || new BotShopifyOrderTool();
    const order = await orderTool.readVerifiedOrder({
      orderName,
      email: contact.email,
      phone: contact.phone,
      sessionToken: context.sessionToken,
    });
    return name === "tracking.read_scoped" ? trackingOnly(order) : order;
  }

  if (name === "human.escalate") {
    if (!deps.onHumanEscalation) {
      return { queued: false, requiresIntegration: true, reason: String(args.reason || "") || null };
    }
    return deps.onHumanEscalation({
      conversationId: context.conversationId,
      reason: String(args.reason || "") || null,
    });
  }

  // Product/policy/shipping/cart/CRM/resolution/risk tools are deliberately not
  // faked. They become executable only after authoritative integrations exist.
  throw new BotToolExecutionError("TOOL_NOT_IMPLEMENTED", `Tool ${name} has no authoritative server implementation yet.`);
}

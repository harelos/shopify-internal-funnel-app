import { ShopifyAdminClient } from "./shopify-admin.js";

export interface BotOrderCandidate {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  createdAt?: string | null;
  fulfillments?: Array<{
    status?: string | null;
    deliveredAt?: string | null;
    trackingInfo?: Array<{ company?: string | null; number?: string | null; url?: string | null }>;
  }>;
}

export interface BotVerifiedOrderSummary {
  id: string;
  name: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  createdAt: string | null;
  fulfillments: Array<{
    status: string | null;
    deliveredAt: string | null;
    trackingInfo: Array<{ company: string | null; number: string | null; url: string | null }>;
  }>;
}

function normalizeEmail(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value?: string | null): string {
  return String(value || "").replace(/\D/g, "");
}

export function normalizeOrderName(value: string): string {
  return String(value || "").trim().replace(/^#+/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
}

export function verifyOrderContact(candidate: BotOrderCandidate, claimed: { email?: string | null; phone?: string | null }): boolean {
  const claimedEmail = normalizeEmail(claimed.email);
  const claimedPhone = normalizePhone(claimed.phone);
  const actualEmail = normalizeEmail(candidate.email);
  const actualPhone = normalizePhone(candidate.phone);

  const emailMatch = Boolean(claimedEmail && actualEmail && claimedEmail === actualEmail);
  const phoneMatch = Boolean(claimedPhone && actualPhone && claimedPhone === actualPhone);
  return emailMatch || phoneMatch;
}

function safeSummary(candidate: BotOrderCandidate): BotVerifiedOrderSummary {
  return {
    id: candidate.id,
    name: candidate.name,
    displayFinancialStatus: candidate.displayFinancialStatus || null,
    displayFulfillmentStatus: candidate.displayFulfillmentStatus || null,
    createdAt: candidate.createdAt || null,
    fulfillments: (candidate.fulfillments || []).map(fulfillment => ({
      status: fulfillment.status || null,
      deliveredAt: fulfillment.deliveredAt || null,
      trackingInfo: (fulfillment.trackingInfo || []).map(item => ({
        company: item.company || null,
        number: item.number || null,
        url: item.url || null,
      })),
    })),
  };
}

export class BotShopifyOrderTool {
  constructor(private readonly admin = new ShopifyAdminClient()) {}

  async readVerifiedOrder(input: { orderName: string; email?: string | null; phone?: string | null; sessionToken?: string }): Promise<BotVerifiedOrderSummary> {
    const name = normalizeOrderName(input.orderName);
    if (!name) throw new Error("A valid order number is required.");
    if (!normalizeEmail(input.email) && !normalizePhone(input.phone)) {
      throw new Error("Order verification requires the customer email or phone used on the order.");
    }

    const queryText = `name:${name}`;
    const data = await this.admin.graphql<{
      orders: { nodes: BotOrderCandidate[] };
    }>(`query BotVerifiedOrder($query: String!) {
      orders(first: 3, query: $query) {
        nodes {
          id
          name
          email
          phone
          displayFinancialStatus
          displayFulfillmentStatus
          createdAt
          fulfillments {
            status
            deliveredAt
            trackingInfo(first: 10) { company number url }
          }
        }
      }
    }`, { query: queryText }, input.sessionToken);

    const exact = (data.orders?.nodes || []).find(order => normalizeOrderName(order.name) === name);
    if (!exact) throw new Error("Order not found.");
    if (!verifyOrderContact(exact, input)) {
      // Fail closed and do not reveal whether email/phone/order details partially matched.
      throw new Error("Order verification failed.");
    }
    return safeSummary(exact);
  }
}

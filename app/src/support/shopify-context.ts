import prisma from "../lib/db.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { assertSupportShopifyLookupEnabled, getSupportConfig } from "./config.js";

export type SupportShopifyTracking = {
  company: string | null;
  number: string | null;
  url: string | null;
};

export type SupportShopifyOrder = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string;
  total: {
    amount: string;
    currencyCode: string;
  } | null;
  lineItems: Array<{
    name: string;
    quantity: number;
    sku: string | null;
  }>;
  fulfillments: Array<{
    status: string;
    estimatedDeliveryAt: string | null;
    tracking: SupportShopifyTracking[];
  }>;
};

export type SupportShopifyContext = {
  readOnly: true;
  matchedEmail: string;
  orders: SupportShopifyOrder[];
  note: string;
};

type ShopifyOrdersResponse = {
  orders: {
    nodes: Array<{
      id: string;
      name: string;
      createdAt: string;
      processedAt?: string | null;
      cancelledAt?: string | null;
      displayFinancialStatus?: string | null;
      displayFulfillmentStatus: string;
      totalPriceSet?: {
        shopMoney?: {
          amount: string;
          currencyCode: string;
        } | null;
      } | null;
      lineItems?: {
        nodes?: Array<{
          name: string;
          quantity: number;
          sku?: string | null;
        }>;
      } | null;
      fulfillments?: Array<{
        status: string;
        estimatedDeliveryAt?: string | null;
        trackingInfo?: Array<{
          company?: string | null;
          number?: string | null;
          url?: string | null;
        }>;
      }> | null;
    }>;
  };
};

const ORDER_LOOKUP_QUERY = `
  query SupportOrdersByEmail($first: Int!, $query: String!) {
    orders(first: $first, query: $query, reverse: true) {
      nodes {
        id
        name
        createdAt
        processedAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        lineItems(first: 10) {
          nodes {
            name
            quantity
            sku
          }
        }
        fulfillments(first: 10) {
          status
          estimatedDeliveryAt
          trackingInfo(first: 10) {
            company
            number
            url
          }
        }
      }
    }
  }
`;

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || !email.includes("@") || /[\s"\\]/.test(email)) return null;
  return email;
}

export function buildShopifyOrderEmailQuery(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("A valid customer email is required for Shopify order lookup.");
  // Shopify's orders query supports the email: filter. The input is restricted
  // above so no extra search operators can be injected into the query string.
  return `email:${normalized}`;
}

export function customerEmailsFromParticipants(participants: string[], mailboxAddress: string): string[] {
  const mailbox = normalizeEmail(mailboxAddress);
  return [...new Set(participants
    .map(normalizeEmail)
    .filter((value): value is string => Boolean(value))
    .filter((value) => value !== mailbox))];
}

export function reduceShopifyOrders(payload: ShopifyOrdersResponse): SupportShopifyOrder[] {
  return (payload.orders?.nodes || []).map((order) => ({
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    processedAt: order.processedAt || null,
    cancelledAt: order.cancelledAt || null,
    financialStatus: order.displayFinancialStatus || null,
    fulfillmentStatus: order.displayFulfillmentStatus,
    total: order.totalPriceSet?.shopMoney
      ? {
          amount: order.totalPriceSet.shopMoney.amount,
          currencyCode: order.totalPriceSet.shopMoney.currencyCode,
        }
      : null,
    lineItems: (order.lineItems?.nodes || []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      sku: item.sku || null,
    })),
    fulfillments: (order.fulfillments || []).map((fulfillment) => ({
      status: fulfillment.status,
      estimatedDeliveryAt: fulfillment.estimatedDeliveryAt || null,
      tracking: (fulfillment.trackingInfo || []).map((tracking) => ({
        company: tracking.company || null,
        number: tracking.number || null,
        url: tracking.url || null,
      })),
    })),
  }));
}

export async function getSupportShopifyContext(threadId: string, sessionToken?: string): Promise<SupportShopifyContext> {
  const config = getSupportConfig();
  assertSupportShopifyLookupEnabled(config);

  const thread = await prisma.supportThread.findUnique({
    where: { id: threadId },
    select: { participantsJson: true },
  });
  if (!thread) throw new Error("Support thread not found.");

  let participants: string[] = [];
  try {
    const parsed = JSON.parse(thread.participantsJson || "[]");
    if (Array.isArray(parsed)) participants = parsed.map(String);
  } catch {
    participants = [];
  }

  const customerEmails = customerEmailsFromParticipants(participants, config.mailboxAddress);
  if (customerEmails.length === 0) {
    throw new Error("No customer email could be identified in this support thread.");
  }

  const client = new ShopifyAdminClient();
  let firstSuccessfulEmail = customerEmails[0];
  let orders: SupportShopifyOrder[] = [];

  // Try each non-mailbox participant until an order match is found. This avoids
  // persisting Shopify customer data or making broad customer-list queries.
  for (const email of customerEmails.slice(0, 3)) {
    const response = await client.graphql<ShopifyOrdersResponse>(
      ORDER_LOOKUP_QUERY,
      {
        first: config.shopifyOrderLimit,
        query: buildShopifyOrderEmailQuery(email),
      },
      sessionToken,
    );
    const reduced = reduceShopifyOrders(response);
    firstSuccessfulEmail = email;
    if (reduced.length > 0) {
      orders = reduced;
      break;
    }
  }

  return {
    readOnly: true,
    matchedEmail: firstSuccessfulEmail,
    orders,
    note: "Read-only Shopify order context. No Shopify customer record or order payload is persisted by this lookup.",
  };
}

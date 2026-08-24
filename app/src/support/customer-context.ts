import prisma from "../lib/db.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { assertSupportShopifyCustomerLookupEnabled, getSupportConfig } from "./config.js";
import { customerEmailsFromParticipants } from "./shopify-context.js";

export type MinimalSupportCustomer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

export type SupportCustomerContext = {
  readOnly: true;
  matchedEmail: string;
  customer: MinimalSupportCustomer | null;
  note: string;
};

type ShopifyCustomersResponse = {
  customers: {
    nodes: Array<{
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      defaultEmailAddress?: { emailAddress?: string | null } | null;
    }>;
  };
};

const CUSTOMER_LOOKUP_QUERY = `
  query SupportCustomerByEmail($query: String!) {
    customers(first: 2, query: $query) {
      nodes {
        id
        firstName
        lastName
        defaultEmailAddress {
          emailAddress
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

export function buildShopifyCustomerEmailQuery(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error("A valid customer email is required for Shopify customer lookup.");
  // Shopify customer search supports exact phrase matching for tokenized email.
  // The input is restricted above so search operators/quotes cannot be injected.
  return `email:"${normalized}"`;
}

export function reduceShopifyCustomer(payload: ShopifyCustomersResponse, expectedEmail: string): MinimalSupportCustomer | null {
  const normalizedExpected = normalizeEmail(expectedEmail);
  if (!normalizedExpected) return null;

  const exact = (payload.customers?.nodes || []).find((customer) => {
    const email = normalizeEmail(customer.defaultEmailAddress?.emailAddress || "");
    return email === normalizedExpected;
  });
  if (!exact) return null;

  return {
    id: exact.id,
    firstName: exact.firstName || null,
    lastName: exact.lastName || null,
    email: normalizeEmail(exact.defaultEmailAddress?.emailAddress || ""),
  };
}

export async function getSupportCustomerContext(threadId: string, sessionToken?: string): Promise<SupportCustomerContext> {
  const config = getSupportConfig();
  assertSupportShopifyCustomerLookupEnabled(config);

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
  if (customerEmails.length === 0) throw new Error("No customer email could be identified in this support thread.");

  const client = new ShopifyAdminClient();
  let matchedEmail = customerEmails[0];
  let customer: MinimalSupportCustomer | null = null;

  for (const email of customerEmails.slice(0, 3)) {
    const response = await client.graphql<ShopifyCustomersResponse>(
      CUSTOMER_LOOKUP_QUERY,
      { query: buildShopifyCustomerEmailQuery(email) },
      sessionToken,
    );
    matchedEmail = email;
    customer = reduceShopifyCustomer(response, email);
    if (customer) break;
  }

  return {
    readOnly: true,
    matchedEmail,
    customer,
    note: "Minimal read-only Shopify customer identity context. No address, phone, tags, spend, marketing, tax or broad customer profile data is requested or persisted.",
  };
}

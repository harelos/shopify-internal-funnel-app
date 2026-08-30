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

export interface BotProductSummary {
  id: string;
  title: string;
  handle: string;
  description: string;
  status: string | null;
  onlineStoreUrl: string | null;
  productType: string | null;
  vendor: string | null;
  options: Array<{ name: string; values: string[] }>;
  variants: Array<{
    id: string;
    title: string;
    sku: string | null;
    price: string | null;
    compareAtPrice: string | null;
    availableForSale: boolean | null;
    selectedOptions: Array<{ name: string; value: string }>;
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

function normalizeProductQuery(value?: string | null): string {
  return String(value || "").replace(/[\n\r{}<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function verifyOrderContact(candidate: BotOrderCandidate, claimed: { email?: string | null; phone?: string | null }): boolean {
  const claimedEmail = normalizeEmail(claimed.email);
  const claimedPhone = normalizePhone(claimed.phone);
  const actualEmail = normalizeEmail(candidate.email);
  const actualPhone = normalizePhone(candidate.phone);
  return Boolean((claimedEmail && actualEmail && claimedEmail === actualEmail) || (claimedPhone && actualPhone && claimedPhone === actualPhone));
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
      trackingInfo: (fulfillment.trackingInfo || []).map(item => ({ company: item.company || null, number: item.number || null, url: item.url || null })),
    })),
  };
}

function safeProductSummary(product: any): BotProductSummary {
  return {
    id: String(product.id || ""),
    title: String(product.title || ""),
    handle: String(product.handle || ""),
    description: String(product.description || "").slice(0, 4000),
    status: product.status ? String(product.status) : null,
    onlineStoreUrl: product.onlineStoreUrl ? String(product.onlineStoreUrl) : null,
    productType: product.productType ? String(product.productType) : null,
    vendor: product.vendor ? String(product.vendor) : null,
    options: (product.options || []).map((option: any) => ({ name: String(option.name || ""), values: (option.values || []).map((value: unknown) => String(value)) })),
    variants: (product.variants?.nodes || []).map((variant: any) => ({
      id: String(variant.id || ""),
      title: String(variant.title || ""),
      sku: variant.sku ? String(variant.sku) : null,
      price: variant.price ? String(variant.price) : null,
      compareAtPrice: variant.compareAtPrice ? String(variant.compareAtPrice) : null,
      availableForSale: typeof variant.availableForSale === "boolean" ? variant.availableForSale : null,
      selectedOptions: (variant.selectedOptions || []).map((option: any) => ({ name: String(option.name || ""), value: String(option.value || "") })),
    })),
  };
}

export class BotShopifyProductTool {
  constructor(private readonly admin = new ShopifyAdminClient()) {}

  async readProduct(input: { productId?: string | null; handle?: string | null; query?: string | null; sessionToken?: string }): Promise<BotProductSummary[]> {
    const productId = String(input.productId || "").trim();
    const handle = normalizeProductQuery(input.handle);
    const query = normalizeProductQuery(input.query);
    const fields = `id title handle description status onlineStoreUrl productType vendor options { name values } variants(first: 50) { nodes { id title sku price compareAtPrice availableForSale selectedOptions { name value } } }`;

    if (productId.startsWith("gid://shopify/Product/")) {
      const data = await this.admin.graphql<{ product: any | null }>(`query BotProductById($id: ID!) { product(id: $id) { ${fields} } }`, { id: productId }, input.sessionToken);
      return data.product ? [safeProductSummary(data.product)] : [];
    }

    const search = handle ? `handle:${handle}` : query;
    if (!search) throw new Error("A product id, handle, or search query is required.");
    const data = await this.admin.graphql<{ products: { nodes: any[] } }>(`query BotProductSearch($query: String!) { products(first: 5, query: $query) { nodes { ${fields} } } }`, { query: search }, input.sessionToken);
    return (data.products?.nodes || []).map(safeProductSummary);
  }
}

export class BotShopifyOrderTool {
  constructor(private readonly admin = new ShopifyAdminClient()) {}

  async readVerifiedOrder(input: { orderName: string; email?: string | null; phone?: string | null; sessionToken?: string }): Promise<BotVerifiedOrderSummary> {
    const name = normalizeOrderName(input.orderName);
    if (!name) throw new Error("A valid order number is required.");
    if (!normalizeEmail(input.email) && !normalizePhone(input.phone)) throw new Error("Order verification requires the customer email or phone used on the order.");

    const data = await this.admin.graphql<{ orders: { nodes: BotOrderCandidate[] } }>(`query BotVerifiedOrder($query: String!) {
      orders(first: 3, query: $query) {
        nodes { id name email phone displayFinancialStatus displayFulfillmentStatus createdAt fulfillments { status deliveredAt trackingInfo(first: 10) { company number url } } }
      }
    }`, { query: `name:${name}` }, input.sessionToken);

    const exact = (data.orders?.nodes || []).find(order => normalizeOrderName(order.name) === name);
    if (!exact) throw new Error("Order not found.");
    if (!verifyOrderContact(exact, input)) throw new Error("Order verification failed.");
    return safeSummary(exact);
  }
}

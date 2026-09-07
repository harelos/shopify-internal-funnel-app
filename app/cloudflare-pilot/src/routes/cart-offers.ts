import { Router, type Request } from "express";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { workerEnvValue } from "../lib/shopify-config.js";
import {
  discountFixedAmount,
  type CartOfferConfig,
  type CartOfferItem,
  validateCartOfferConfig,
} from "../lib/cart-offer-config.js";
import {
  loadCartOfferConfig,
  publishCartOfferConfig,
  saveCartOfferDraft,
} from "../lib/cart-offer-config-store.js";

const admin = Router();
const storefront = Router();
const shopify = new ShopifyAdminClient();

type ProductImage = { url: string; altText: string | null };
type ProductVariantNode = {
  id: string;
  title: string;
  availableForSale: boolean;
  price: string;
  compareAtPrice: string | null;
  contextualPricing: {
    price: { amount: string; currencyCode: string };
    compareAtPrice: { amount: string; currencyCode: string } | null;
  };
  product: {
    id: string;
    title: string;
    handle: string;
    status: string;
    featuredMedia: { preview: { image: ProductImage | null } | null } | null;
  };
};

const PRODUCT_SEARCH = `query CartOfferProductSearch($query: String!, $first: Int!) {
  shop { currencyCode }
  products(first: $first, query: $query, sortKey: TITLE) {
    nodes {
      id title handle status
      featuredMedia { preview { image { url altText } } }
      variants(first: 50) {
        nodes {
          id title availableForSale price compareAtPrice
          contextualPricing(context: {country: IL}) {
            price { amount currencyCode }
            compareAtPrice { amount currencyCode }
          }
        }
      }
    }
  }
}`;

const VARIANT_RESOLVE = `query CartOfferVariants($ids: [ID!]!) {
  shop { currencyCode }
  nodes(ids: $ids) {
    ... on ProductVariant {
      id title availableForSale price compareAtPrice
      contextualPricing(context: {country: IL}) {
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
      }
      product {
        id title handle status
        featuredMedia { preview { image { url altText } } }
      }
    }
  }
}`;

const DISCOUNT_CREATE = `mutation CartOfferDiscountCreate($input: DiscountAutomaticBasicInput!) {
  discountAutomaticBasicCreate(automaticBasicDiscount: $input) {
    automaticDiscountNode { id }
    userErrors { field code message }
  }
}`;

const DISCOUNT_DELETE = `mutation CartOfferDiscountDelete($id: ID!) {
  discountAutomaticDelete(id: $id) {
    deletedAutomaticDiscountId
    userErrors { field code message }
  }
}`;

function configuredAccessToken(): string | undefined {
  return workerEnvValue("SHOPIFY_ADMIN_ACCESS_TOKEN") || workerEnvValue("SHOPIFY_ACCESS_TOKEN") || undefined;
}

function sessionToken(req: Request): string | undefined {
  const authorization = req.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
}

async function adminGraphql<T>(req: Request, query: string, variables: Record<string, unknown>): Promise<T> {
  const offlineToken = configuredAccessToken();
  return shopify.graphql<T>(query, variables, offlineToken ? undefined : sessionToken(req), offlineToken);
}

function productImage(product: ProductVariantNode["product"]): ProductImage | null {
  return product.featuredMedia?.preview?.image ?? null;
}

function numericId(gid: string): number {
  return Number(gid.split("/").pop());
}

function publicConfig(config: CartOfferConfig) {
  const expose = (item: CartOfferItem) => ({
    id: item.id,
    kind: item.kind,
    variantId: numericId(item.variantId),
    title: item.title,
    price: `₪${item.priceIls}`,
    compare: item.compareAtIls ? `₪${item.compareAtIls}` : "",
    anchorText: item.anchorText,
    buttonText: item.buttonText,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
  });
  return {
    schemaVersion: config.schemaVersion,
    currency: config.currency,
    carouselTitle: config.carouselTitle,
    carousel: config.carousel.filter(item => item.enabled).map(expose),
    bumps: config.bumps.filter(item => item.enabled).map(expose),
  };
}

async function resolveVariants(req: Request, ids: string[]): Promise<{
  storeCurrency: string;
  variants: Map<string, ProductVariantNode>;
}> {
  if (!ids.length) return { storeCurrency: "", variants: new Map() };
  const data = await adminGraphql<{
    shop: { currencyCode: string };
    nodes: Array<ProductVariantNode | null>;
  }>(req, VARIANT_RESOLVE, { ids });
  return {
    storeCurrency: data.shop.currencyCode,
    variants: new Map(data.nodes.filter((node): node is ProductVariantNode => Boolean(node?.id)).map(node => [node.id, node])),
  };
}

function ilsPrice(
  variant: Pick<ProductVariantNode, "price" | "compareAtPrice" | "contextualPricing">,
  storeCurrency: string,
): {
  amount: string;
  compareAtAmount: string;
  currency: string;
} {
  if (storeCurrency === "ILS") {
    return {
      amount: Number(variant.price).toFixed(2),
      compareAtAmount: variant.compareAtPrice ? Number(variant.compareAtPrice).toFixed(2) : "",
      currency: "ILS",
    };
  }
  return {
    amount: Number(variant.contextualPricing.price.amount).toFixed(2),
    compareAtAmount: variant.contextualPricing.compareAtPrice
      ? Number(variant.contextualPricing.compareAtPrice.amount).toFixed(2)
      : "",
    currency: variant.contextualPricing.price.currencyCode,
  };
}

function discountTitle(item: CartOfferItem): string {
  return `[FunnelControl fixed-v1] NOVAHAIR — ${item.title} ב־₪${item.priceIls}`.slice(0, 255);
}

async function createOfferDiscount(req: Request, item: CartOfferItem): Promise<string> {
  const amount = discountFixedAmount(item.storefrontPriceIls, item.priceIls);
  if (!amount) return "";

  const input = {
    title: discountTitle(item),
    startsAt: new Date(Date.now() - 60_000).toISOString(),
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: true,
      shippingDiscounts: false,
    },
    customerGets: {
      value: { discountAmount: { amount, appliesOnEachItem: true } },
      items: { products: { productVariantsToAdd: [item.variantId] } },
    },
  };
  const data = await adminGraphql<{
    discountAutomaticBasicCreate: {
      automaticDiscountNode: { id: string } | null;
      userErrors: Array<{ field: string[] | null; code: string | null; message: string }>;
    };
  }>(req, DISCOUNT_CREATE, { input });
  const result = data.discountAutomaticBasicCreate;
  if (result.userErrors.length || !result.automaticDiscountNode?.id) {
    throw new Error(result.userErrors.map(error => error.message).join("; ") || "Shopify did not create the offer discount.");
  }
  return result.automaticDiscountNode.id;
}

async function deleteOfferDiscount(req: Request, id: string): Promise<void> {
  if (!id) return;
  const data = await adminGraphql<{
    discountAutomaticDelete: {
      deletedAutomaticDiscountId: string | null;
      userErrors: Array<{ message: string }>;
    };
  }>(req, DISCOUNT_DELETE, { id });
  if (data.discountAutomaticDelete.userErrors.length) {
    throw new Error(data.discountAutomaticDelete.userErrors.map(error => error.message).join("; "));
  }
}

async function hydrateForPublish(req: Request, config: CartOfferConfig): Promise<CartOfferConfig> {
  const allItems = [...config.carousel, ...config.bumps];
  const resolved = await resolveVariants(req, [...new Set(allItems.map(item => item.variantId))]);
  const errors: string[] = [];
  const hydrate = (item: CartOfferItem): CartOfferItem => {
    const variant = resolved.variants.get(item.variantId);
    if (!variant) {
      errors.push(`${item.title}: Shopify variant was not found.`);
      return item;
    }
    if (!variant.availableForSale) errors.push(`${item.title}: Shopify variant is not available for sale.`);
    const livePrice = ilsPrice(variant, resolved.storeCurrency);
    if (livePrice.currency !== "ILS") {
      errors.push(`${item.title}: Israel market price is not in ILS.`);
    }
    const storefrontPriceIls = livePrice.amount;
    if (Number(item.priceIls) > Number(storefrontPriceIls)) {
      errors.push(`${item.title}: offer price ₪${item.priceIls} exceeds the live Shopify price ₪${storefrontPriceIls}.`);
    }
    const image = productImage(variant.product);
    return {
      ...item,
      productId: variant.product.id,
      productTitle: variant.product.title,
      variantTitle: variant.title,
      storefrontPriceIls,
      discountStrategy: "fixed_amount_v1",
      imageUrl: item.imageUrl || image?.url || "",
      imageAlt: item.imageAlt || image?.altText || item.title,
      discountNodeId: "",
    };
  };
  const hydrated = {
    ...config,
    carousel: config.carousel.map(hydrate),
    bumps: config.bumps.map(hydrate),
  };
  if (errors.length) throw new Error(errors.join(" "));
  return hydrated;
}

storefront.get("/cart-offers-config", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const stored = await loadCartOfferConfig();
    return res.json({ ok: true, revision: stored.publishedRevision, config: publicConfig(stored.published) });
  } catch (error) {
    console.error("[CART OFFER STOREFRONT READ FAILED]", error);
    return res.status(503).json({ ok: false, error: "Cart offers are temporarily unavailable." });
  }
});

admin.get("/cart-offers", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    return res.json({ ok: true, ...(await loadCartOfferConfig()) });
  } catch (error) {
    console.error("[CART OFFER ADMIN READ FAILED]", error);
    return res.status(503).json({ error: "Cart offer configuration is unavailable." });
  }
});

admin.get("/cart-offers/products", async (req, res) => {
  const raw = String(req.query.query ?? "").trim().slice(0, 80);
  const safe = raw.replace(/[\\"():]/g, " ").replace(/\s+/g, " ").trim();
  const query = safe || "status:active";
  try {
    const data = await adminGraphql<{
      shop: { currencyCode: string };
      products: { nodes: Array<{
        id: string; title: string; handle: string; status: string;
        featuredMedia: { preview: { image: ProductImage | null } | null } | null;
        variants: { nodes: Array<Omit<ProductVariantNode, "product">> };
      }> };
    }>(req, PRODUCT_SEARCH, { query, first: 50 });
    const products = data.products.nodes.flatMap(product => {
      const image = product.featuredMedia?.preview?.image ?? null;
      return product.variants.nodes.map(variant => {
        const livePrice = ilsPrice(variant, data.shop.currencyCode);
        return ({
        productId: product.id,
        productTitle: product.title,
        handle: product.handle,
        status: product.status,
        variantId: variant.id,
        variantTitle: variant.title,
        availableForSale: variant.availableForSale,
        priceIls: livePrice.amount,
        currency: livePrice.currency,
        compareAtIls: livePrice.compareAtAmount,
        imageUrl: image?.url ?? "",
        imageAlt: image?.altText ?? product.title,
        });
      });
    });
    return res.json({ ok: true, products });
  } catch (error) {
    console.error("[CART OFFER PRODUCT SEARCH FAILED]", error);
    return res.status(502).json({ error: "Could not search Shopify products." });
  }
});

admin.put("/cart-offers/draft", async (req, res) => {
  const candidate = req.body && typeof req.body === "object" && "config" in req.body
    ? (req.body as { config?: unknown }).config
    : req.body;
  const validated = validateCartOfferConfig(candidate);
  if (!validated.ok) return res.status(400).json({ error: "Invalid cart offer configuration.", errors: validated.errors });
  try {
    return res.json({ ok: true, ...(await saveCartOfferDraft(validated.value)) });
  } catch (error) {
    console.error("[CART OFFER DRAFT SAVE FAILED]", error);
    return res.status(503).json({ error: "Could not save the cart offer draft." });
  }
});

admin.post("/cart-offers/publish", async (req, res) => {
  const candidate = req.body && typeof req.body === "object" && "config" in req.body
    ? (req.body as { config?: unknown }).config
    : req.body;
  const validated = validateCartOfferConfig(candidate);
  if (!validated.ok) return res.status(400).json({ error: "Invalid cart offer configuration.", errors: validated.errors });

  const createdDiscounts: string[] = [];
  try {
    const current = await loadCartOfferConfig();
    const hydrated = await hydrateForPublish(req, validated.value);
    const currentItems = new Map(
      [...current.published.carousel, ...current.published.bumps].map(item => [item.id, item]),
    );
    for (const item of [...hydrated.carousel, ...hydrated.bumps]) {
      if (!item.enabled) continue;
      const previous = currentItems.get(item.id);
      if (
        previous?.discountNodeId
        && previous.variantId === item.variantId
        && previous.priceIls === item.priceIls
        && previous.storefrontPriceIls === item.storefrontPriceIls
        && previous.discountStrategy === item.discountStrategy
      ) {
        item.discountNodeId = previous.discountNodeId;
        continue;
      }
      item.discountNodeId = await createOfferDiscount(req, item);
      if (item.discountNodeId) createdDiscounts.push(item.discountNodeId);
    }

    const stored = await publishCartOfferConfig(hydrated);
    const retainedDiscounts = new Set(
      [...hydrated.carousel, ...hydrated.bumps].map(item => item.discountNodeId).filter(Boolean),
    );
    const oldDiscounts = [...current.published.carousel, ...current.published.bumps]
      .map(item => item.discountNodeId)
      .filter((id): id is string => Boolean(id) && !retainedDiscounts.has(id));
    const cleanupErrors: string[] = [];
    for (const id of [...new Set(oldDiscounts)]) {
      try {
        await deleteOfferDiscount(req, id);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return res.json({ ok: true, ...stored, cleanupErrors });
  } catch (error) {
    for (const id of createdDiscounts.reverse()) {
      try { await deleteOfferDiscount(req, id); } catch { /* best-effort rollback */ }
    }
    console.error("[CART OFFER PUBLISH FAILED]", error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "Could not publish cart offers." });
  }
});

export { admin as cartOfferAdmin, storefront as cartOfferStorefront };

export const CART_OFFER_CONFIG_ID = "novahair-side-cart";
export const CART_OFFER_SCHEMA_VERSION = 1;
export const CART_OFFER_MAX_CAROUSEL_ITEMS = 12;
export const CART_OFFER_MAX_BUMPS = 8;

export type CartOfferKind = "carousel" | "bump";

export interface CartOfferItem {
  id: string;
  kind: CartOfferKind;
  enabled: boolean;
  position: number;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  title: string;
  priceIls: string;
  compareAtIls: string;
  anchorText: string;
  buttonText: string;
  imageUrl: string;
  imageAlt: string;
  storefrontPriceIls: string;
  discountNodeId: string;
  discountStrategy?: "fixed_amount_v1";
}

export interface CartOfferConfig {
  schemaVersion: 1;
  currency: "ILS";
  carouselTitle: string;
  carousel: CartOfferItem[];
  bumps: CartOfferItem[];
}

export interface CartOfferValidationResult {
  ok: boolean;
  value: CartOfferConfig;
  errors: string[];
}

const CDN_IMAGE = /^https:\/\/cdn\.shopify\.com\//i;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const DISCOUNT_GID = /^gid:\/\/shopify\/DiscountAutomaticNode\/\d+$/;
const MONEY = /^(0|[1-9]\d{0,5})(?:\.\d{1,2})?$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function money(value: unknown): string {
  const candidate = text(value, 16).replace(/^₪\s*/, "");
  if (!MONEY.test(candidate) || Number(candidate) <= 0) return "";
  return Number(candidate).toFixed(2);
}

function gid(value: unknown, pattern: RegExp): string {
  const candidate = text(value, 100);
  return pattern.test(candidate) ? candidate : "";
}

function normalizeItem(value: unknown, kind: CartOfferKind, index: number, errors: string[]): CartOfferItem {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const prefix = `${kind}[${index}]`;
  const id = text(source.id, 80) || `${kind}-${index + 1}`;
  const productId = gid(source.productId, PRODUCT_GID);
  const variantId = gid(source.variantId, VARIANT_GID);
  const title = text(source.title, 90);
  const priceIls = money(source.priceIls);
  const compareAtIls = source.compareAtIls ? money(source.compareAtIls) : "";
  const imageUrl = text(source.imageUrl, 700);
  const discountNodeId = source.discountNodeId ? gid(source.discountNodeId, DISCOUNT_GID) : "";

  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id)) errors.push(`${prefix}.id is invalid`);
  if (!productId) errors.push(`${prefix}.productId must be a Shopify product GID`);
  if (!variantId) errors.push(`${prefix}.variantId must be a Shopify variant GID`);
  if (!title) errors.push(`${prefix}.title is required`);
  if (!priceIls) errors.push(`${prefix}.priceIls must be a positive ILS amount with at most two decimals`);
  if (source.compareAtIls && !compareAtIls) errors.push(`${prefix}.compareAtIls is invalid`);
  if (compareAtIls && priceIls && Number(compareAtIls) < Number(priceIls)) {
    errors.push(`${prefix}.compareAtIls cannot be lower than priceIls`);
  }
  if (imageUrl && !CDN_IMAGE.test(imageUrl)) errors.push(`${prefix}.imageUrl must use Shopify CDN`);
  if (source.discountNodeId && !discountNodeId) errors.push(`${prefix}.discountNodeId is invalid`);

  return {
    id,
    kind,
    enabled: source.enabled !== false,
    position: index,
    productId,
    variantId,
    productTitle: text(source.productTitle, 140),
    variantTitle: text(source.variantTitle, 100),
    title,
    priceIls,
    compareAtIls,
    anchorText: text(source.anchorText, 70),
    buttonText: text(source.buttonText, 30) || (kind === "carousel" ? "הוספה" : "הוסיפי להזמנה"),
    imageUrl,
    imageAlt: text(source.imageAlt, 140) || title,
    storefrontPriceIls: source.storefrontPriceIls ? money(source.storefrontPriceIls) : "",
    discountNodeId,
    discountStrategy: source.discountStrategy === "fixed_amount_v1" ? "fixed_amount_v1" : undefined,
  };
}

export function validateCartOfferConfig(input: unknown): CartOfferValidationResult {
  const errors: string[] = [];
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const carouselInput = Array.isArray(source.carousel) ? source.carousel : [];
  const bumpsInput = Array.isArray(source.bumps) ? source.bumps : [];

  if (carouselInput.length > CART_OFFER_MAX_CAROUSEL_ITEMS) {
    errors.push(`carousel supports at most ${CART_OFFER_MAX_CAROUSEL_ITEMS} items`);
  }
  if (bumpsInput.length > CART_OFFER_MAX_BUMPS) {
    errors.push(`bumps supports at most ${CART_OFFER_MAX_BUMPS} items`);
  }

  const carousel = carouselInput.slice(0, CART_OFFER_MAX_CAROUSEL_ITEMS)
    .map((item, index) => normalizeItem(item, "carousel", index, errors));
  const bumps = bumpsInput.slice(0, CART_OFFER_MAX_BUMPS)
    .map((item, index) => normalizeItem(item, "bump", index, errors));
  const ids = [...carousel, ...bumps].map(item => item.id);
  if (new Set(ids).size !== ids.length) errors.push("offer item ids must be unique");

  return {
    ok: errors.length === 0,
    errors,
    value: {
      schemaVersion: CART_OFFER_SCHEMA_VERSION,
      currency: "ILS",
      carouselTitle: text(source.carouselTitle, 90) || "מוצרים משלימים במחיר מיוחד",
      carousel,
      bumps,
    },
  };
}

export function discountPercentage(storefrontPriceIls: string, offerPriceIls: string): number {
  const storefront = Number(storefrontPriceIls);
  const offer = Number(offerPriceIls);
  if (!Number.isFinite(storefront) || !Number.isFinite(offer) || storefront <= 0 || offer <= 0 || offer > storefront) {
    throw new Error("Offer price must be positive and cannot exceed the Shopify Israel price.");
  }
  if (Math.abs(storefront - offer) < 0.005) return 0;
  return Number((1 - offer / storefront).toFixed(8));
}

export function discountFixedAmount(storefrontPriceIls: string, offerPriceIls: string): string {
  const storefront = Number(storefrontPriceIls);
  const offer = Number(offerPriceIls);
  if (!Number.isFinite(storefront) || !Number.isFinite(offer) || storefront <= 0 || offer <= 0 || offer > storefront) {
    throw new Error("Offer price must be positive and cannot exceed the Shopify Israel price.");
  }
  if (Math.abs(storefront - offer) < 0.005) return "";
  return (storefront - offer).toFixed(2);
}

export const DEFAULT_CART_OFFER_CONFIG: CartOfferConfig = {
  schemaVersion: CART_OFFER_SCHEMA_VERSION,
  currency: "ILS",
  carouselTitle: "הוסיפי להזמנה במחיר מיוחד",
  carousel: [],
  bumps: [
    {
      id: "nova-argan-mask",
      kind: "bump",
      enabled: true,
      position: 0,
      productId: "gid://shopify/Product/10378614341927",
      variantId: "gid://shopify/ProductVariant/52010595320103",
      productTitle: "מסכת שיקום והזנה לשיער עם שמן ארגן",
      variantTitle: "Default Title",
      title: "מסכת הזנה לשיער",
      priceIls: "49.99",
      compareAtIls: "99.90",
      anchorText: "מעניקה לחות ומראה רך לאחר הצביעה.",
      buttonText: "הוסיפי להזמנה",
      imageUrl: "https://cdn.shopify.com/s/files/1/0719/2628/4583/files/342d988e-c92f-4cf5-b5d0-4d673b3e0c0d.png?v=1788651830",
      imageAlt: "מסכת הזנה לשיער עם שמן ארגן",
      storefrontPriceIls: "99.90",
      discountNodeId: "",
      discountStrategy: "fixed_amount_v1",
    },
    {
      id: "nova-keratin-serum",
      kind: "bump",
      enabled: true,
      position: 1,
      productId: "gid://shopify/Product/10378631971111",
      variantId: "gid://shopify/ProductVariant/52010652401959",
      productTitle: "סרום קרטין לשיער חלק, רך ומבריק",
      variantTitle: "50ml",
      title: "סרום קרטין משקם",
      priceIls: "44.99",
      compareAtIls: "89.90",
      anchorText: "מחליק, מרכך ומעניק ברק לשיער.",
      buttonText: "הוסיפי להזמנה",
      imageUrl: "https://cdn.shopify.com/s/files/1/0719/2628/4583/files/58336fc7-35f0-44a2-8874-912f4223b029.jpg?v=1788653644",
      imageAlt: "סרום קרטין משקם",
      storefrontPriceIls: "89.90",
      discountNodeId: "",
      discountStrategy: "fixed_amount_v1",
    },
    {
      id: "nova-hair-gloss",
      kind: "bump",
      enabled: true,
      position: 2,
      productId: "gid://shopify/Product/9943550624039",
      variantId: "gid://shopify/ProductVariant/50459892580647",
      productTitle: "ספריי היירגלוס לשיער",
      variantTitle: "בקבוק 100 מ\"ל",
      title: "ספריי ברק לשיער",
      priceIls: "39.99",
      compareAtIls: "79.90",
      anchorText: "שומר על מראה צבע רענן ומעניק ברק.",
      buttonText: "הוסיפי להזמנה",
      imageUrl: "https://cdn.shopify.com/s/files/1/0719/2628/4583/files/novahair-hair-gloss-bottle-only-v2.png?v=1789280943",
      imageAlt: "ספריי ברק לשיער",
      storefrontPriceIls: "79.90",
      discountNodeId: "",
      discountStrategy: "fixed_amount_v1",
    },
  ],
};

import { safeStorefrontUrl } from "./url";
import type { LifecycleFlow } from "./types";

const PATHS = {
  sales: "/pages/novahair-sales-staging",
  productInfo: "/pages/novahair",
  shadeGuide: "/pages/novahair-shade-guide",
  faq: "/pages/novahair-faq",
  howTo: "/blogs/beauty-guide/novahair-instructions-how-to-use",
  contact: "/pages/contact",
  tracking: "/apps/17TRACK",
  shippingPolicy: "/policies/shipping-policy",
  refundPolicy: "/policies/refund-policy",
} as const;

const STATIC_DESTINATIONS: Partial<Record<LifecycleFlow, Record<number, keyof typeof PATHS>>> = {
  welcome: {
    1: "sales",
    2: "productInfo",
    3: "howTo",
    4: "sales",
    5: "shadeGuide",
    6: "sales",
    7: "shadeGuide",
    8: "howTo",
    9: "productInfo",
    10: "sales",
  },
  abandoned_cart: {
    2: "shadeGuide",
    3: "sales",
    4: "faq",
  },
  browse_abandonment: {
    1: "shadeGuide",
    2: "productInfo",
    3: "sales",
  },
  post_purchase: {
    1: "howTo",
    2: "howTo",
    5: "howTo",
    6: "contact",
    7: "faq",
    // A dedicated verified-review form is not currently available. The contact
    // page is an honest submission route instead of pretending the sales page
    // can collect a review.
    8: "contact",
  },
  replenishment: {
    1: "sales",
    2: "sales",
    3: "sales",
    4: "sales",
  },
};

export function staticLifecycleDestination(
  storefrontDomain: string,
  flow: LifecycleFlow,
  emailNumber: number,
): string | null {
  const key = STATIC_DESTINATIONS[flow]?.[emailNumber];
  return key ? safeStorefrontUrl(storefrontDomain, PATHS[key]) : null;
}

export function brandedTrackingDestination(storefrontDomain: string, trackingNumber: string): string {
  const cleaned = trackingNumber.trim();
  if (!/^[A-Za-z0-9-]{5,50}$/.test(cleaned)) throw new Error("invalid_tracking_number");
  const url = new URL(safeStorefrontUrl(storefrontDomain, PATHS.tracking));
  url.searchParams.set("nums", cleaned);
  return url.toString();
}

export function safeCompletedCheckoutDestination(storefrontDomain: string): string {
  return safeStorefrontUrl(storefrontDomain, PATHS.sales);
}

export function secondaryLifecycleDestination(
  storefrontDomain: string,
  key: keyof typeof PATHS,
): string {
  return safeStorefrontUrl(storefrontDomain, PATHS[key]);
}

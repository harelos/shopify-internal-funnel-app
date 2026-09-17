export const EXPECTED_SHOPIFY_PIXEL_ENDPOINT =
  "https://shopify-funnel-control.tigerbrands-funnel.workers.dev/api/shopify/pixel";

export type ShopifyWebPixelRecord = {
  id: string;
  settings: unknown;
} | null;

function containsExpectedEndpoint(value: unknown): boolean {
  if (typeof value === "string") {
    if (value === EXPECTED_SHOPIFY_PIXEL_ENDPOINT) return true;
    try {
      return containsExpectedEndpoint(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsExpectedEndpoint);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some(containsExpectedEndpoint);
  }
  return false;
}

export function publicShopifyPixelStatus(pixel: ShopifyWebPixelRecord) {
  const configured = Boolean(pixel?.id);
  const endpointMatches = configured && containsExpectedEndpoint(pixel?.settings);
  return {
    state: configured && endpointMatches ? "CURRENT" : "ATTENTION",
    configured,
    pixelIdPresent: configured,
    endpointMatches,
    expectedEndpointHost: new URL(EXPECTED_SHOPIFY_PIXEL_ENDPOINT).host,
  };
}

import type { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { publicShopifyPixelStatus } from "../lib/shopify-pixel-status.js";

export type ShopifyPixelProbeReason =
  | "VERIFIED"
  | "PIXEL_NOT_CONFIGURED"
  | "ENDPOINT_MISMATCH"
  | "READ_PIXELS_SCOPE_NOT_GRANTED"
  | "TOKEN_EXCHANGE_FAILED"
  | "SHOPIFY_ACCESS_DENIED"
  | "SHOPIFY_QUERY_FAILED";

function failureReason(error: unknown): ShopifyPixelProbeReason {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("token exchange") || message.includes("client credentials")) return "TOKEN_EXCHANGE_FAILED";
  if (message.includes("access denied") || message.includes("forbidden") || message.includes("http 403")) return "SHOPIFY_ACCESS_DENIED";
  return "SHOPIFY_QUERY_FAILED";
}

export async function probeShopifyPixelHealth(
  shopify: Pick<ShopifyAdminClient, "appAccessScopes" | "webPixelConfiguration">,
  sessionToken?: string,
) {
  try {
    const scopeData = await shopify.appAccessScopes(sessionToken);
    const handles = scopeData.currentAppInstallation.accessScopes.map(scope => scope.handle);
    if (!handles.includes("read_pixels")) {
      return {
        ok: true as const,
        state: "ATTENTION",
        configured: false,
        pixelIdPresent: false,
        endpointMatches: false,
        pixelReadScopeGranted: false,
        reason: "READ_PIXELS_SCOPE_NOT_GRANTED" as const,
        expectedEndpointHost: null,
      };
    }

    const data = await shopify.webPixelConfiguration(sessionToken);
    const status = publicShopifyPixelStatus(data.webPixel);
    return {
      ok: true as const,
      ...status,
      pixelReadScopeGranted: true,
      reason: !status.configured
        ? "PIXEL_NOT_CONFIGURED" as const
        : status.endpointMatches
          ? "VERIFIED" as const
          : "ENDPOINT_MISMATCH" as const,
    };
  } catch (error) {
    return {
      ok: false as const,
      state: "UNKNOWN",
      configured: false,
      pixelIdPresent: false,
      endpointMatches: false,
      pixelReadScopeGranted: null,
      reason: failureReason(error),
      expectedEndpointHost: null,
    };
  }
}

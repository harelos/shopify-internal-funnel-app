import { normalizeFunnelContext, type FunnelContext } from "./shopify-integration.js";

export interface ShopifyStoredContext {
  context: FunnelContext;
  elementAssignments: unknown;
}

type ShopifyAttribute = {
  key?: unknown;
  name?: unknown;
  value?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reads only the app-owned, pseudonymous cart attribute that Shopify carries to
 * an order. Customer names, email, phone, address and arbitrary order fields are
 * deliberately ignored.
 */
export function extractShopifyStoredContext(
  attributes: unknown,
  shopDomain: string,
): ShopifyStoredContext | null {
  if (!Array.isArray(attributes)) return null;
  const match = attributes.find(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const attribute = raw as ShopifyAttribute;
    return text(attribute.key ?? attribute.name) === "__funnel_context__";
  }) as ShopifyAttribute | undefined;
  const serialized = text(match?.value);
  if (!serialized || serialized.length > 12_000) return null;

  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const raw = parsed as Record<string, unknown>;
    const context = normalizeFunnelContext(raw, shopDomain);
    const hasContext = Boolean(
      context.visitorId
      || context.funnelId
      || context.stepId
      || context.variantId
      || context.firstTouch
      || context.lastTouch
      || context.posthogDistinctId
      || context.posthogSessionId
      || context.isInternal,
    );
    const elementAssignments = Array.isArray(raw.elementAssignments) ? raw.elementAssignments : [];
    return hasContext || elementAssignments.length ? { context, elementAssignments } : null;
  } catch {
    return null;
  }
}

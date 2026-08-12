/**
 * This local slice deliberately does not initialize Shopify auth or APIs. The official package is
 * retained in package.json for the future embedded React Router integration after owner approval.
 */
export const shopifyBoundary = {
  distribution: "custom-distribution",
  embedded: true,
  allowedShopEnvironmentKey: "ALLOWED_SHOP_DOMAIN",
  requiredScopes: ["read_orders", "write_app_proxy", "write_pixels", "read_customer_events"],
  checkoutBoundary: "Shopify Basic checkout is measured after native handoff; it is never an experiment target.",
} as const;

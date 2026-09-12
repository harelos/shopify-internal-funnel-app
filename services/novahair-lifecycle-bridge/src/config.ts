import type { LifecycleEnv, LifecycleMode } from "./types";

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

export function lifecycleMode(env: LifecycleEnv): LifecycleMode {
  const value = clean(env.LIFECYCLE_MODE).toLowerCase();
  if (value === "production") return "production";
  if (value === "test") return "test";
  return "disabled";
}

export function lifecycleConfig(env: LifecycleEnv) {
  const shopDomain = clean(env.SHOP_DOMAIN || env.ALLOWED_SHOP_DOMAIN).toLowerCase();
  const accessToken = clean(env.SHOPIFY_ADMIN_ACCESS_TOKEN || env.SHOPIFY_ACCESS_TOKEN);
  const webhookSecret = clean(env.SHOPIFY_WEBHOOK_SECRET || env.SHOPIFY_CLIENT_SECRET);
  return {
    mode: lifecycleMode(env),
    enabled: env.LIFECYCLE_ENABLED === "true",
    appUrl: clean(env.APP_URL).replace(/\/$/, ""),
    shopDomain,
    storefrontDomain: clean(env.SHOPIFY_STOREFRONT_DOMAIN).toLowerCase()
      || shopDomain.replace(/\.myshopify\.com$/i, ".com")
      || "tigerbrandsglobal.com",
    shopifyApiVersion: clean(env.SHOPIFY_API_VERSION) || "2026-07",
    shopifyAccessToken: accessToken,
    shopifyWebhookSecret: webhookSecret,
    resendApiKey: clean(env.RESEND_API_KEY),
    resendWebhookSecret: clean(env.RESEND_WEBHOOK_SECRET),
    resendFrom: clean(env.RESEND_FROM),
    resendReplyTo: clean(env.RESEND_REPLY_TO),
    testEmail: clean(env.LIFECYCLE_TEST_EMAIL).toLowerCase(),
    alertEmail: clean(env.LIFECYCLE_ALERT_EMAIL || env.LIFECYCLE_TEST_EMAIL).toLowerCase(),
    adminToken: clean(env.LIFECYCLE_ADMIN_TOKEN),
    dataKey: clean(env.LIFECYCLE_DATA_KEY),
    hashKey: clean(env.LIFECYCLE_HASH_KEY),
    activatedAt: clean(env.LIFECYCLE_ACTIVATED_AT),
    syncIntervalMinutes: boundedInteger(env.LIFECYCLE_SYNC_INTERVAL_MINUTES, 10, 5, 60),
    syncOverlapMinutes: boundedInteger(env.LIFECYCLE_SYNC_OVERLAP_MINUTES, 30, 10, 180),
    maxPages: boundedInteger(env.LIFECYCLE_MAX_PAGES, 10, 1, 30),
    // Both switches are required. This prevents a future enablement from
    // duplicating Shopify's own order/fulfillment messages by accident.
    shipmentCustomerMessagesEnabled: env.SHIPMENT_CUSTOMER_MESSAGES_ENABLED === "true"
      && env.SHIPMENT_NOTIFICATION_OWNERSHIP_VERIFIED === "true",
    shipmentNotificationOwnershipVerified: env.SHIPMENT_NOTIFICATION_OWNERSHIP_VERIFIED === "true",
  };
}

export function assertCoreConfiguration(env: LifecycleEnv): void {
  const config = lifecycleConfig(env);
  const missing: string[] = [];
  if (!env.DB) missing.push("DB");
  if (!config.shopDomain) missing.push("SHOP_DOMAIN");
  if (!config.shopifyAccessToken) missing.push("SHOPIFY_ACCESS_TOKEN");
  if (!config.dataKey) missing.push("LIFECYCLE_DATA_KEY");
  if (!config.hashKey) missing.push("LIFECYCLE_HASH_KEY");
  if (config.mode === "test" && !config.testEmail) missing.push("LIFECYCLE_TEST_EMAIL");
  if (["test", "production"].includes(config.mode) && !config.activatedAt) {
    missing.push("LIFECYCLE_ACTIVATED_AT");
  }
  if (missing.length) throw new Error(`lifecycle_configuration_missing:${missing.join(",")}`);
}

export function canDispatchTo(env: LifecycleEnv, email: string): boolean {
  const config = lifecycleConfig(env);
  if (!config.enabled || config.mode === "disabled") return false;
  if (config.mode === "test") return Boolean(config.testEmail) && email.trim().toLowerCase() === config.testEmail;
  return config.mode === "production";
}

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export type ShopifyDistribution = "custom" | "shopify-admin" | "unknown";

export interface ShopifyRuntimeConfig {
  shopDomain: string;
  appUrl: string;
  clientId: string;
  apiVersion: string;
  scopes: string[];
  liveConnect: boolean;
  requireEmbeddedAuth: boolean;
  distribution: ShopifyDistribution;
  hasClientSecret: boolean;
  hasAccessToken: boolean;
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function workerEnvValue(name: string): string {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return clean(envObj?.[name] ?? process.env[name]);
}

export function normalizeShopDomain(value: string | undefined): string {
  return clean(value).toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function isValidShopDomain(value: string | undefined): boolean {
  return SHOP_DOMAIN_PATTERN.test(normalizeShopDomain(value));
}

import { env as cloudflareEnv } from "cloudflare:workers";

export function getShopifyConfig(): ShopifyRuntimeConfig {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  const shopDomain = normalizeShopDomain(envObj?.SHOP_DOMAIN ?? envObj?.ALLOWED_SHOP_DOMAIN ?? process.env.SHOP_DOMAIN ?? process.env.ALLOWED_SHOP_DOMAIN);
  const distributionValue = clean(envObj?.SHOPIFY_DISTRIBUTION ?? process.env.SHOPIFY_DISTRIBUTION).toLowerCase();
  const distribution: ShopifyDistribution = distributionValue === "custom"
    ? "custom"
    : distributionValue === "shopify-admin"
      ? "shopify-admin"
      : "unknown";

  return {
    shopDomain,
    appUrl: clean(envObj?.APP_URL ?? envObj?.APPLICATION_URL ?? process.env.APP_URL ?? process.env.APPLICATION_URL),
    clientId: clean(envObj?.SHOPIFY_CLIENT_ID ?? envObj?.SHOPIFY_API_KEY ?? process.env.SHOPIFY_CLIENT_ID ?? process.env.SHOPIFY_API_KEY),
    apiVersion: clean(envObj?.SHOPIFY_API_VERSION ?? process.env.SHOPIFY_API_VERSION) || "2026-07",
    scopes: clean(envObj?.SHOPIFY_SCOPES ?? process.env.SHOPIFY_SCOPES)
      .split(",")
      .map(scope => scope.trim())
      .filter(Boolean),
    liveConnect: (envObj?.SHOPIFY_LIVE_CONNECT ?? process.env.SHOPIFY_LIVE_CONNECT) === "true",
    requireEmbeddedAuth: (envObj?.SHOPIFY_REQUIRE_AUTH ?? process.env.SHOPIFY_REQUIRE_AUTH) === "true",
    distribution,
    hasClientSecret: Boolean(clean(envObj?.SHOPIFY_CLIENT_SECRET ?? process.env.SHOPIFY_CLIENT_SECRET)),
    hasAccessToken: Boolean(clean(
      envObj?.SHOPIFY_ADMIN_ACCESS_TOKEN ?? envObj?.SHOPIFY_ACCESS_TOKEN
      ?? process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? process.env.SHOPIFY_ACCESS_TOKEN,
    )),
  };
}

export function missingShopifyConfiguration(): string[] {
  const config = getShopifyConfig();
  const missing: string[] = [];
  if (!isValidShopDomain(config.shopDomain)) missing.push("SHOP_DOMAIN");
  if (!config.clientId) missing.push("SHOPIFY_CLIENT_ID");
  if (!config.hasClientSecret) missing.push("SHOPIFY_CLIENT_SECRET");
  // Custom Distribution embedded apps obtain an Admin token by exchanging the
  // App Bridge session token. An Admin-created app instead needs a server-side
  // access token, but it cannot be embedded in Shopify Admin.
  if (config.distribution === "shopify-admin" && !config.hasAccessToken) {
    missing.push("SHOPIFY_ACCESS_TOKEN");
  }
  return missing;
}

export function publicShopifyStatus() {
  const config = getShopifyConfig();
  const missing = missingShopifyConfiguration();
  const adminCreatedCannotEmbed = config.distribution === "shopify-admin";

  return {
    ok: !adminCreatedCannotEmbed && missing.length === 0 && config.liveConnect,
    mode: config.liveConnect ? "live" : "local",
    shopDomain: config.shopDomain || null,
    apiVersion: config.apiVersion,
    distribution: config.distribution,
    embeddedAuthRequired: config.requireEmbeddedAuth,
    hasClientId: Boolean(config.clientId),
    hasClientSecret: config.hasClientSecret,
    hasAccessToken: config.hasAccessToken,
    tokenExchangeReady: config.distribution === "custom" && config.hasClientSecret && Boolean(config.clientId),
    missing,
    adminCreatedCannotEmbed,
    appProxyConfigured: Boolean(clean(process.env.SHOPIFY_APP_PROXY_URL)),
    note: adminCreatedCannotEmbed
      ? "Shopify Admin-created apps cannot be embedded. Create a Custom Distribution app in Dev Dashboard."
      : config.liveConnect
        ? (missing.length === 0
          ? "Live configuration is present."
          : "Live mode is enabled but required server variables are missing.")
        : "Live Shopify calls are disabled until a rotated credential is configured.",
  };
}

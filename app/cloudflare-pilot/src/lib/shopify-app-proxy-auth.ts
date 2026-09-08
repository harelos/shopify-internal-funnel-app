import { createHmac, timingSafeEqual } from "node:crypto";

const SHOP_DOMAIN_PATTERN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

type ProxyQuery = Record<string, unknown>;

function normalizeShopDomain(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function proxyQueryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item)).join(",");
  return String(value ?? "");
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyShopifyAppProxySignature(
  query: ProxyQuery,
  secret: string,
  expectedShop: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const signature = String(query.signature ?? "");
  const shop = normalizeShopDomain(query.shop);
  const timestamp = Number(query.timestamp);
  const allowlistedShop = normalizeShopDomain(expectedShop);
  if (!signature || !secret || !SHOP_DOMAIN_PATTERN.test(shop) || shop !== allowlistedShop) return false;
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > 300) return false;

  const message = Object.keys(query)
    .filter(key => key !== "signature")
    .sort()
    .map(key => `${key}=${proxyQueryValue(query[key])}`)
    .join("");
  const expected = createHmac("sha256", secret).update(message).digest("hex");
  return constantTimeHexEqual(expected, signature);
}

const STOREFRONT_PROXY_PATHS = new Set([
  "/track",
  "/popup/confirm-lead",
  "/popup/customer/capture",
  "/popup/customer/context",
  "/popup/customer/result-email",
  "/popup/customer/identify/start",
  "/popup/customer/identify/session",
  "/popup/customer/identify/verify",
  "/popup-trigger-config",
  "/cart-offers-config",
  "/ai-chat",
  "/ai-shade",
  "/proxy-health",
]);

export function isShopifyStorefrontProxyPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return STOREFRONT_PROXY_PATHS.has(normalized);
}

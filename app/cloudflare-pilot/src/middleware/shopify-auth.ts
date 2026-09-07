import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getShopifyConfig, isValidShopDomain, normalizeShopDomain, workerEnvValue } from "../lib/shopify-config.js";
import {
  isShopifyStorefrontProxyPath,
  verifyShopifyAppProxySignature,
} from "../lib/shopify-app-proxy-auth.js";

export { isShopifyStorefrontProxyPath } from "../lib/shopify-app-proxy-auth.js";

export interface ShopifySessionClaims {
  aud?: string;
  dest?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
  [key: string]: unknown;
}

function decodeJsonPart<T>(part: string): T | undefined {
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8")) as T;
  } catch {
    return undefined;
  }
}

function constantTimeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verifies Shopify's signed App Proxy query without trusting shop/user IDs. */
export function verifyShopifyAppProxyRequest(req: Request): boolean {
  const config = getShopifyConfig();
  const secret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
  return verifyShopifyAppProxySignature(req.query, secret, config.shopDomain);
}

export function verifyShopifySessionToken(token: string): ShopifySessionClaims {
  const config = getShopifyConfig();
  const parts = token.split(".");
  const clientSecret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
  if (parts.length !== 3 || !config.clientId || !clientSecret) {
    throw new Error("Shopify session authentication is not configured.");
  }

  const header = decodeJsonPart<{ alg?: string }>(parts[0]);
  const claims = decodeJsonPart<ShopifySessionClaims>(parts[1]);
  if (!header || header.alg !== "HS256" || !claims) throw new Error("Invalid Shopify session token.");

  const expected = createHmac("sha256", clientSecret)
    .update(`${parts[0]}.${parts[1]}`)
    .digest();
  const supplied = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (!constantTimeEqual(expected, supplied)) throw new Error("Invalid Shopify session token signature.");

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new Error("Shopify session token expired.");
  if (typeof claims.nbf === "number" && claims.nbf > now + 30) throw new Error("Shopify session token is not active.");
  if (claims.aud !== config.clientId) throw new Error("Shopify session token audience mismatch.");

  let tokenShop = "";
  try {
    tokenShop = normalizeShopDomain(new URL(String(claims.dest ?? "")).hostname);
  } catch {
    throw new Error("Shopify session token destination is invalid.");
  }
  if (!isValidShopDomain(tokenShop) || tokenShop !== normalizeShopDomain(config.shopDomain)) {
    throw new Error("Shopify session token shop is not allowlisted.");
  }

  return claims;
}

/**
 * Local mode is intentionally available for the owner preview. Set
 * SHOPIFY_REQUIRE_AUTH=true on a hosted deployment. App Bridge then supplies
 * the bearer session token to the same-origin API requests.
 */
export function requireShopifySession(req: Request, res: Response, next: NextFunction) {
  const config = getShopifyConfig();
  if (!config.requireEmbeddedAuth) return next();

  // Storefront tracking reaches the server through Shopify App Proxy rather
  // than App Bridge. It must carry Shopify's signed proxy query instead.
  const storefrontProxyPath = isShopifyStorefrontProxyPath(req.path);
  if (storefrontProxyPath && verifyShopifyAppProxyRequest(req)) {
    res.locals.shopifyAppProxy = true;
    return next();
  }
  if (storefrontProxyPath) {
    const requestShop = normalizeShopDomain(String(req.query.shop ?? ""));
    const expectedShop = normalizeShopDomain(config.shopDomain);
    const timestamp = Number(req.query.timestamp);
    const diagnostics = {
      path: req.path,
      queryKeys: Object.keys(req.query).sort(),
      shopMatches: Boolean(requestShop) && requestShop === expectedShop,
      timestampFresh: Number.isFinite(timestamp)
        && Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= 300,
      signatureShape: /^[a-f0-9]{64}$/i.test(String(req.query.signature ?? "")),
      secretConfigured: Boolean(workerEnvValue("SHOPIFY_CLIENT_SECRET")),
    };
    console.warn("[SHOPIFY APP PROXY REJECTED]", JSON.stringify(diagnostics));
  }
  if (req.path === "/shopify/pixel") return next();

  const authorization = req.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    res.setHeader("X-Shopify-Retry-Invalid-Session-Request", "1");
    return res.status(401).json({ error: "Shopify session token required." });
  }

  try {
    res.locals.shopifySession = verifyShopifySessionToken(token);
    return next();
  } catch {
    res.setHeader("X-Shopify-Retry-Invalid-Session-Request", "1");
    return res.status(401).json({ error: "Invalid Shopify session token." });
  }
}

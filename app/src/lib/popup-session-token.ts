import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type PopupIdentityTokenKind = "visitor" | "session";

export interface PopupVisitorClaims {
  v: 1;
  kind: "visitor";
  shop: string;
  visitorId: string;
  iat: number;
  exp: number;
  nonce: string;
}

export interface PopupSessionClaims {
  v: 1;
  kind: "session";
  shop: string;
  visitorId: string;
  sessionId: string;
  iat: number;
  exp: number;
  nonce: string;
}

export type PopupIdentityClaims = PopupVisitorClaims | PopupSessionClaims;

function cleanShop(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function secretValue(secret?: string): string {
  const value = secret || process.env.POPUP_SESSION_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "";
  if (value.length < 32) throw new Error("POPUP_SESSION_SECRET (or SHOPIFY_CLIENT_SECRET fallback) must be at least 32 characters.");
  return value;
}

function signBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

function encodeClaims(claims: PopupIdentityClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${body}.${signBody(body, secret)}`;
}

function validateShop(shop: string): string {
  const clean = cleanShop(shop);
  if (!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/.test(clean)) throw new Error("Invalid Shopify shop domain.");
  return clean;
}

export function issuePopupVisitorToken(input: {
  shopDomain: string;
  visitorId?: string;
  ttlSeconds?: number;
  secret?: string;
  nowSeconds?: number;
}): { token: string; claims: PopupVisitorClaims } {
  const secret = secretValue(input.secret);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.max(3600, Math.min(90 * 86_400, Math.floor(Number(input.ttlSeconds || 30 * 86_400))));
  const claims: PopupVisitorClaims = {
    v: 1,
    kind: "visitor",
    shop: validateShop(input.shopDomain),
    visitorId: String(input.visitorId || randomUUID()).slice(0, 128),
    iat: now,
    exp: now + ttl,
    nonce: randomUUID(),
  };
  return { token: encodeClaims(claims, secret), claims };
}

export function issuePopupSessionToken(input: {
  shopDomain: string;
  visitorId: string;
  sessionId?: string;
  ttlSeconds?: number;
  secret?: string;
  nowSeconds?: number;
}): { token: string; claims: PopupSessionClaims } {
  const secret = secretValue(input.secret);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = Math.max(300, Math.min(6 * 3600, Math.floor(Number(input.ttlSeconds || 2 * 3600))));
  const claims: PopupSessionClaims = {
    v: 1,
    kind: "session",
    shop: validateShop(input.shopDomain),
    visitorId: String(input.visitorId || "").slice(0, 128),
    sessionId: String(input.sessionId || randomUUID()).slice(0, 128),
    iat: now,
    exp: now + ttl,
    nonce: randomUUID(),
  };
  if (!claims.visitorId) throw new Error("visitorId is required for popup session tokens.");
  return { token: encodeClaims(claims, secret), claims };
}

export function verifyPopupIdentityToken(token: string, input: {
  expectedShopDomain: string;
  expectedKind?: PopupIdentityTokenKind;
  secret?: string;
  nowSeconds?: number;
}): PopupIdentityClaims {
  const secret = secretValue(input.secret);
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("Invalid popup identity token format.");
  const [body, signature] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) throw new Error("Invalid popup identity token signature.");

  const expected = createHmac("sha256", secret).update(body).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { throw new Error("Invalid popup identity token signature."); }
  if (supplied.toString("base64url") !== signature) throw new Error("Invalid popup identity token signature.");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid popup identity token signature.");

  let claims: PopupIdentityClaims;
  try { claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PopupIdentityClaims; } catch { throw new Error("Invalid popup identity token payload."); }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.v !== 1 || !["visitor", "session"].includes(claims.kind) || !claims.visitorId || !claims.nonce) throw new Error("Invalid popup identity claims.");
  if (cleanShop(claims.shop) !== cleanShop(input.expectedShopDomain)) throw new Error("Popup identity shop mismatch.");
  if (input.expectedKind && claims.kind !== input.expectedKind) throw new Error("Popup identity token kind mismatch.");
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Popup identity token expired.");
  if (claims.iat > now + 30) throw new Error("Popup identity token is not active yet.");
  if (claims.kind === "visitor" && claims.exp - claims.iat > 90 * 86_400) throw new Error("Popup visitor token lifetime exceeds policy.");
  if (claims.kind === "session") {
    if (!claims.sessionId) throw new Error("Invalid popup session claims.");
    if (claims.exp - claims.iat > 6 * 3600) throw new Error("Popup session token lifetime exceeds policy.");
  }
  return claims;
}

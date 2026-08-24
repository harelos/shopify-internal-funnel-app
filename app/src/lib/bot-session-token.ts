import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface BotSessionClaims {
  v: 1;
  shop: string;
  visitorId: string;
  iat: number;
  exp: number;
  nonce: string;
}

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decodeB64url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function cleanShop(value: string) {
  return String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function secretValue(secret?: string): string {
  const value = secret || process.env.BOT_SESSION_SECRET || "";
  if (value.length < 32) throw new Error("BOT_SESSION_SECRET must be at least 32 characters.");
  return value;
}

export function issueBotSessionToken(input: { shopDomain: string; visitorId?: string; ttlSeconds?: number; secret?: string }): { token: string; claims: BotSessionClaims } {
  const secret = secretValue(input.secret);
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(86_400, Math.floor(Number(input.ttlSeconds || 3600))));
  const claims: BotSessionClaims = {
    v: 1,
    shop: cleanShop(input.shopDomain),
    visitorId: String(input.visitorId || randomUUID()).slice(0, 128),
    iat: now,
    exp: now + ttl,
    nonce: randomUUID(),
  };
  if (!/^[a-z0-9][a-z0-9.-]*\.myshopify\.com$/.test(claims.shop)) throw new Error("Invalid Shopify shop domain.");
  const body = b64url(JSON.stringify(claims));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${signature}`, claims };
}

export function verifyBotSessionToken(token: string, input: { expectedShopDomain: string; secret?: string; nowSeconds?: number }): BotSessionClaims {
  const secret = secretValue(input.secret);
  const [body, signature, extra] = String(token || "").split(".");
  if (!body || !signature || extra) throw new Error("Invalid bot session token format.");
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(signature)) throw new Error("Invalid bot session token signature.");

  const expected = createHmac("sha256", secret).update(body).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { throw new Error("Invalid bot session token signature."); }

  // Node's base64url decoder accepts multiple non-canonical final characters
  // that can decode to the same bytes because of unused padding bits. Require
  // the exact canonical encoding before the constant-time byte comparison so a
  // textual signature mutation can never be accepted as an equivalent token.
  if (b64url(supplied) !== signature) throw new Error("Invalid bot session token signature.");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid bot session token signature.");

  let claims: BotSessionClaims;
  try { claims = JSON.parse(decodeB64url(body)) as BotSessionClaims; } catch { throw new Error("Invalid bot session token payload."); }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.v !== 1 || !claims.visitorId || !claims.nonce) throw new Error("Invalid bot session claims.");
  if (cleanShop(claims.shop) !== cleanShop(input.expectedShopDomain)) throw new Error("Bot session shop mismatch.");
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Bot session expired.");
  if (claims.iat > now + 30) throw new Error("Bot session is not active yet.");
  if (claims.exp - claims.iat > 86_400) throw new Error("Bot session lifetime exceeds policy.");
  return claims;
}

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { classifyCommerceTraffic, type QualifiedCommerceTrafficPolicy } from "../lib/popup-commerce-traffic.js";
import { normalizePopupSessionContext, toPopupEligibilityContext, type PopupClientSessionSnapshot } from "../lib/popup-session-context.js";
import { issuePopupSessionToken, issuePopupVisitorToken, verifyPopupIdentityToken, type PopupSessionClaims, type PopupVisitorClaims } from "../lib/popup-session-token.js";

const router = Router();

function currentShopDomain(): string {
  return String(process.env.SHOP_DOMAIN || "local-dev.myshopify.com").trim().toLowerCase();
}

function contextRuntimeState() {
  return {
    stagingEnabled: process.env.POPUP_STAGING_ENABLED === "true",
    collectorEnabled: process.env.POPUP_CONTEXT_COLLECTOR_ENABLED === "true",
    killSwitch: process.env.POPUP_KILL_SWITCH !== "false",
    storefrontPopupEnabled: false,
    persistsContext: false,
    customerStateLookupEnabled: false,
    boundary: "STAGING_CONTEXT_ONLY",
  } as const;
}

function allowedOrigins(): Set<string> {
  const origins = String(process.env.POPUP_ALLOWED_STOREFONT_ORIGINS || "")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const shop = currentShopDomain();
  if (shop && shop.endsWith(".myshopify.com")) origins.push(`https://${shop}`);
  return new Set(origins);
}

function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const clean = origin.trim().replace(/\/$/, "");
  return allowedOrigins().has(clean);
}

function requireContextGate(req: any, res: any, next: any) {
  const runtime = contextRuntimeState();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Origin");
  if (!runtime.stagingEnabled || !runtime.collectorEnabled || runtime.killSwitch) {
    return res.status(503).json({ error: "Popup session context collector is disabled by staging safety gates", runtime });
  }
  if (!originAllowed(typeof req.headers.origin === "string" ? req.headers.origin : undefined)) {
    return res.status(403).json({ error: "Storefront origin is not allowed for popup context collection" });
  }
  next();
}

function targetPolicy(): QualifiedCommerceTrafficPolicy {
  const countries = String(process.env.QUALIFIED_COMMERCE_TARGET_COUNTRIES || "IL")
    .split(",")
    .map(value => value.trim().toUpperCase())
    .filter(value => /^[A-Z]{2}$/.test(value));
  return { version: 1, targetCountries: countries.length ? countries : ["IL"] };
}

function tryVisitorToken(token: unknown): PopupVisitorClaims | null {
  if (typeof token !== "string" || !token) return null;
  try {
    const claims = verifyPopupIdentityToken(token, { expectedShopDomain: currentShopDomain(), expectedKind: "visitor" });
    return claims.kind === "visitor" ? claims : null;
  } catch {
    return null;
  }
}

function trySessionToken(token: unknown, visitorId: string): PopupSessionClaims | null {
  if (typeof token !== "string" || !token) return null;
  try {
    const claims = verifyPopupIdentityToken(token, { expectedShopDomain: currentShopDomain(), expectedKind: "session" });
    return claims.kind === "session" && claims.visitorId === visitorId ? claims : null;
  } catch {
    return null;
  }
}

router.get("/popup-runtime/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({ runtime: contextRuntimeState(), originAllowed: originAllowed(typeof req.headers.origin === "string" ? req.headers.origin : undefined) });
});

router.post("/popup-runtime/session/bootstrap", requireContextGate, (req, res) => {
  try {
    const existingVisitor = tryVisitorToken(req.body?.visitorToken);
    const issuedVisitor = existingVisitor ? null : issuePopupVisitorToken({ shopDomain: currentShopDomain() });
    const visitor = existingVisitor || issuedVisitor!.claims;
    const visitorToken = existingVisitor ? String(req.body.visitorToken) : issuedVisitor!.token;

    const existingSession = trySessionToken(req.body?.sessionToken, visitor.visitorId);
    const issuedSession = existingSession
      ? null
      : issuePopupSessionToken({ shopDomain: currentShopDomain(), visitorId: visitor.visitorId, sessionId: randomUUID() });
    const session = existingSession || issuedSession!.claims;
    const sessionToken = existingSession ? String(req.body.sessionToken) : issuedSession!.token;

    res.json({
      ok: true,
      visitorId: visitor.visitorId,
      sessionId: session.sessionId,
      visitorToken,
      sessionToken,
      expiresAt: {
        visitor: new Date(visitor.exp * 1000).toISOString(),
        session: new Date(session.exp * 1000).toISOString(),
      },
      runtime: contextRuntimeState(),
    });
  } catch (error: any) {
    res.status(503).json({ error: error?.message || "Popup identity bootstrap failed", runtime: contextRuntimeState() });
  }
});

router.post("/popup-runtime/session/context", requireContextGate, (req, res) => {
  try {
    const token = String(req.body?.sessionToken || "");
    const claims = verifyPopupIdentityToken(token, { expectedShopDomain: currentShopDomain(), expectedKind: "session" });
    if (claims.kind !== "session") return res.status(401).json({ error: "Valid popup session token required" });

    const snapshot = (req.body?.snapshot || {}) as PopupClientSessionSnapshot;
    const requestUserAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
    const allowTestCountryHeader = process.env.POPUP_ALLOW_TEST_CONTEXT === "true" && process.env.NODE_ENV !== "production";
    const normalized = normalizePopupSessionContext({
      ...snapshot,
      // Bot/browser evidence prefers what the HTTP request actually sent rather
      // than a separately supplied JSON field that can trivially disagree.
      userAgent: requestUserAgent || snapshot.userAgent,
    }, {
      headers: req.headers as Record<string, unknown>,
      allowTestCountryHeader,
      // Deliberately no browser-provided customer ID or purchase-history trust.
      // The read-only Shopify customer adapter will supply serverCustomer later.
      serverCustomer: null,
    });
    const eligibilityContext = toPopupEligibilityContext(normalized);
    const commerceTraffic = classifyCommerceTraffic(eligibilityContext, targetPolicy());

    res.json({
      ok: true,
      identity: { visitorId: claims.visitorId, sessionId: claims.sessionId, verified: true },
      context: normalized,
      commerceTraffic,
      customerContext: {
        verified: false,
        hasPurchaseHistory: null,
        visitorState: normalized.visitorState,
        source: "NONE",
      },
      runtime: contextRuntimeState(),
    });
  } catch (error: any) {
    res.status(401).json({ error: error?.message || "Popup session context verification failed", runtime: contextRuntimeState() });
  }
});

export default router;

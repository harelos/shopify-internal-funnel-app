import { Router } from "express";
import { randomUUID } from "node:crypto";
import prisma from "../lib/db.js";
import { assignPopupTreatment, hashPopupIdentity } from "../lib/popup-attribution.js";
import { classifyCommerceTraffic, type QualifiedCommerceTrafficPolicy } from "../lib/popup-commerce-traffic.js";
import { normalizePopupSessionContext, toPopupEligibilityContext, type PopupClientSessionSnapshot } from "../lib/popup-session-context.js";
import { issuePopupSessionToken, issuePopupVisitorToken, verifyPopupIdentityToken, type PopupSessionClaims, type PopupVisitorClaims } from "../lib/popup-session-token.js";

const router = Router();

function currentShopDomain(): string {
  return String(process.env.SHOP_DOMAIN || "local-dev.myshopify.com").trim().toLowerCase();
}

function holdoutBasisPoints(): number {
  const value = Number(process.env.POPUP_HOLDOUT_BASIS_POINTS ?? 1000);
  return Number.isFinite(value) ? Math.max(0, Math.min(5000, Math.round(value))) : 1000;
}

function contextRuntimeState() {
  return {
    stagingEnabled: process.env.POPUP_STAGING_ENABLED === "true",
    collectorEnabled: process.env.POPUP_CONTEXT_COLLECTOR_ENABLED === "true",
    attributionEnabled: process.env.POPUP_ATTRIBUTION_ENABLED === "true",
    killSwitch: process.env.POPUP_KILL_SWITCH !== "false",
    storefrontPopupEnabled: false,
    persistsContext: false,
    persistsAttributionAssignments: process.env.POPUP_ATTRIBUTION_ENABLED === "true",
    customerStateLookupEnabled: false,
    holdoutBasisPoints: holdoutBasisPoints(),
    boundary: "STAGING_CONTEXT_ATTRIBUTION_ONLY",
  } as const;
}

function allowedOrigins(): Set<string> {
  const origins = String(process.env.POPUP_ALLOWED_STOREFRONT_ORIGINS || "")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const shop = currentShopDomain();
  if (shop && shop.endsWith(".myshopify.com")) origins.push(`https://${shop}`);
  return new Set(origins);
}

function requestOwnOrigin(req: any): string | null {
  const forwardedHost = typeof req.headers["x-forwarded-host"] === "string" ? req.headers["x-forwarded-host"] : null;
  const host = forwardedHost || (typeof req.headers.host === "string" ? req.headers.host : null);
  if (!host) return null;
  const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"].split(",")[0].trim() : null;
  const protocol = forwardedProto || req.protocol || "https";
  return `${protocol}://${host}`.replace(/\/$/, "");
}

function originAllowed(req: any, origin: string | undefined): boolean {
  if (!origin) return true;
  const clean = origin.trim().replace(/\/$/, "");
  if (allowedOrigins().has(clean)) return true;
  // Same-origin requests from an ephemeral staging tunnel are allowed without
  // teaching production to trust arbitrary cross-origin storefronts.
  return requestOwnOrigin(req) === clean;
}

function requireContextGate(req: any, res: any, next: any) {
  const runtime = contextRuntimeState();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Vary", "Origin");
  if (!runtime.stagingEnabled || !runtime.collectorEnabled || runtime.killSwitch) {
    return res.status(503).json({ error: "Popup session context collector is disabled by staging safety gates", runtime });
  }
  if (!originAllowed(req, typeof req.headers.origin === "string" ? req.headers.origin : undefined)) {
    return res.status(403).json({ error: "Storefront origin is not allowed for popup context collection" });
  }
  next();
}

function requireAttributionGate(req: any, res: any, next: any) {
  if (!contextRuntimeState().attributionEnabled) {
    return res.status(503).json({ error: "Popup attribution is disabled by staging safety gates", runtime: contextRuntimeState() });
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

function requiredSessionClaims(token: unknown): PopupSessionClaims {
  const claims = verifyPopupIdentityToken(String(token || ""), { expectedShopDomain: currentShopDomain(), expectedKind: "session" });
  if (claims.kind !== "session") throw new Error("Valid popup session token required.");
  return claims;
}

router.get("/popup-runtime/status", (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({ runtime: contextRuntimeState(), originAllowed: originAllowed(req, typeof req.headers.origin === "string" ? req.headers.origin : undefined) });
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
    const claims = requiredSessionClaims(req.body?.sessionToken);
    const snapshot = (req.body?.snapshot || {}) as PopupClientSessionSnapshot;
    const requestUserAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
    const allowTestCountryHeader = process.env.POPUP_ALLOW_TEST_CONTEXT === "true" && process.env.NODE_ENV !== "production";
    const normalized = normalizePopupSessionContext({
      ...snapshot,
      userAgent: requestUserAgent || snapshot.userAgent,
    }, {
      headers: req.headers as Record<string, unknown>,
      allowTestCountryHeader,
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

router.post("/popup-runtime/attribution/assign", requireContextGate, requireAttributionGate, async (req, res) => {
  try {
    const claims = requiredSessionClaims(req.body?.sessionToken);
    const campaignKey = String(req.body?.campaignKey || "").trim().slice(0, 120);
    if (!campaignKey) return res.status(400).json({ error: "campaignKey is required" });

    const campaign = await prisma.popupCampaign.findUnique({
      where: { shopDomain_key: { shopDomain: currentShopDomain(), key: campaignKey } },
      include: { variants: { orderBy: { createdAt: "asc" } } },
    });
    if (!campaign) return res.status(404).json({ error: "Popup campaign not found" });

    const treatment = assignPopupTreatment({
      campaignKey: campaign.key,
      experimentVersion: campaign.experimentVersion,
      visitorId: claims.visitorId,
      holdoutBasisPoints: holdoutBasisPoints(),
      variants: campaign.variants.map(variant => ({ key: variant.key, weightBasisPoints: variant.weightBasisPoints })),
    });
    const visitorHash = hashPopupIdentity(claims.visitorId);
    const sessionHash = hashPopupIdentity(claims.sessionId);
    const now = new Date();

    const assignment = await prisma.popupExperimentAssignment.upsert({
      where: {
        shopDomain_campaignKey_experimentVersion_visitorHash: {
          shopDomain: currentShopDomain(),
          campaignKey: campaign.key,
          experimentVersion: campaign.experimentVersion,
          visitorHash,
        },
      },
      update: {
        sessionHash,
        lastSeenAt: now,
        group: treatment.group,
        variantKey: treatment.variantKey,
        holdoutBucket: treatment.holdoutBucket,
        variantBucket: treatment.variantBucket,
      },
      create: {
        shopDomain: currentShopDomain(),
        campaignKey: campaign.key,
        experimentVersion: campaign.experimentVersion,
        visitorHash,
        sessionHash,
        group: treatment.group,
        variantKey: treatment.variantKey,
        holdoutBucket: treatment.holdoutBucket,
        variantBucket: treatment.variantBucket,
        assignedAt: now,
        lastSeenAt: now,
        isTest: true,
      },
    });

    return res.json({
      ok: true,
      assignment: {
        id: assignment.id,
        campaignKey: assignment.campaignKey,
        experimentVersion: assignment.experimentVersion,
        group: assignment.group,
        variantKey: assignment.variantKey,
        holdoutBucket: assignment.holdoutBucket,
        variantBucket: assignment.variantBucket,
        isTest: assignment.isTest,
      },
      rendererEnabled: false,
      runtime: contextRuntimeState(),
    });
  } catch (error: any) {
    return res.status(401).json({ error: error?.message || "Popup attribution assignment failed", runtime: contextRuntimeState() });
  }
});

export default router;

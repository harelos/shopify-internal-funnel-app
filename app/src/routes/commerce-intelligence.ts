import { Router } from "express";
import prisma from "../lib/db.js";
import { analyticsDataContract, analyticsModeForRequest, isTestForMode } from "../lib/analytics-config.js";
import { getShopifyConfig, normalizeShopDomain } from "../lib/shopify-config.js";
import { buildQualifiedCommerceSummary, type CommerceEventInput } from "../lib/qualified-commerce.js";

const router = Router();

function csvEnv(name: string, fallback: string[] = []): string[] {
  const raw = String(process.env[name] || "").trim();
  return raw ? raw.split(",").map(value => value.trim()).filter(Boolean) : fallback;
}

function numberEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function dateWindow(query: Record<string, unknown>) {
  const now = new Date();
  const range = String(query.range || "7d").toLowerCase();
  const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;
  const from = query.from ? new Date(String(query.from)) : new Date(now.getTime() - days * 86_400_000);
  const to = query.to ? new Date(String(query.to)) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new Error("Invalid commerce-intelligence date range.");
  return { range, from, to };
}

function topBreakdown<T extends string | null>(values: T[], limit = 12) {
  const counts = new Map<string, number>();
  values.forEach(value => {
    const key = value || "UNKNOWN";
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([key, sessions]) => ({ key, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, limit);
}

router.get("/commerce-intelligence/qualified-traffic", async (req, res) => {
  try {
    const mode = analyticsModeForRequest(req.query as Record<string, unknown>);
    const { range, from, to } = dateWindow(req.query as Record<string, unknown>);
    const shopDomain = normalizeShopDomain(getShopifyConfig().shopDomain);
    const shop = shopDomain ? await prisma.shop.findUnique({ where: { domain: shopDomain } }) : null;
    if (!shop) {
      return res.status(404).json({
        error: "Configured Shopify shop has no local analytics record yet.",
        ...analyticsDataContract(mode),
      });
    }

    const events = await prisma.event.findMany({
      where: {
        shopId: shop.id,
        isTest: isTestForMode(mode),
        occurredAt: { gte: from, lte: to },
      },
      orderBy: { occurredAt: "asc" },
    });
    const orders = await prisma.orderAttribution.findMany({
      where: {
        shopId: shop.id,
        isTest: isTestForMode(mode),
        paidAt: { gte: from, lte: to },
      },
      orderBy: { paidAt: "asc" },
    });
    const checkoutTokens = new Set(events.map(event => event.checkoutToken).filter((value): value is string => Boolean(value)));
    const visitorIds = new Set(events.map(event => event.visitorId).filter((value): value is string => Boolean(value)));
    const rawCheckouts = await prisma.checkoutAttribution.findMany({
      where: {
        shopId: shop.id,
        startedAt: { gte: new Date(from.getTime() - 2 * 3_600_000), lte: new Date(to.getTime() + 2 * 3_600_000) },
      },
      orderBy: { startedAt: "asc" },
    });
    const checkouts = rawCheckouts.filter(checkout => checkoutTokens.has(checkout.checkoutToken) || Boolean(checkout.visitorId && visitorIds.has(checkout.visitorId)));

    const policy = {
      targetCountries: csvEnv("QUALIFIED_COMMERCE_TARGET_COUNTRIES", ["IL"]),
      internalCountries: csvEnv("QUALIFIED_COMMERCE_INTERNAL_COUNTRIES"),
      sessionTimeoutMinutes: numberEnv("QUALIFIED_COMMERCE_SESSION_TIMEOUT_MINUTES", 30),
    };

    const eventInputs: CommerceEventInput[] = events.map(event => ({
      id: event.id,
      name: event.name,
      source: event.source,
      occurredAt: event.occurredAt,
      visitorId: event.visitorId,
      funnelId: event.funnelId,
      stepId: event.stepId,
      variantId: event.variantId,
      checkoutToken: event.checkoutToken,
      utmSource: event.utmSource,
      utmMedium: event.utmMedium,
      utmCampaign: event.utmCampaign,
      deviceClass: event.deviceClass,
      isTest: event.isTest,
      payload: parsePayload(event.payload),
    }));

    const summary = buildQualifiedCommerceSummary(
      eventInputs,
      checkouts.map(checkout => ({
        checkoutToken: checkout.checkoutToken,
        visitorId: checkout.visitorId,
        startedAt: checkout.startedAt,
        completedAt: checkout.completedAt,
      })),
      orders.map(order => ({
        id: order.id,
        checkoutToken: order.checkoutToken,
        paidAt: order.paidAt,
        netRevenueAmount: order.netRevenueAmount,
        status: order.status,
      })),
      policy,
    );

    const qualified = summary.sessions.filter(session => session.qualification.status === "QUALIFIED");
    const excluded = summary.sessions.filter(session => session.qualification.status === "EXCLUDED");
    const unknown = summary.sessions.filter(session => session.qualification.status === "UNKNOWN");

    return res.json({
      ...analyticsDataContract(mode),
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      shopDomain,
      policy,
      metrics: summary.metrics,
      classification: {
        reasons: summary.reasons,
        qualifiedPctOfAll: summary.metrics.allSessions ? Number(((summary.metrics.qualifiedSessions / summary.metrics.allSessions) * 100).toFixed(2)) : 0,
        excludedPctOfAll: summary.metrics.allSessions ? Number(((summary.metrics.excludedSessions / summary.metrics.allSessions) * 100).toFixed(2)) : 0,
        unknownPctOfAll: summary.metrics.allSessions ? Number(((summary.metrics.unknownSessions / summary.metrics.allSessions) * 100).toFixed(2)) : 0,
      },
      breakdowns: {
        qualifiedByLandingPath: topBreakdown(qualified.map(session => session.landingPath)),
        qualifiedBySource: topBreakdown(qualified.map(session => session.utmSource || session.source)),
        qualifiedByDevice: topBreakdown(qualified.map(session => session.deviceClass)),
        excludedByLandingPath: topBreakdown(excluded.map(session => session.landingPath)),
        unknownByLandingPath: topBreakdown(unknown.map(session => session.landingPath)),
      },
      recentSessions: summary.sessions.slice(0, 100).map(session => ({
        sessionKey: session.sessionKey,
        startedAt: session.startedAt.toISOString(),
        landingPath: session.landingPath,
        countryCode: session.countryCode,
        utmSource: session.utmSource,
        deviceClass: session.deviceClass,
        hasCheckout: session.hasCheckout,
        purchaseCount: session.purchaseCount,
        revenue: session.revenue,
        status: session.qualification.status,
        reason: session.qualification.reason,
      })),
      caveats: {
        unknownIsNotQualified: "UNKNOWN sessions are never silently counted as qualified commerce traffic.",
        geo: "Country is used only when captured by trusted telemetry/imported data. This endpoint does not invent geo from language, referrer or device.",
        purchaseAttribution: "A purchase is attached to a session only through an exact checkout-token match. Unmatched orders remain unattributed.",
        landingDefinition: "Direct cart/checkout, support, tracking, unsubscribe and policy landings are excluded from the acquisition KPI denominator.",
        historicalShopify: "Historical Shopify session analytics are not automatically backfilled by this endpoint; imported historical rows must preserve source fields and classification provenance.",
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || "Failed to build qualified commerce traffic report." });
  }
});

export default router;

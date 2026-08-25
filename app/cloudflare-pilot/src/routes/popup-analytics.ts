import { createHmac } from "node:crypto";
import { Router } from "express";
import prisma from "../lib/db.js";
import { analyticsDataContract, analyticsModeForRequest, isTestForMode } from "../lib/analytics-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { getShopifyConfig, workerEnvValue } from "../lib/shopify-config.js";
import {
  POPUP_EVENTS,
  POPUP_VERSION,
  isPopupEvent,
  normalizePopupEventInput,
  parsePayload,
  percentage,
  persistPopupEvent,
  type PopupEventInput,
} from "../lib/popup-analytics.js";

const router = Router();
const shopify = new ShopifyAdminClient();
const REQUIRED_TAGS = ["novahair-exit-popup", "exit-popup-lead"];

function dateRange(query: Record<string, unknown>): { from?: Date; to?: Date; error?: string } {
  const from = typeof query.from === "string" && query.from ? new Date(query.from) : undefined;
  const to = typeof query.to === "string" && query.to ? new Date(query.to) : undefined;
  if ((from && !Number.isFinite(from.getTime())) || (to && !Number.isFinite(to.getTime()))) return { error: "Invalid date range." };
  if (from && to && from > to) return { error: "The start date must be before the end date." };
  return { from, to };
}

function text(value: unknown, max = 180): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function matches(value: unknown, filter: string | undefined): boolean {
  return !filter || String(value ?? "") === filter;
}

function eventDimension(event: any, key: "device" | "page" | "source" | "version"): string {
  const payload = parsePayload(event.payload || "{}");
  if (key === "device") return event.deviceClass || String(payload.device || "Unattributed");
  if (key === "page") return String(payload.path || "Unattributed");
  if (key === "source") return event.utmSource || "Unattributed";
  return String(payload.popupVersion || "Unversioned");
}

function orderDimension(order: any, key: "device" | "page" | "source" | "version"): string {
  if (key === "device") return order.popupDevice || "Unattributed";
  if (key === "page") return order.popupPage || "Unattributed";
  if (key === "source") return order.popupUtmSource || "Unattributed";
  return order.popupVersion || "Unversioned";
}

function buildBreakdown(events: any[], orders: any[], key: "device" | "page" | "source" | "version") {
  const labels = new Set<string>();
  events.forEach(event => labels.add(eventDimension(event, key)));
  orders.forEach(order => labels.add(orderDimension(order, key)));
  return [...labels].map(label => {
    const groupEvents = events.filter(event => eventDimension(event, key) === label);
    const groupOrders = orders.filter(order => orderDimension(order, key) === label && order.popupAttributed);
    const views = groupEvents.filter(event => event.name === "popup_view").length;
    const customerKeys = new Set(groupEvents
      .filter(event => event.name === "popup_submit_success")
      .map(event => String(parsePayload(event.payload).customerKey || event.id)));
    return {
      value: label,
      views,
      leads: customerKeys.size,
      leadConversionRate: percentage(customerKeys.size, views),
      orders: groupOrders.length,
      revenue: Number(groupOrders.reduce((sum, order) => sum + order.netRevenueAmount, 0).toFixed(2)),
    };
  }).sort((left, right) => right.views - left.views || right.revenue - left.revenue);
}

router.post("/track", async (req, res, next) => {
  if (!isPopupEvent(req.body?.event)) return next();
  const normalized = normalizePopupEventInput(req.body);
  if ("error" in normalized) return res.status(400).json({ accepted: false, error: normalized.error });
  try {
    const result = await persistPopupEvent(normalized, req.query as Record<string, unknown>);
    return res.status(result.duplicate ? 200 : 201).json({ accepted: true, duplicate: result.duplicate, eventId: result.event.id });
  } catch (error: any) {
    return res.status(500).json({ accepted: false, error: error.message || "Popup event persistence failed." });
  }
});

router.post("/popup/confirm-lead", async (req, res) => {
  const verificationTag = text(req.body?.verificationTag, 80)?.toLowerCase();
  if (!verificationTag || !/^nhp_[a-f0-9]{32}$/.test(verificationTag)) {
    return res.status(400).json({ confirmed: false, failureCategory: "invalid_verification_tag" });
  }

  const successBody = { ...req.body, event: "popup_submit_success" };
  const normalized = normalizePopupEventInput(successBody, true);
  if ("error" in normalized) return res.status(400).json({ confirmed: false, failureCategory: "invalid_context", error: normalized.error });

  try {
    let customer: { id: string; tags: string[]; emailMarketingConsent: { marketingState: string } | null } | undefined;
    for (const delay of [0, 300, 700, 1400]) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const result = await shopify.findPopupLeadByTag(verificationTag);
      customer = result.customers.nodes.find(node => node.tags.includes(verificationTag));
      if (customer
        && REQUIRED_TAGS.every(tag => customer!.tags.includes(tag))
        && customer.emailMarketingConsent?.marketingState === "SUBSCRIBED") break;
    }
    if (!customer) return res.status(409).json({ confirmed: false, failureCategory: "customer_tag_not_confirmed" });
    if (!REQUIRED_TAGS.every(tag => customer!.tags.includes(tag))) {
      return res.status(409).json({ confirmed: false, failureCategory: "tags_not_confirmed" });
    }
    if (customer.emailMarketingConsent?.marketingState !== "SUBSCRIBED") {
      return res.status(409).json({ confirmed: false, failureCategory: "consent_not_confirmed" });
    }

    const secret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
    const customerKey = createHmac("sha256", secret).update(customer.id).digest("hex").slice(0, 32);
    const version = String(normalized.payload.popupVersion || POPUP_VERSION);
    const confirmedInput: PopupEventInput = {
      ...normalized,
      eventKey: `popup_submit_success:${version}:customer:${customerKey}`,
      payload: {
        ...normalized.payload,
        consent: true,
        confirmationSource: "shopify_admin_customer_tag",
        customerKey,
      },
    };
    const persisted = await persistPopupEvent(confirmedInput, req.query as Record<string, unknown>, "SHOPIFY_ADMIN");
    return res.json({ confirmed: true, duplicateLead: persisted.duplicate, eventId: persisted.event.id });
  } catch (error: any) {
    console.error("Popup lead verification failed.", {
      error: String(error?.message || "unknown Shopify verification error").slice(0, 500),
    });
    return res.status(502).json({ confirmed: false, failureCategory: "shopify_verification_unavailable", error: error.message || "Shopify lead verification failed." });
  }
});

router.get("/analytics/popup", async (req, res) => {
  const range = dateRange(req.query as Record<string, unknown>);
  if (range.error) return res.status(400).json({ error: range.error });
  const mode = analyticsModeForRequest(req.query as Record<string, unknown>);
  const occurredAt = range.from || range.to ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } : undefined;
  const paidAt = occurredAt;
  try {
    const shop = await prisma.shop.findUnique({ where: { domain: getShopifyConfig().shopDomain } });
    if (!shop) return res.status(503).json({ error: "Configured Shopify shop is not present in analytics storage." });
    const [rawEvents, rawOrders] = await Promise.all([
      prisma.event.findMany({
        where: { shopId: shop.id, isTest: isTestForMode(mode), name: { in: [...POPUP_EVENTS] }, ...(occurredAt ? { occurredAt } : {}) },
        orderBy: { occurredAt: "desc" },
      }),
      prisma.orderAttribution.findMany({
        where: { shopId: shop.id, isTest: isTestForMode(mode), ...(paidAt ? { paidAt } : {}) },
        orderBy: { paidAt: "desc" },
      }),
    ]);
    const device = text(req.query.device, 20);
    const page = text(req.query.page, 500);
    const source = text(req.query.source, 120);
    const version = text(req.query.version, 80);
    const events = rawEvents.filter(event => matches(eventDimension(event, "device"), device)
      && matches(eventDimension(event, "page"), page)
      && matches(eventDimension(event, "source"), source)
      && matches(eventDimension(event, "version"), version));
    const orders = rawOrders.filter(order => matches(orderDimension(order, "device"), device)
      && matches(orderDimension(order, "page"), page)
      && matches(orderDimension(order, "source"), source)
      && matches(orderDimension(order, "version"), version));
    const optionValues = (key: "device" | "page" | "source" | "version") => [...new Set([
      ...rawEvents.map(event => eventDimension(event, key)),
      ...rawOrders.filter(order => order.popupAttributed).map(order => orderDimension(order, key)),
    ])].sort();

    const count = (name: string) => events.filter(event => event.name === name).length;
    const successKeys = new Set(events.filter(event => event.name === "popup_submit_success")
      .map(event => String(parsePayload(event.payload).customerKey || event.id)));
    const eligible = count("popup_eligible");
    const views = count("popup_view");
    const attempts = count("popup_submit_attempt");
    const leads = successKeys.size;
    const popupOrders = orders.filter(order => order.popupAttributed);
    const popupRevenue = popupOrders.reduce((sum, order) => sum + order.netRevenueAmount, 0);
    const configuredCoupon = workerEnvValue("NOVAHAIR_POPUP_COUPON") || "NOVA10";
    const couponOrders = orders.filter(order => {
      const codes = JSON.parse(order.discountCodes || "[]") as string[];
      return codes.some(code => code.toUpperCase() === configuredCoupon.toUpperCase());
    });
    const couponRevenue = couponOrders.reduce((sum, order) => sum + order.netRevenueAmount, 0);
    const stageDefinitions = [
      ["Eligible", "popup_eligible"], ["Viewed popup", "popup_view"], ["Started email", "popup_email_started"],
      ["Submit attempted", "popup_submit_attempt"], ["Lead saved", "popup_submit_success"],
      ["Coupon revealed", "popup_coupon_revealed"], ["Continued", "popup_continue_clicked"], ["Purchased", "popup_purchase"],
    ] as const;
    const stageCounts = stageDefinitions.map(([label, name]) => ({
      label,
      event: name,
      count: name === "popup_submit_success" ? leads : name === "popup_purchase" ? popupOrders.length : count(name),
    }));
    const funnel = stageCounts.map((stage, index) => ({
      ...stage,
      fromPrevious: index === 0 ? 100 : percentage(stage.count, stageCounts[index - 1].count),
      fromView: stage.event === "popup_eligible" ? null : percentage(stage.count, views),
    }));
    const closes = events.filter(event => event.name === "popup_closed");
    const closeCount = (method: string) => closes.filter(event => parsePayload(event.payload).closeMethod === method).length;
    const failures = events.filter(event => event.name === "popup_submit_failed");
    const failureCategories = [...new Set(failures.map(event => String(parsePayload(event.payload).failureCategory || "other")))]
      .map(category => ({ category, count: failures.filter(event => String(parsePayload(event.payload).failureCategory || "other") === category).length }))
      .sort((left, right) => right.count - left.count);

    return res.json({
      ...analyticsDataContract(mode),
      generatedAt: new Date().toISOString(),
      configuredCoupon,
      metrics: {
        eligibleSessions: eligible,
        popupViews: views,
        viewRate: percentage(views, eligible),
        emailStarts: count("popup_email_started"),
        submitAttempts: attempts,
        successfulLeads: leads,
        leadConversionRate: percentage(leads, views),
        submitSuccessRate: percentage(leads, attempts),
        couponReveals: count("popup_coupon_revealed"),
        popupAttributedOrders: popupOrders.length,
        popupAttributedRevenue: Number(popupRevenue.toFixed(2)),
        popupRevenuePerView: views ? Number((popupRevenue / views).toFixed(2)) : 0,
        couponOrders: couponOrders.length,
        couponRevenue: Number(couponRevenue.toFixed(2)),
        revealToPurchaseRate: percentage(couponOrders.length, count("popup_coupon_revealed")),
      },
      funnel,
      dismissals: {
        total: closes.length,
        closeRate: percentage(closes.length, views),
        x: closeCount("x"), backdrop: closeCount("backdrop"), esc: closeCount("esc"), other: closeCount("other"),
      },
      errors: {
        submitAttempts: attempts,
        successfulSubmits: leads,
        failedSubmits: failures.length,
        failureRate: percentage(failures.length, attempts),
        categories: failureCategories,
        recent: failures.slice(0, 25).map(event => ({ at: event.occurredAt, category: parsePayload(event.payload).failureCategory || "other", device: event.deviceClass, path: parsePayload(event.payload).path || null })),
      },
      breakdowns: {
        device: buildBreakdown(events, orders, "device"),
        page: buildBreakdown(events, orders, "page"),
        source: buildBreakdown(events, orders, "source"),
        version: buildBreakdown(events, orders, "version"),
      },
      filterOptions: {
        device: optionValues("device"), page: optionValues("page"),
        source: optionValues("source"), version: optionValues("version"),
      },
      recentEvents: events.slice(0, 50).map(event => ({
        event: event.name, at: event.occurredAt, source: event.source, device: event.deviceClass,
        page: parsePayload(event.payload).path || null, version: parsePayload(event.payload).popupVersion || null,
      })),
      sourceOfTruth: {
        eligibilityViewsInteractionsDismissals: "Cloudflare D1 events received through Shopify's signed App Proxy",
        successfulLeads: "Unique HMAC-pseudonymized Shopify customers confirmed through Admin GraphQL with both popup tags and SUBSCRIBED email consent",
        ordersRevenue: "Shopify orders/paid and orders/updated webhooks persisted in OrderAttribution",
        couponUsage: `Shopify order discount_codes containing the verified production code ${configuredCoupon}`,
      },
      countingRules: {
        session: "A browser-tab session uses sessionStorage; visitor attribution uses localStorage.",
        oncePerSessionPage: "Eligible, view, email-start, consent, coupon-reveal, continue, and close use deterministic version/session/path keys.",
        retries: "Each valid submit click creates one numbered attempt; success and failure reference that attempt.",
        leads: "Successful Leads counts unique Shopify-confirmed customer keys, not frontend success screens.",
        purchases: "Purchases count unique Shopify order IDs and never originate from storefront JavaScript.",
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Popup analytics query failed." });
  }
});

export default router;

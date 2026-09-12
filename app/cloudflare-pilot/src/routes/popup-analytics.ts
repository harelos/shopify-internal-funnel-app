import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import prisma from "../lib/db.js";
import { analyticsDataContract, analyticsModeForRequest, isTestForMode } from "../lib/analytics-config.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { getShopifyConfig, workerEnvValue } from "../lib/shopify-config.js";
import { sendNovaHairConciergeSummary, sendNovaHairOtp } from "../lib/smtp-email.js";
import { enqueueLifecycleIdentityClaim } from "../lib/lifecycle-storefront.js";
import { identifyPostHogServerUser } from "../lib/posthog-server.js";
import {
  POPUP_EVENTS,
  POPUP_VERSION,
  isPopupEvent,
  normalizePopupEventInput,
  parsePayload,
  percentage,
  popupExperienceForVersion,
  uniquePopupSessionCount,
  persistPopupEvent,
  type PopupEventInput,
} from "../lib/popup-analytics.js";

const router = Router();
const shopify = new ShopifyAdminClient();
const REQUIRED_TAGS = ["novahair-exit-popup", "exit-popup-lead"];
const CUSTOMER_TOKEN_TTL_SECONDS = 60 * 60 * 24;
const OTP_TTL_SECONDS = 10 * 60;
const customerRateBuckets = new Map<string, { count: number; resetAt: number }>();

type D1Result<T = Record<string, unknown>> = { results?: T[]; success?: boolean };
type D1Statement = { bind: (...values: unknown[]) => D1Statement; run: () => Promise<D1Result>; first: <T = Record<string, unknown>>() => Promise<T | null> };
type D1Like = { prepare: (sql: string) => D1Statement };

function database(): D1Like {
  const db = (globalThis as any).__SHOPIFY_WORKER_ENV__?.DB as D1Like | undefined;
  if (!db) throw new Error("Cloudflare D1 binding is unavailable.");
  return db;
}

function normalizedEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function customerRequestLimited(req: any, action: string, max: number, windowMs: number): boolean {
  const ip = String(req.get?.("cf-connecting-ip") || req.get?.("x-forwarded-for") || req.ip || "unknown").split(",")[0].trim();
  const key = `${action}:${ip}`;
  const now = Date.now();
  if (customerRateBuckets.size > 5000) {
    for (const [bucketKey, value] of customerRateBuckets) if (value.resetAt <= now) customerRateBuckets.delete(bucketKey);
  }
  const bucket = customerRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    customerRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

function opaqueToken(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", workerEnvValue("SHOPIFY_CLIENT_SECRET")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readOpaqueToken(token: unknown, expectedKind: string): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 1600 || !token.includes(".")) return null;
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = createHmac("sha256", workerEnvValue("SHOPIFY_CLIENT_SECRET")).update(encoded).digest("base64url");
  const left = Buffer.from(supplied); const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
    if (payload.kind !== expectedKind || Number(payload.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

function failOnUserErrors(label: string, errors: Array<{ message: string }> | undefined): void {
  if (errors?.length) throw new Error(`${label}: ${errors[0].message}`);
}

function statusTag(intent: string): string {
  return intent === "repeat" ? "nova_ai_repeat" : intent === "service" ? "nova_ai_service" : "nova_ai_prospect";
}

function cleanCustomerContext(body: any) {
  const clean = (value: unknown, max = 255) => typeof value === "string"
    ? value.replace(/[\r\n<>]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max)
    : "";
  return {
    current_intent: ["prospect", "repeat", "service"].includes(body?.intent) ? body.intent : "prospect",
    main_concern: clean(body?.mainConcern),
    recommended_shade: clean(body?.recommendedShade),
    recommended_bundle: clean(body?.recommendedBundle),
    last_interaction_at: new Date().toISOString(),
    latest_summary: clean(body?.latestSummary),
  };
}

function orderSummary(customer: Awaited<ReturnType<ShopifyAdminClient["findCustomerByEmail"]>>["customers"]["nodes"][number]) {
  const order = customer.orders.nodes[0];
  const names = order?.lineItems.nodes.map(item => [item.name, item.title, item.variantTitle].filter(Boolean).join(" ")) || [];
  const joined = names.join(" | ");
  const bottleMatch = joined.match(/(?:מארז|חביל(?:ה|ת)|pack)?\s*(2|4|6)\s*(?:בקבוקים|bottles?)/i);
  const bundle = bottleMatch ? `מארז ${bottleMatch[1]} בקבוקים` : (names[0] || "את המארז שלך").slice(0, 100);
  const shades = ["שחור טבעי", "חום כהה", "חום בהיר", "סגול חציל", "אדום יין"]
    .filter(shade => joined.includes(shade));
  return { bundle, shadeSummary: shades.length ? [...new Set(shades)].join(" ו־") : "הגוון שבחרת" };
}

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

type AttributionDimension = "device" | "page" | "source" | "medium" | "campaign" | "version";

function eventDimension(event: any, key: AttributionDimension): string {
  const payload = parsePayload(event.payload || "{}");
  if (key === "device") return event.deviceClass || String(payload.device || "Unattributed");
  if (key === "page") return String(payload.path || "Unattributed");
  if (key === "source") return event.utmSource || "Unattributed";
  if (key === "medium") return event.utmMedium || "Unattributed";
  if (key === "campaign") return event.utmCampaign || "Unattributed";
  return String(payload.popupVersion || "Unversioned");
}

function orderDimension(order: any, key: AttributionDimension): string {
  if (key === "device") return order.popupDevice || "Unattributed";
  if (key === "page") return order.popupPage || "Unattributed";
  if (key === "source") return order.popupUtmSource || "Unattributed";
  if (key === "medium") return order.popupUtmMedium || "Unattributed";
  if (key === "campaign") return order.popupUtmCampaign || "Unattributed";
  return order.popupVersion || "Unversioned";
}

function eventExperience(event: any) {
  return popupExperienceForVersion(parsePayload(event.payload || "{}").popupVersion);
}

function orderExperience(order: any) {
  return popupExperienceForVersion(order.popupVersion);
}

function buildBreakdown(events: any[], orders: any[], key: AttributionDimension) {
  const labels = new Set<string>();
  events.forEach(event => labels.add(eventDimension(event, key)));
  orders.forEach(order => labels.add(orderDimension(order, key)));
  return [...labels].map(label => {
    const groupEvents = events.filter(event => eventDimension(event, key) === label);
    const groupOrders = orders.filter(order => orderDimension(order, key) === label && order.popupAttributed);
    const views = uniquePopupSessionCount(groupEvents, "popup_view");
    const customerKeys = new Set(groupEvents
      .filter(event => event.name === "popup_submit_success")
      .map(event => String(parsePayload(event.payload).customerKey || event.id)));
    const revenueByCurrency = [...new Set(groupOrders.map(order => order.currency))].map(currency => ({
      currency,
      revenue: Number(groupOrders.filter(order => order.currency === currency)
        .reduce((sum, order) => sum + order.netRevenueAmount, 0).toFixed(2)),
    }));
    return {
      value: label,
      views,
      leads: customerKeys.size,
      leadConversionRate: percentage(customerKeys.size, views),
      orders: groupOrders.length,
      revenue: revenueByCurrency.length === 1 ? revenueByCurrency[0].revenue : null,
      currency: revenueByCurrency.length === 1 ? revenueByCurrency[0].currency : null,
      revenueByCurrency,
    };
  }).sort((left, right) => right.views - left.views || Number(right.revenue || 0) - Number(left.revenue || 0));
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

async function findOrCreateCustomer(email: string) {
  let found = await shopify.findCustomerByEmail(email);
  let customer = found.customers.nodes.find(node => node.email?.toLowerCase() === email);
  if (customer) return customer;
  const created = await shopify.createCustomerWithEmail(email);
  if (created.customerCreate.customer) {
    return {
      ...created.customerCreate.customer,
      tags: [],
      emailMarketingConsent: null,
      orders: { nodes: [] },
    };
  }
  found = await shopify.findCustomerByEmail(email);
  customer = found.customers.nodes.find(node => node.email?.toLowerCase() === email);
  if (customer) return customer;
  failOnUserErrors("customerCreate", created.customerCreate.userErrors);
  throw new Error("Shopify did not return a customer.");
}

function customerSessionToken(customerId: string): string {
  return opaqueToken({ kind: "customer", customerId, exp: Math.floor(Date.now() / 1000) + CUSTOMER_TOKEN_TTL_SECONDS });
}

router.post("/popup/customer/capture", async (req, res) => {
  if (customerRequestLimited(req, "capture", 8, 10 * 60_000)) return res.status(429).json({ saved: false, failureCategory: "rate_limited" });
  const email = normalizedEmail(req.body?.email);
  if (!email) return res.status(400).json({ saved: false, failureCategory: "invalid_email" });
  const context = cleanCustomerContext(req.body);
  const normalized = normalizePopupEventInput({ ...req.body, event: "popup_submit_success" }, true);
  if ("error" in normalized) return res.status(400).json({ saved: false, failureCategory: "invalid_context" });
  try {
    const customer = await findOrCreateCustomer(email);
    const tags = await shopify.addCustomerTags(customer.id, ["nova_ai", statusTag(context.current_intent)]);
    failOnUserErrors("tagsAdd", tags.tagsAdd.userErrors);
    const metafields = await shopify.setCustomerConciergeMetafields(customer.id, context);
    failOnUserErrors("metafieldsSet", metafields?.metafieldsSet.userErrors);
    if (req.body?.marketingConsent === true) {
      const consent = await shopify.subscribeCustomerEmail(customer.id, new Date().toISOString());
      failOnUserErrors("customerEmailMarketingConsentUpdate", consent.customerEmailMarketingConsentUpdate.userErrors);
    }
    const customerKey = createHmac("sha256", workerEnvValue("SHOPIFY_CLIENT_SECRET")).update(customer.id).digest("hex").slice(0, 32);
    const persisted = await persistPopupEvent({
      ...normalized,
      eventKey: `${normalized.eventKey}:customer:${customerKey}`,
      payload: {
        ...normalized.payload,
        consent: req.body?.marketingConsent === true,
        confirmationSource: "shopify_admin_customer_upsert",
        customerKey,
      },
    }, req.query as Record<string, unknown>, "SHOPIFY_ADMIN");
    if (normalized.visitorId) {
      await enqueueLifecycleIdentityClaim({
        claimId: `popup-capture:${persisted.event.id}`,
        visitorId: normalized.visitorId,
        shopifyCustomerId: customer.id,
        email,
        consentState: req.body?.marketingConsent === true ? "SUBSCRIBED" : "NOT_SUBSCRIBED",
        source: "SHOPIFY_POPUP_CAPTURE",
        occurredAt: normalized.occurredAt,
      });
      await identifyPostHogServerUser(normalized.visitorId, customerKey, {
        customer_type: customer.orders.nodes.length > 0 ? "returning" : "lead",
        marketing_state: req.body?.marketingConsent === true ? "subscribed" : "not_subscribed",
      });
    }
    return res.json({ saved: true, customerToken: customerSessionToken(customer.id), duplicateLead: persisted.duplicate });
  } catch (error: any) {
    console.error("[NOVA AI CUSTOMER CAPTURE FAILED]", String(error?.message || error).slice(0, 500));
    return res.status(502).json({ saved: false, failureCategory: "shopify_customer_save_failed" });
  }
});

router.post("/popup/customer/context", async (req, res) => {
  if (customerRequestLimited(req, "context", 30, 10 * 60_000)) return res.status(429).json({ saved: false });
  const token = readOpaqueToken(req.body?.customerToken, "customer");
  const customerId = typeof token?.customerId === "string" ? token.customerId : "";
  if (!customerId.startsWith("gid://shopify/Customer/")) return res.status(401).json({ saved: false });
  try {
    const context = cleanCustomerContext(req.body);
    const tags = await shopify.addCustomerTags(customerId, ["nova_ai", statusTag(context.current_intent)]);
    failOnUserErrors("tagsAdd", tags.tagsAdd.userErrors);
    const metafields = await shopify.setCustomerConciergeMetafields(customerId, context);
    failOnUserErrors("metafieldsSet", metafields?.metafieldsSet.userErrors);
    return res.json({ saved: true });
  } catch (error: any) {
    console.error("[NOVA AI CONTEXT UPDATE FAILED]", String(error?.message || error).slice(0, 500));
    return res.status(502).json({ saved: false });
  }
});

router.post("/popup/customer/result-email", async (req, res) => {
  if (customerRequestLimited(req, "result_email", 12, 10 * 60_000)) return res.status(429).json({ sent: false, failureCategory: "rate_limited" });
  const token = readOpaqueToken(req.body?.customerToken, "customer");
  const customerId = typeof token?.customerId === "string" ? token.customerId : "";
  const conversationId = text(req.body?.conversationId, 160);
  if (!customerId.startsWith("gid://shopify/Customer/") || !conversationId) return res.status(401).json({ sent: false, failureCategory: "invalid_customer_session" });

  const secret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
  const customerKey = createHmac("sha256", secret).update(customerId).digest("hex").slice(0, 32);
  const conversationKey = createHmac("sha256", secret).update(conversationId).digest("hex").slice(0, 32);
  const eventKey = `concierge_result_email:${customerKey}:${conversationKey}`;
  const attemptId = randomUUID();
  const createdAt = Date.now();
  try {
    await database().prepare(`INSERT OR IGNORE INTO ConciergeResultEmail
      (eventKey, customerKey, attemptId, status, createdAt)
      VALUES (?, ?, ?, 'SENDING', ?)`)
      .bind(eventKey, customerKey, attemptId, createdAt).run();
    const reservation = await database().prepare("SELECT attemptId, status FROM ConciergeResultEmail WHERE eventKey = ?")
      .bind(eventKey).first<{ attemptId: string; status: string }>();
    if (!reservation || reservation.attemptId !== attemptId) {
      return res.json({ sent: reservation?.status === "SENT", duplicate: true });
    }

    const result = await shopify.findCustomerById(customerId);
    const email = normalizedEmail(result.customer?.email);
    if (!email) throw new Error("customer_email_unavailable");
    const kind = ["summary", "guide", "coupon"].includes(req.body?.kind) ? req.body.kind : "summary";
    const context = cleanCustomerContext(req.body);
    const sent = await sendNovaHairConciergeSummary(email, {
      kind,
      mainConcern: context.main_concern,
      recommendedShade: context.recommended_shade,
      recommendedBundle: context.recommended_bundle,
      couponCode: kind === "coupon" ? (workerEnvValue("NOVAHAIR_POPUP_COUPON") || "NOVA10") : undefined,
    });
    if (!sent) throw new Error("smtp_delivery_failed");
    await database().prepare("UPDATE ConciergeResultEmail SET status = 'SENT', sentAt = ? WHERE eventKey = ? AND attemptId = ?")
      .bind(Date.now(), eventKey, attemptId).run();

    const browserPayload = req.body?.payload && typeof req.body.payload === "object" && !Array.isArray(req.body.payload)
      ? req.body.payload as Record<string, unknown>
      : {};
    const analyticsPopupVersion = text(req.body?.popupVersion ?? browserPayload.popupVersion, 80) || POPUP_VERSION;
    const clientEventKey = text(req.body?.explicitEventKey, 240);
    const normalized = normalizePopupEventInput({
      event: "popup_result_email_sent",
      visitorId: req.body?.visitorId,
      explicitEventKey: clientEventKey || `popup_result_email_sent:${analyticsPopupVersion}:${customerKey}:${conversationKey}`,
      occurredAt: new Date().toISOString(),
      utm_source: req.body?.utm_source,
      utm_medium: req.body?.utm_medium,
      utm_campaign: req.body?.utm_campaign,
      payload: {
        popupVersion: analyticsPopupVersion,
        sessionId: browserPayload.sessionId,
        conversationId,
        path: browserPayload.path,
        device: browserPayload.device,
        agent: browserPayload.agent,
        customerKey,
        emailKind: kind,
      },
    }, true);
    if (!("error" in normalized)) await persistPopupEvent(normalized, req.query as Record<string, unknown>, "SMTP");
    return res.json({ sent: true, duplicate: false });
  } catch (error: any) {
    await database().prepare("DELETE FROM ConciergeResultEmail WHERE eventKey = ? AND attemptId = ? AND status = 'SENDING'")
      .bind(eventKey, attemptId).run().catch(() => undefined);
    console.error("[NOVA AI RESULT EMAIL FAILED]", String(error?.message || error).slice(0, 300));
    return res.status(502).json({ sent: false, failureCategory: "result_email_failed" });
  }
});

async function sendOtp(email: string, code: string): Promise<boolean> {
  if (workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER") && workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_PASSWORD")) {
    return sendNovaHairOtp(email, code);
  }
  const url = workerEnvValue("NOVAHAIR_EMAIL_SERVICE_URL");
  const secret = workerEnvValue("NOVAHAIR_EMAIL_SERVICE_SECRET");
  if (!url || !secret) return false;
  const response = await fetch(`${url.replace(/\/$/, "")}/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ email, code }),
    signal: AbortSignal.timeout(8000),
  });
  return response.ok;
}

router.post("/popup/customer/identify/start", async (req, res) => {
  if (customerRequestLimited(req, "identify_start", 5, 10 * 60_000)) return res.status(429).json({ accepted: false });
  const email = normalizedEmail(req.body?.email);
  if (!email) return res.status(400).json({ accepted: false, failureCategory: "invalid_email" });
  const id = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const secret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
  const emailHash = createHmac("sha256", secret).update(email).digest("hex");
  const codeHash = createHmac("sha256", secret).update(`${id}:${code}`).digest("hex");
  let customerId = "";
  try {
    const found = await shopify.findCustomerByEmail(email);
    const customer = found.customers.nodes.find(node => node.email?.toLowerCase() === email && node.orders.nodes.length > 0);
    customerId = customer?.id || "";
    await database().prepare(`INSERT INTO ConciergeOtpChallenge
      (id, emailHash, customerId, otpHash, expiresAt, attempts, createdAt)
      VALUES (?, ?, ?, ?, ?, 0, ?)`)
      .bind(id, emailHash, customerId || null, codeHash, Date.now() + OTP_TTL_SECONDS * 1000, Date.now()).run();
    if (!await sendOtp(email, code)) {
      await database().prepare("DELETE FROM ConciergeOtpChallenge WHERE id = ?").bind(id).run();
      throw new Error("otp_delivery_failed");
    }
  } catch (error: any) {
    console.error("[NOVA AI OTP START FAILED]", String(error?.message || error).slice(0, 500));
    return res.status(502).json({ accepted: false, failureCategory: "otp_delivery_failed" });
  }
  return res.json({ accepted: true, challengeToken: opaqueToken({ kind: "otp", id, exp: Math.floor(Date.now() / 1000) + OTP_TTL_SECONDS }) });
});

router.post("/popup/customer/identify/session", async (req, res) => {
  const rawId = typeof req.query.logged_in_customer_id === "string" ? req.query.logged_in_customer_id : "";
  if (!/^\d+$/.test(rawId)) return res.status(401).json({ verified: false });
  const customerId = `gid://shopify/Customer/${rawId}`;
  try {
    const result = await shopify.findCustomerById(customerId);
    if (!result.customer || !result.customer.orders.nodes.length) return res.status(401).json({ verified: false });
    const summary = orderSummary(result.customer);
    const tags = await shopify.addCustomerTags(customerId, ["nova_ai", "nova_ai_repeat"]);
    failOnUserErrors("tagsAdd", tags.tagsAdd.userErrors);
    await shopify.setCustomerConciergeMetafields(customerId, cleanCustomerContext({ intent: "repeat" }));
    return res.json({ verified: true, customerToken: customerSessionToken(customerId), ...summary });
  } catch (error: any) {
    console.error("[NOVA AI SESSION IDENTIFY FAILED]", String(error?.message || error).slice(0, 500));
    return res.status(502).json({ verified: false });
  }
});

router.post("/popup/customer/identify/verify", async (req, res) => {
  if (customerRequestLimited(req, "identify_verify", 12, 10 * 60_000)) return res.status(429).json({ verified: false });
  const token = readOpaqueToken(req.body?.challengeToken, "otp");
  const id = typeof token?.id === "string" ? token.id : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!id || !/^\d{6}$/.test(code)) return res.status(400).json({ verified: false });
  try {
    const row = await database().prepare(`SELECT id, customerId, otpHash, expiresAt, attempts, consumedAt
      FROM ConciergeOtpChallenge WHERE id = ?`).bind(id).first<{
        id: string; customerId: string | null; otpHash: string; expiresAt: number; attempts: number; consumedAt: number | null;
      }>();
    if (!row || row.consumedAt || row.expiresAt < Date.now() || row.attempts >= 5 || !row.customerId) {
      return res.status(401).json({ verified: false });
    }
    await database().prepare("UPDATE ConciergeOtpChallenge SET attempts = attempts + 1 WHERE id = ?").bind(id).run();
    const expected = createHmac("sha256", workerEnvValue("SHOPIFY_CLIENT_SECRET")).update(`${id}:${code}`).digest("hex");
    const left = Buffer.from(expected); const right = Buffer.from(row.otpHash);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return res.status(401).json({ verified: false });
    await database().prepare("UPDATE ConciergeOtpChallenge SET consumedAt = ? WHERE id = ?").bind(Date.now(), id).run();
    const lookup = await shopify.findCustomerById(row.customerId);
    const customer = lookup.customer;
    if (!customer) return res.status(401).json({ verified: false });
    const summary = orderSummary(customer);
    const tags = await shopify.addCustomerTags(customer.id, ["nova_ai", "nova_ai_repeat"]);
    failOnUserErrors("tagsAdd", tags.tagsAdd.userErrors);
    await shopify.setCustomerConciergeMetafields(customer.id, cleanCustomerContext({ intent: "repeat" }));
    return res.json({ verified: true, customerToken: customerSessionToken(customer.id), ...summary });
  } catch (error: any) {
    console.error("[NOVA AI OTP VERIFY FAILED]", String(error?.message || error).slice(0, 500));
    return res.status(502).json({ verified: false });
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
    if (normalized.visitorId) {
      await enqueueLifecycleIdentityClaim({
        claimId: `popup-confirm:${persisted.event.id}`,
        visitorId: normalized.visitorId,
        shopifyCustomerId: customer.id,
        email: normalizedEmail(req.body?.email) ?? undefined,
        consentState: "SUBSCRIBED",
        source: "SHOPIFY_POPUP_CONFIRMED",
        occurredAt: normalized.occurredAt,
      });
      await identifyPostHogServerUser(normalized.visitorId, customerKey, {
        customer_type: "lead",
        marketing_state: "subscribed",
      });
    }
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
    const medium = text(req.query.medium, 120);
    const campaign = text(req.query.campaign, 180);
    const version = text(req.query.version, 80);
    const experience = text(req.query.experience, 20);
    if (experience && experience !== "exit" && experience !== "concierge") {
      return res.status(400).json({ error: "Experience must be exit or concierge." });
    }
    const events = rawEvents.filter(event => matches(eventDimension(event, "device"), device)
      && matches(eventDimension(event, "page"), page)
      && matches(eventDimension(event, "source"), source)
      && matches(eventDimension(event, "medium"), medium)
      && matches(eventDimension(event, "campaign"), campaign)
      && matches(eventDimension(event, "version"), version)
      && (!experience || eventExperience(event) === experience));
    const orders = rawOrders.filter(order => matches(orderDimension(order, "device"), device)
      && matches(orderDimension(order, "page"), page)
      && matches(orderDimension(order, "source"), source)
      && matches(orderDimension(order, "medium"), medium)
      && matches(orderDimension(order, "campaign"), campaign)
      && matches(orderDimension(order, "version"), version)
      && (!experience || orderExperience(order) === experience));
    const optionValues = (key: AttributionDimension) => [...new Set([
      ...rawEvents.map(event => eventDimension(event, key)),
      ...rawOrders.filter(order => order.popupAttributed).map(order => orderDimension(order, key)),
    ])].sort();

    const count = (name: string) => events.filter(event => event.name === name).length;
    const sessions = (name: string) => uniquePopupSessionCount(events, name);
    const successKeys = new Set(events.filter(event => event.name === "popup_submit_success")
      .map(event => String(parsePayload(event.payload).customerKey || event.id)));
    const successEvents = events.filter(event => event.name === "popup_submit_success");
    let recentLeads: Array<Record<string, unknown>> = [];
    let leadLookupError: string | null = null;
    if (successKeys.size) {
      try {
        const secret = workerEnvValue("SHOPIFY_CLIENT_SECRET");
        const customers = await shopify.listConciergeCustomers();
        recentLeads = customers.flatMap(customer => {
          const customerKey = createHmac("sha256", secret).update(customer.id).digest("hex").slice(0, 32);
          if (!successKeys.has(customerKey)) return [];
          const leadEvent = successEvents.find(event => String(parsePayload(event.payload).customerKey || "") === customerKey);
          const payload = leadEvent ? parsePayload(leadEvent.payload) : {};
          const metafields = Object.fromEntries(customer.metafields.nodes.map(field => [field.key, field.value]));
          const order = customer.orders.nodes[0] ?? null;
          return [{
            customerId: customer.id,
            customerAdminUrl: `https://admin.shopify.com/store/jacobfelipe/customers/${customer.id.split("/").pop()}`,
            displayName: customer.displayName || "",
            email: customer.defaultEmailAddress?.emailAddress || "",
            marketingState: customer.defaultEmailAddress?.marketingState || "UNKNOWN",
            source: customer.tags.includes("nova_ai") ? "AI Concierge" : "Exit popup",
            intent: metafields.current_intent || "",
            mainConcern: metafields.main_concern || "",
            recommendedShade: metafields.recommended_shade || "",
            recommendedBundle: metafields.recommended_bundle || "",
            capturedAt: leadEvent?.occurredAt || customer.createdAt,
            trigger: payload.trigger || "",
            popupVersion: payload.popupVersion || "",
            utmSource: leadEvent?.utmSource || "",
            utmMedium: leadEvent?.utmMedium || "",
            utmCampaign: leadEvent?.utmCampaign || "",
            latestOrder: order ? {
              id: order.id, name: order.name, createdAt: order.createdAt,
              amount: Number(order.currentTotalPriceSet.shopMoney.amount),
              currency: order.currentTotalPriceSet.shopMoney.currencyCode,
              discountCodes: order.discountCodes,
            } : null,
          }];
        });
      } catch (error) {
        console.error("[POPUP LEAD LIST FAILED]", error);
        leadLookupError = "Shopify customer details are temporarily unavailable.";
      }
    }
    const legacySuppressed = events.filter(event => event.name === "popup_eligible"
      && parsePayload(event.payload).trigger === "suppressed").length;
    const eligibleEvents = events.filter(event => event.name === "popup_eligible"
      && parsePayload(event.payload).trigger !== "suppressed");
    const viewEvents = events.filter(event => event.name === "popup_view");
    // A rendered popup is necessarily eligible. Older runtime versions did not
    // always emit the separate eligibility event, so include view sessions in
    // the eligible cohort instead of producing impossible rates above 100%.
    const eligibleCohortEvents = [...eligibleEvents, ...viewEvents];
    const eligible = uniquePopupSessionCount(eligibleCohortEvents);
    const explicitlyEligible = uniquePopupSessionCount(eligibleEvents);
    const signals = sessions("popup_signal");
    const suppressedSnapshots = count("popup_suppressed") + legacySuppressed;
    const views = sessions("popup_view");
    const attempts = count("popup_submit_attempt");
    const leads = successKeys.size;
    const popupOrders = orders.filter(order => order.popupAttributed);
    const popupRevenue = popupOrders.reduce((sum, order) => sum + order.netRevenueAmount, 0);
    const popupRevenueByCurrency = [...new Set(popupOrders.map(order => order.currency))].map(currency => ({
      currency,
      revenue: Number(popupOrders.filter(order => order.currency === currency)
        .reduce((sum, order) => sum + order.netRevenueAmount, 0).toFixed(2)),
    }));
    const configuredCoupon = workerEnvValue("NOVAHAIR_POPUP_COUPON") || "NOVA10";
    const couponOrders = orders.filter(order => {
      const codes = JSON.parse(order.discountCodes || "[]") as string[];
      return codes.some(code => code.toUpperCase() === configuredCoupon.toUpperCase());
    });
    const couponRevenue = couponOrders.reduce((sum, order) => sum + order.netRevenueAmount, 0);
    const couponOnlyOrders = couponOrders.filter(order => !order.popupAttributed);
    const stageDefinitions = [
      ["Eligible", "popup_eligible"], ["Viewed popup", "popup_view"], ["Started email", "popup_email_started"],
      ["Submit attempted", "popup_submit_attempt"], ["Lead saved", "popup_submit_success"],
      ["Summary emailed", "popup_result_email_sent"],
      ["Coupon revealed", "popup_coupon_revealed"], ["Continued", "popup_continue_clicked"], ["Purchased", "popup_purchase"],
    ] as const;
    const stageCounts = stageDefinitions.map(([label, name]) => ({
      label,
      event: name,
      count: name === "popup_eligible" ? eligible
        : name === "popup_submit_success" ? leads
          : name === "popup_purchase" ? popupOrders.length
            : sessions(name),
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
        exitSignals: signals,
        eligibleSessions: eligible,
        explicitlyEligibleSessions: explicitlyEligible,
        eligibilityInferredFromViews: Math.max(0, eligible - explicitlyEligible),
        treatmentEligible: uniquePopupSessionCount(eligibleCohortEvents.filter(event => parsePayload(event.payload).experimentVariant !== "control")),
        holdoutEligible: uniquePopupSessionCount(eligibleCohortEvents.filter(event => parsePayload(event.payload).experimentVariant === "control")),
        suppressedSnapshots,
        popupViews: views,
        viewRate: percentage(views, eligible),
        emailStarts: sessions("popup_email_started"),
        submitAttempts: attempts,
        successfulLeads: leads,
        leadConversionRate: percentage(leads, views),
        submitSuccessRate: percentage(leads, attempts),
        couponReveals: sessions("popup_coupon_revealed"),
        popupAttributedOrders: popupOrders.length,
        popupAttributedRevenue: Number(popupRevenue.toFixed(2)),
        popupRevenueCurrency: popupRevenueByCurrency.length === 1 ? popupRevenueByCurrency[0].currency : null,
        popupAttributedRevenueByCurrency: popupRevenueByCurrency,
        popupRevenuePerView: views ? Number((popupRevenue / views).toFixed(2)) : 0,
        couponOrders: couponOrders.length,
        couponRevenue: Number(couponRevenue.toFixed(2)),
        revealToPurchaseRate: percentage(couponOrders.length, sessions("popup_coupon_revealed")),
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
        medium: buildBreakdown(events, orders, "medium"),
        campaign: buildBreakdown(events, orders, "campaign"),
        version: buildBreakdown(events, orders, "version"),
      },
      filterOptions: {
        device: optionValues("device"), page: optionValues("page"),
        source: optionValues("source"), medium: optionValues("medium"),
        campaign: optionValues("campaign"), version: optionValues("version"),
      },
      recentAttributedOrders: popupOrders.slice(0, 25).map(order => ({
        orderId: String(order.shopifyOrderGid).split("/").pop(),
        paidAt: order.paidAt,
        revenue: order.netRevenueAmount,
        currency: order.currency,
        source: order.popupUtmSource || "Unattributed",
        medium: order.popupUtmMedium || "Unattributed",
        campaign: order.popupUtmCampaign || "Unattributed",
        version: order.popupVersion || "Unversioned",
        attributionMethod: order.popupAttributionMethod || "Unattributed",
      })),
      recentLeads,
      leadLookupError,
      recentCouponOnlyOrders: couponOnlyOrders.slice(0, 25).map(order => ({
        orderId: String(order.shopifyOrderGid).split("/").pop(),
        paidAt: order.paidAt,
        revenue: order.netRevenueAmount,
        currency: order.currency,
        code: configuredCoupon,
        attributionStatus: "Coupon used, but no Concierge cart attribution was present",
      })),
      recentEvents: events.slice(0, 50).map(event => ({
        event: event.name, at: event.occurredAt, source: event.source, device: event.deviceClass,
        page: parsePayload(event.payload).path || null, version: parsePayload(event.payload).popupVersion || null,
        utmSource: event.utmSource, utmMedium: event.utmMedium, utmCampaign: event.utmCampaign,
      })),
      sourceOfTruth: {
        eligibilityViewsInteractionsDismissals: "Cloudflare D1 events received through Shopify's signed App Proxy",
        successfulLeads: "Unique HMAC-pseudonymized Shopify customers confirmed through Admin GraphQL; marketing consent is reported separately and is never implied by lead capture",
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

import { env as cloudflareEnv } from "cloudflare:workers";
import { Router } from "express";
import { getShopifyConfig, normalizeShopDomain, workerEnvValue } from "../lib/shopify-config.js";
import { normalizeShopifyCartToken } from "../lib/shopify-cart-token.js";
import prisma from "../lib/db.js";
import { createEventOnce } from "../lib/event-store.js";
import { findOrCreateVisitor } from "../lib/visitor-store.js";
import { extractDiscountCodes, extractPopupAttribution } from "../lib/popup-attribution.js";
import { capturePostHogServerEvent } from "../lib/posthog-server.js";
import {
  normalizePaidOrderWebhook,
  normalizeFunnelContext,
  normalizeShopifyPixelEvent,
  verifyShopifyWebhookHmac,
  type ShopifyIntegrationEvent,
} from "../lib/shopify-integration.js";
import {
  normalizeElementAssignmentContexts,
  promoteCartElementAssignmentsToCheckout,
  reconcileOrdersForCheckout,
  resolveBrowserVisitor,
  snapshotCheckoutElementAssignments,
  snapshotOrderElementAssignments,
} from "../services/element-attribution.js";

const router = Router();

function rawBodyText(body: unknown): string {
  if (Buffer.isBuffer(body as any)) {
    return new TextDecoder().decode(body as Uint8Array);
  }
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object") {
    return JSON.stringify(body);
  }
  return "";
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(result) && result >= 0 ? Number(result.toFixed(2)) : undefined;
}

function dateValue(value: unknown): Date | undefined {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function orderGid(payload: Record<string, unknown>): string | undefined {
  const explicit = textValue(payload.admin_graphql_api_id);
  if (explicit?.startsWith("gid://shopify/Order/")) return explicit;
  const id = textValue(payload.id);
  return id ? `gid://shopify/Order/${id}` : undefined;
}

function orderCurrency(payload: Record<string, unknown>): string | undefined {
  return (textValue(payload.presentment_currency) ?? textValue(payload.currency))?.toUpperCase();
}

function orderAmount(payload: Record<string, unknown>): number | undefined {
  return numberValue(payload.current_total_price ?? payload.total_price);
}

function safeOrderStatus(payload: Record<string, unknown>): { status: string; netRevenue: number; cancelledAt: Date | null } {
  const financialStatus = textValue(payload.financial_status)?.toUpperCase() ?? "PAID";
  const cancelledAt = dateValue(payload.cancelled_at) ?? null;
  const gross = orderAmount(payload) ?? 0;
  const isClosed = Boolean(cancelledAt) || ["REFUNDED", "VOIDED", "CANCELLED"].includes(financialStatus);
  return {
    status: isClosed ? "REFUNDED_OR_CANCELLED" : financialStatus,
    netRevenue: isClosed ? 0 : gross,
    cancelledAt,
  };
}

async function configuredShop() {
  const domain = normalizeShopDomain(getShopifyConfig().shopDomain);
  if (!domain || domain === "example.myshopify.com") return null;
  return prisma.shop.upsert({ where: { domain }, update: {}, create: { domain } });
}

function webhookSecret(): string {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.SHOPIFY_WEBHOOK_SECRET || envObj?.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "";
}

async function ensureCheckoutAttribution(shopId: string, checkoutToken: string | undefined, occurredAt: Date) {
  if (!checkoutToken) return null;
  return prisma.checkoutAttribution.upsert({
    where: { checkoutToken },
    update: {},
    create: {
      shopId,
      checkoutToken,
      startedAt: occurredAt,
      confidence: "UNATTRIBUTED",
    },
  });
}

async function persistOrderPaid(shopId: string, event: ShopifyIntegrationEvent, orderPayload: Record<string, unknown>) {
  const checkout = await ensureCheckoutAttribution(shopId, event.checkoutToken, event.occurredAt ?? new Date());
  const promotedAssignments = await promoteCartElementAssignmentsToCheckout({
    shopId,
    cartToken: normalizeShopifyCartToken(orderPayload.cart_token),
    checkoutToken: checkout?.checkoutToken,
  });
  const confidence = checkout?.visitorId || checkout?.funnelId || promotedAssignments > 0 ? "HIGH" : "UNATTRIBUTED";
  const popup = extractPopupAttribution(orderPayload);
  const discountCodes = extractDiscountCodes(orderPayload);
  const popupFields = {
    discountCodes: JSON.stringify(discountCodes),
    popupAttributed: Boolean(popup),
    popupVisitorKey: popup?.visitorId ?? null,
    popupSessionKey: popup?.sessionId ?? null,
    popupVersion: popup?.version ?? null,
    popupCouponCode: popup?.code ?? null,
    popupPage: popup?.page ?? null,
    popupDevice: popup?.device ?? null,
    popupUtmSource: popup?.utmSource ?? null,
    popupUtmMedium: popup?.utmMedium ?? null,
    popupUtmCampaign: popup?.utmCampaign ?? null,
    popupAttributionMethod: popup?.method ?? null,
  };
  const order = await prisma.orderAttribution.upsert({
    where: { shopifyOrderGid: event.orderGid! },
    update: {
      checkoutToken: checkout?.checkoutToken ?? null,
      funnelId: checkout?.funnelId ?? null,
      variantId: checkout?.lastVariantId ?? null,
      currency: event.currency!,
      grossAmount: event.grossAmount!,
      netRevenueAmount: event.grossAmount!,
      refundedAmount: 0,
      status: "PAID",
      confidence,
      isTest: false,
      paidAt: event.occurredAt ?? new Date(),
      ...popupFields,
    },
    create: {
      shopId,
      shopifyOrderGid: event.orderGid!,
      checkoutToken: checkout?.checkoutToken ?? null,
      funnelId: checkout?.funnelId ?? null,
      variantId: checkout?.lastVariantId ?? null,
      currency: event.currency!,
      grossAmount: event.grossAmount!,
      netRevenueAmount: event.grossAmount!,
      refundedAmount: 0,
      status: "PAID",
      confidence,
      isTest: false,
      paidAt: event.occurredAt ?? new Date(),
      ...popupFields,
    },
  });

  await createEventOnce(event.eventKey, {
      shopId,
      eventKey: event.eventKey,
      name: "purchase",
      source: "WEBHOOK",
      occurredAt: event.occurredAt ?? new Date(),
      funnelId: checkout?.funnelId ?? null,
      variantId: checkout?.lastVariantId ?? null,
      checkoutToken: checkout?.checkoutToken ?? null,
      payload: JSON.stringify(event.payload),
      isTest: false,
  });

  if (popup) {
    const popupVisitor = popup.visitorId
      ? await findOrCreateVisitor(shopId, popup.visitorId)
      : null;
    const popupEventKey = `shopify:popup_purchase:${event.orderGid}`;
    await createEventOnce(popupEventKey, {
        shopId,
        eventKey: popupEventKey,
        name: "popup_purchase",
        source: "WEBHOOK",
        occurredAt: event.occurredAt ?? new Date(),
        visitorId: popupVisitor?.id ?? null,
        utmSource: popup.utmSource ?? null,
        utmMedium: popup.utmMedium ?? null,
        utmCampaign: popup.utmCampaign ?? null,
        deviceClass: popup.device ?? null,
        payload: JSON.stringify({
          source: "orders/paid",
          couponCode: popup.code ?? null,
          hasVisitorAttribution: Boolean(popupVisitor),
          sessionId: popup.sessionId ?? null,
          conversationId: popup.conversationId ?? null,
          agent: popup.agent ?? null,
          trigger: popup.trigger ?? null,
          popupVersion: popup.version ?? null,
          path: popup.page ?? null,
          currency: event.currency,
          revenue: event.grossAmount,
        }),
        isTest: false,
    });
    await capturePostHogServerEvent("popup_purchase", popup.visitorId || event.orderGid!, {
      source: "novahair_ai_concierge",
      event_schema_version: 1,
      event_id: popupEventKey,
      "$insert_id": popupEventKey,
      order_id: event.orderGid!,
      revenue: event.grossAmount!,
      currency: event.currency!,
      popupVersion: popup.version || "",
      trigger: popup.trigger || "",
      utm_source: popup.utmSource || "",
      utm_medium: popup.utmMedium || "",
      utm_campaign: popup.utmCampaign || "",
    });
  }
  await snapshotOrderElementAssignments(order.id, order.checkoutToken);
  return order;
}

async function persistOrderUpdated(shopId: string, payload: Record<string, unknown>) {
  const gid = orderGid(payload);
  const amount = orderAmount(payload);
  const currency = orderCurrency(payload);
  if (!gid || amount === undefined || !currency) return false;

  const checkoutToken = textValue(payload.checkout_token);
  const checkout = await ensureCheckoutAttribution(
    shopId,
    checkoutToken,
    dateValue(payload.processed_at) ?? dateValue(payload.created_at) ?? new Date(),
  );
  const promotedAssignments = await promoteCartElementAssignmentsToCheckout({
    shopId,
    cartToken: normalizeShopifyCartToken(payload.cart_token),
    checkoutToken: checkout?.checkoutToken,
  });
  const status = safeOrderStatus(payload);
  const existing = await prisma.orderAttribution.findUnique({ where: { shopifyOrderGid: gid } });
  const popup = extractPopupAttribution(payload);
  const discountCodes = extractDiscountCodes(payload);
  const updatedPopupFields = popup ? {
    popupAttributed: true,
    popupVisitorKey: popup.visitorId ?? existing?.popupVisitorKey ?? null,
    popupSessionKey: popup.sessionId ?? existing?.popupSessionKey ?? null,
    popupVersion: popup.version ?? existing?.popupVersion ?? null,
    popupCouponCode: popup.code ?? existing?.popupCouponCode ?? null,
    popupPage: popup.page ?? existing?.popupPage ?? null,
    popupDevice: popup.device ?? existing?.popupDevice ?? null,
    popupUtmSource: popup.utmSource ?? existing?.popupUtmSource ?? null,
    popupUtmMedium: popup.utmMedium ?? existing?.popupUtmMedium ?? null,
    popupUtmCampaign: popup.utmCampaign ?? existing?.popupUtmCampaign ?? null,
    popupAttributionMethod: popup.method,
  } : {};
  const order = await prisma.orderAttribution.upsert({
    where: { shopifyOrderGid: gid },
    update: {
      checkoutToken: checkout?.checkoutToken ?? existing?.checkoutToken ?? null,
      funnelId: checkout?.funnelId ?? existing?.funnelId ?? null,
      variantId: checkout?.lastVariantId ?? existing?.variantId ?? null,
      currency,
      netRevenueAmount: status.netRevenue,
      refundedAmount: Math.max(0, (existing?.grossAmount ?? amount) - status.netRevenue),
      status: status.status,
      confidence: promotedAssignments > 0 ? "HIGH" : existing?.confidence ?? "UNATTRIBUTED",
      cancelledAt: status.cancelledAt,
      isTest: false,
      discountCodes: JSON.stringify(discountCodes),
      ...updatedPopupFields,
    },
    create: {
      shopId,
      shopifyOrderGid: gid,
      checkoutToken: checkout?.checkoutToken ?? null,
      funnelId: checkout?.funnelId ?? null,
      variantId: checkout?.lastVariantId ?? null,
      currency,
      grossAmount: amount,
      netRevenueAmount: status.netRevenue,
      refundedAmount: Math.max(0, amount - status.netRevenue),
      status: status.status,
      confidence: checkout?.visitorId || checkout?.funnelId || promotedAssignments > 0 ? "HIGH" : "UNATTRIBUTED",
      isTest: false,
      discountCodes: JSON.stringify(discountCodes),
      popupAttributed: Boolean(popup),
      popupVisitorKey: popup?.visitorId ?? null,
      popupSessionKey: popup?.sessionId ?? null,
      popupVersion: popup?.version ?? null,
      popupCouponCode: popup?.code ?? null,
      popupPage: popup?.page ?? null,
      popupDevice: popup?.device ?? null,
      popupUtmSource: popup?.utmSource ?? null,
      popupUtmMedium: popup?.utmMedium ?? null,
      popupUtmCampaign: popup?.utmCampaign ?? null,
      popupAttributionMethod: popup?.method ?? null,
      paidAt: dateValue(payload.processed_at) ?? dateValue(payload.created_at) ?? new Date(),
      cancelledAt: status.cancelledAt,
    },
  });
  await snapshotOrderElementAssignments(order.id, order.checkoutToken);
  return true;
}

router.post("/webhooks/shopify", async (req, res) => {
  const rawBody = rawBodyText(req.body);
  const topic = String(req.get("x-shopify-topic") ?? "").toLowerCase();
  const shopDomain = normalizeShopDomain(String(req.get("x-shopify-shop-domain") ?? ""));
  const webhookId = String(req.get("x-shopify-webhook-id") ?? "");
  const configuredDomain = normalizeShopDomain(getShopifyConfig().shopDomain);
  const secret = webhookSecret();

  if (!rawBody || !topic || !webhookId || !secret || shopDomain !== configuredDomain || !verifyShopifyWebhookHmac(rawBody, req.get("x-shopify-hmac-sha256") ?? undefined, secret)) {
    return res.status(401).json({ ok: false, error: "Invalid Shopify webhook request." });
  }

  try {
    const shop = await configuredShop();
    if (!shop) return res.status(503).json({ ok: false, error: "Shopify domain is not configured." });

    const existing = await prisma.shopifyWebhookDelivery.findUnique({ where: { webhookId } });
    if (existing) return res.json({ ok: true, duplicate: true });

    const payload = jsonRecord(JSON.parse(rawBody));
    if (!payload) return res.status(400).json({ ok: false, error: "Webhook body must be a JSON object." });
    if (topic === "orders/create" || topic === "orders/paid") {
      try {
        const d1 = (cloudflareEnv as any)?.DB ?? (globalThis as any).__SHOPIFY_WORKER_ENV__?.DB;
        if (d1) {
          const { processNovaHairOrderWebhook } = await import("../services/novahair-monitor.js");
          const nhResult = await processNovaHairOrderWebhook(payload, d1);
          if (nhResult.handled && (nhResult as any).bundle) {
            console.log("[NOVAHAIR CLOUD WEBHOOK] NovaHair order queued for durable CJ verification.");
          }
        }
      } catch (nhErr) {
        console.error("[NOVAHAIR WEBHOOK HOOK ERROR]", nhErr);
      }

      if (topic === "orders/create") {
        try {
          await prisma.shopifyWebhookDelivery.create({ data: { shopId: shop.id, webhookId, topic } });
        } catch (delErr) {
          console.warn("Webhook delivery record warning:", delErr);
        }
        return res.status(200).json({ ok: true, topic, novahair: true });
      }
    }

    if (topic === "orders/paid") {
      const normalized = normalizePaidOrderWebhook({
        rawBody,
        hmacSha256: req.get("x-shopify-hmac-sha256") ?? undefined,
        topic,
        shopDomain,
        expectedShopDomain: configuredDomain,
        webhookSecret: secret,
      });
      if (!normalized.accepted) return res.status(400).json({ ok: false, error: "Unsupported paid-order payload." });
      await persistOrderPaid(shop.id, normalized.value, payload);
    } else if (topic === "orders/updated") {
      await persistOrderUpdated(shop.id, payload);
    } else if (topic !== "orders/create" && topic !== "app/uninstalled") {
      return res.status(202).json({ ok: true, ignored: true });
    }

    try {
      await prisma.shopifyWebhookDelivery.create({ data: { shopId: shop.id, webhookId, topic } });
    } catch (delErr) {
      console.warn("Webhook delivery record warning:", delErr);
    }
    return res.status(200).json({ ok: true, topic });
  } catch (err: any) {
    console.error("Webhook processing error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Shopify webhook processing failed." });
  }
});

router.options("/api/shopify/pixel", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.status(204).end();
});

router.post("/api/shopify/pixel", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (workerEnvValue("SHOPIFY_PIXEL_INGEST_ENABLED") !== "true") {
    return res.status(503).json({ accepted: false, error: "Shopify Pixel ingestion is not enabled." });
  }

  const body = jsonRecord(req.body);
  const eventInput = jsonRecord(body?.event) ?? body;
  const rawContext = jsonRecord(body?.context) ?? {};
  const config = getShopifyConfig();
  const shopDomain = normalizeShopDomain(textValue(rawContext.shopDomain) ?? config.shopDomain);
  if (shopDomain !== normalizeShopDomain(config.shopDomain)) return res.status(400).json({ accepted: false, error: "Shop is not allowlisted." });

  const context = normalizeFunnelContext(rawContext, shopDomain);
  const normalized = normalizeShopifyPixelEvent({
    id: eventInput?.id,
    name: eventInput?.name,
    timestamp: eventInput?.timestamp,
    data: eventInput?.data,
  }, context);
  if (!normalized.accepted) return res.status(400).json({ accepted: false, error: "Unsupported Shopify Pixel event." });

  try {
    const shop = await configuredShop();
    if (!shop) return res.status(503).json({ accepted: false, error: "Shopify domain is not configured." });
    const visitor = context.visitorId ? await resolveBrowserVisitor(shop.id, context.visitorId) : null;
    const eventResult = await createEventOnce(normalized.value.eventKey, {
      shopId: shop.id,
      eventKey: normalized.value.eventKey,
      name: normalized.value.name === "CART_CHECKOUT_STARTED" ? "checkout_started" : "checkout_completed",
      source: "PIXEL",
      occurredAt: normalized.value.occurredAt ?? new Date(),
      visitorId: visitor?.id ?? null,
      funnelId: context.funnelId ?? null,
      stepId: context.stepId ?? null,
      variantId: context.variantId ?? null,
      checkoutToken: normalized.value.checkoutToken ?? null,
      utmSource: normalized.value.utmSource ?? null,
      utmMedium: normalized.value.utmMedium ?? null,
      utmCampaign: normalized.value.utmCampaign ?? null,
      payload: JSON.stringify(normalized.value.payload),
      isTest: Boolean(normalized.value.isInternal),
    });

    if (eventResult.duplicate) return res.json({ accepted: true, duplicate: true });

    if (normalized.value.checkoutToken && normalized.value.name === "CART_CHECKOUT_STARTED") {
      await prisma.checkoutAttribution.upsert({
        where: { checkoutToken: normalized.value.checkoutToken },
        update: { visitorId: visitor?.id ?? null, funnelId: context.funnelId ?? null, lastStepId: context.stepId ?? null, lastVariantId: context.variantId ?? null },
        create: { shopId: shop.id, checkoutToken: normalized.value.checkoutToken, visitorId: visitor?.id ?? null, funnelId: context.funnelId ?? null, lastStepId: context.stepId ?? null, lastVariantId: context.variantId ?? null, startedAt: normalized.value.occurredAt ?? new Date(), confidence: "MEDIUM" },
      });
      if (visitor) {
        const captured = await snapshotCheckoutElementAssignments({
          shopId: shop.id,
          checkoutToken: normalized.value.checkoutToken,
          visitorId: visitor.id,
          contexts: normalizeElementAssignmentContexts(rawContext.elementAssignments),
        });
        if (captured > 0) {
          await prisma.checkoutAttribution.update({
            where: { checkoutToken: normalized.value.checkoutToken },
            data: { confidence: "HIGH" },
          });
          await reconcileOrdersForCheckout(normalized.value.checkoutToken);
        }
      }
    }
    if (normalized.value.checkoutToken && normalized.value.name === "CHECKOUT_COMPLETED_OBSERVED") {
      await prisma.checkoutAttribution.updateMany({ where: { checkoutToken: normalized.value.checkoutToken }, data: { completedAt: normalized.value.occurredAt ?? new Date() } });
    }

    if (!normalized.value.isInternal && normalized.value.posthogDistinctId) {
      const posthogProperties: Record<string, string | number | boolean | null> = {
        event_schema_version: 1,
        event_id: normalized.value.eventKey,
        "$insert_id": normalized.value.eventKey,
        source: "shopify_web_pixel",
        checkout_token: normalized.value.checkoutToken ?? null,
        utm_source: normalized.value.utmSource ?? null,
        utm_medium: normalized.value.utmMedium ?? null,
        utm_campaign: normalized.value.utmCampaign ?? null,
        is_internal: false,
      };
      for (const [sourceKey, destinationKey] of [
        ["firstTouchUtmContent", "utm_content"],
        ["firstTouchCampaignId", "campaign_id"],
        ["firstTouchAdsetId", "adset_id"],
        ["firstTouchAdId", "ad_id"],
        ["firstTouchFbclid", "fbclid"],
        ["firstTouchGclid", "gclid"],
        ["firstTouchLandingPath", "landing_path"],
        ["firstTouchReferrerHost", "referrer_host"],
        ["lastTouchUtmSource", "last_touch_utm_source"],
        ["lastTouchUtmMedium", "last_touch_utm_medium"],
        ["lastTouchUtmCampaign", "last_touch_utm_campaign"],
      ] as const) {
        const value = normalized.value.payload[sourceKey];
        if (typeof value === "string" && value) posthogProperties[destinationKey] = value;
      }
      if (normalized.value.posthogSessionId) posthogProperties.$session_id = normalized.value.posthogSessionId;
      let posthogDistinctId = normalized.value.posthogDistinctId;
      if (normalized.value.shopifyCustomerId) {
        await capturePostHogServerEvent("$identify", normalized.value.shopifyCustomerId, {
          event_id: `${normalized.value.eventKey}:identify`,
          "$insert_id": `${normalized.value.eventKey}:identify`,
          "$anon_distinct_id": normalized.value.posthogDistinctId,
          shopify_customer_id: normalized.value.shopifyCustomerId,
          ...(normalized.value.posthogSessionId ? { $session_id: normalized.value.posthogSessionId } : {}),
        });
        posthogDistinctId = normalized.value.shopifyCustomerId;
      }
      await capturePostHogServerEvent(
        normalized.value.name === "CART_CHECKOUT_STARTED" ? "checkout_started" : "checkout_completed",
        posthogDistinctId,
        posthogProperties,
      );
    }
    return res.json({ accepted: true, duplicate: false });
  } catch {
    return res.status(500).json({ accepted: false, error: "Shopify Pixel event processing failed." });
  }
});

export default router;

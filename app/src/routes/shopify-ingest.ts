import { Router } from "express";
import { getShopifyConfig, normalizeShopDomain } from "../lib/shopify-config.js";
import prisma from "../lib/db.js";
import {
  normalizePaidOrderWebhook,
  normalizeShopifyPixelEvent,
  verifyShopifyWebhookHmac,
  type ShopifyIntegrationEvent,
  type FunnelContext,
} from "../lib/shopify-integration.js";

const router = Router();

function rawBodyText(body: unknown): string {
  return Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : "";
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
  return process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "";
}

async function persistOrderPaid(shopId: string, event: ShopifyIntegrationEvent) {
  const checkout = event.checkoutToken
    ? await prisma.checkoutAttribution.findUnique({ where: { checkoutToken: event.checkoutToken } })
    : null;
  const confidence = checkout ? "HIGH" : "UNATTRIBUTED";
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
    },
  });

  await prisma.event.upsert({
    where: { eventKey: event.eventKey },
    update: {},
    create: {
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
    },
  });
  return order;
}

async function persistOrderUpdated(shopId: string, payload: Record<string, unknown>) {
  const gid = orderGid(payload);
  const amount = orderAmount(payload);
  const currency = orderCurrency(payload);
  if (!gid || amount === undefined || !currency) return false;

  const checkoutToken = textValue(payload.checkout_token);
  const checkout = checkoutToken
    ? await prisma.checkoutAttribution.findUnique({ where: { checkoutToken } })
    : null;
  const status = safeOrderStatus(payload);
  const existing = await prisma.orderAttribution.findUnique({ where: { shopifyOrderGid: gid } });
  await prisma.orderAttribution.upsert({
    where: { shopifyOrderGid: gid },
    update: {
      checkoutToken: checkout?.checkoutToken ?? existing?.checkoutToken ?? null,
      funnelId: checkout?.funnelId ?? existing?.funnelId ?? null,
      variantId: checkout?.lastVariantId ?? existing?.variantId ?? null,
      currency,
      netRevenueAmount: status.netRevenue,
      refundedAmount: Math.max(0, (existing?.grossAmount ?? amount) - status.netRevenue),
      status: status.status,
      cancelledAt: status.cancelledAt,
      isTest: false,
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
      confidence: checkout ? "HIGH" : "UNATTRIBUTED",
      isTest: false,
      paidAt: dateValue(payload.processed_at) ?? dateValue(payload.created_at) ?? new Date(),
      cancelledAt: status.cancelledAt,
    },
  });
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
    if (!payload) return res.status(400).json({ ok: false, error: "Webhook payload must be an object." });

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
      await persistOrderPaid(shop.id, normalized.value);
    } else if (topic === "orders/updated") {
      await persistOrderUpdated(shop.id, payload);
    } else if (topic !== "app/uninstalled") {
      return res.status(202).json({ ok: true, ignored: true });
    }

    await prisma.shopifyWebhookDelivery.create({ data: { shopId: shop.id, webhookId, topic } });
    return res.status(200).json({ ok: true, topic });
  } catch {
    return res.status(500).json({ ok: false, error: "Shopify webhook processing failed." });
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
  if (process.env.SHOPIFY_PIXEL_INGEST_ENABLED !== "true") {
    return res.status(503).json({ accepted: false, error: "Shopify Pixel ingestion is not enabled." });
  }

  const body = jsonRecord(req.body);
  const eventInput = jsonRecord(body?.event) ?? body;
  const rawContext = jsonRecord(body?.context) ?? {};
  const config = getShopifyConfig();
  const shopDomain = normalizeShopDomain(textValue(rawContext.shopDomain) ?? config.shopDomain);
  if (shopDomain !== normalizeShopDomain(config.shopDomain)) return res.status(400).json({ accepted: false, error: "Shop is not allowlisted." });

  const context: FunnelContext = {
    shopDomain,
    visitorId: textValue(rawContext.visitorId),
    funnelId: textValue(rawContext.funnelId),
    stepId: textValue(rawContext.stepId),
    variantId: textValue(rawContext.variantId),
  };
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
    const existing = await prisma.event.findUnique({ where: { eventKey: normalized.value.eventKey } });
    if (existing) return res.json({ accepted: true, duplicate: true });

    let visitor = null;
    if (context.visitorId) {
      visitor = await prisma.visitor.upsert({
        where: { shopId_anonymousKeyHash: { shopId: shop.id, anonymousKeyHash: context.visitorId } },
        update: {},
        create: { shopId: shop.id, anonymousKeyHash: context.visitorId },
      });
    }
    await prisma.event.create({
      data: {
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
        payload: JSON.stringify(normalized.value.payload),
        isTest: false,
      },
    });

    if (normalized.value.checkoutToken && normalized.value.name === "CART_CHECKOUT_STARTED") {
      await prisma.checkoutAttribution.upsert({
        where: { checkoutToken: normalized.value.checkoutToken },
        update: { visitorId: visitor?.id ?? null, funnelId: context.funnelId ?? null, lastStepId: context.stepId ?? null, lastVariantId: context.variantId ?? null },
        create: { shopId: shop.id, checkoutToken: normalized.value.checkoutToken, visitorId: visitor?.id ?? null, funnelId: context.funnelId ?? null, lastStepId: context.stepId ?? null, lastVariantId: context.variantId ?? null, startedAt: normalized.value.occurredAt ?? new Date(), confidence: "MEDIUM" },
      });
    }
    if (normalized.value.checkoutToken && normalized.value.name === "CHECKOUT_COMPLETED_OBSERVED") {
      await prisma.checkoutAttribution.updateMany({ where: { checkoutToken: normalized.value.checkoutToken }, data: { completedAt: normalized.value.occurredAt ?? new Date() } });
    }
    return res.json({ accepted: true, duplicate: false });
  } catch {
    return res.status(500).json({ accepted: false, error: "Shopify Pixel event processing failed." });
  }
});

export default router;

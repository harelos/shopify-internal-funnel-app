import prisma from "../lib/db.js";
import { normalizeShopifyCartToken } from "../lib/shopify-cart-token.js";
import { hashAnonymousKey } from "./element-ab-engine.js";
import { captureElementPurchaseToPostHog } from "./element-posthog.js";

export interface ElementAssignmentContext {
  assignmentId: string;
  experimentId: string;
  variantId: string;
  slotId: string;
}

function identifier(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{8,120}$/.test(text) ? text : "";
}

export function normalizeElementAssignmentContexts(value: unknown): ElementAssignmentContext[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ElementAssignmentContext>();
  value.slice(0, 20).forEach(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const input = raw as Record<string, unknown>;
    const context = {
      assignmentId: identifier(input.assignmentId),
      experimentId: identifier(input.experimentId),
      variantId: identifier(input.variantId),
      slotId: identifier(input.slotId),
    };
    if (Object.values(context).every(Boolean)) unique.set(context.experimentId, context);
  });
  return [...unique.values()];
}

export async function resolveBrowserVisitor(shopId: string, anonymousKey: string) {
  const normalized = String(anonymousKey ?? "").trim();
  if (normalized.length < 8 || normalized.length > 200) return null;
  const hashed = hashAnonymousKey(normalized);
  const hashedVisitor = await prisma.visitor.findUnique({
    where: { shopId_anonymousKeyHash: { shopId, anonymousKeyHash: hashed } },
  });
  if (hashedVisitor) return hashedVisitor;
  const legacyVisitor = await prisma.visitor.findUnique({
    where: { shopId_anonymousKeyHash: { shopId, anonymousKeyHash: normalized } },
  });
  if (legacyVisitor) return legacyVisitor;
  return prisma.visitor.create({ data: { shopId, anonymousKeyHash: hashed } });
}

export async function snapshotCheckoutElementAssignments(input: {
  shopId: string;
  checkoutToken: string;
  visitorId: string;
  contexts: ElementAssignmentContext[];
}) {
  if (!input.contexts.length) return 0;
  const requestedIds = input.contexts.map(context => context.assignmentId);
  const assignments = await prisma.elementAssignment.findMany({
    where: {
      id: { in: requestedIds },
      visitorId: input.visitorId,
      experiment: { slot: { shopId: input.shopId } },
    },
    include: { experiment: true },
  });
  const requested = new Map(input.contexts.map(context => [context.assignmentId, context]));
  let captured = 0;
  for (const assignment of assignments) {
    const context = requested.get(assignment.id);
    if (!context || context.experimentId !== assignment.experimentId || context.variantId !== assignment.variantId || context.slotId !== assignment.experiment.slotId) continue;
    await prisma.checkoutElementAttribution.upsert({
      where: { checkoutToken_experimentId: { checkoutToken: input.checkoutToken, experimentId: assignment.experimentId } },
      update: {
        visitorId: input.visitorId,
        assignmentId: assignment.id,
        variantId: assignment.variantId,
        slotId: assignment.experiment.slotId,
        capturedAt: new Date(),
      },
      create: {
        shopId: input.shopId,
        checkoutToken: input.checkoutToken,
        visitorId: input.visitorId,
        assignmentId: assignment.id,
        experimentId: assignment.experimentId,
        variantId: assignment.variantId,
        slotId: assignment.experiment.slotId,
      },
    });
    captured += 1;
  }
  return captured;
}

export async function snapshotCartElementAssignments(input: {
  shopId: string;
  cartToken: string;
  visitorId: string;
  contexts: ElementAssignmentContext[];
}) {
  const cartToken = normalizeShopifyCartToken(input.cartToken);
  if (!cartToken || !input.contexts.length) return 0;
  const requestedIds = input.contexts.map(context => context.assignmentId);
  const assignments = await prisma.elementAssignment.findMany({
    where: {
      id: { in: requestedIds },
      visitorId: input.visitorId,
      experiment: { slot: { shopId: input.shopId } },
    },
    include: { experiment: true },
  });
  const requested = new Map(input.contexts.map(context => [context.assignmentId, context]));
  let captured = 0;
  for (const assignment of assignments) {
    const context = requested.get(assignment.id);
    if (!context || context.experimentId !== assignment.experimentId || context.variantId !== assignment.variantId || context.slotId !== assignment.experiment.slotId) continue;
    await prisma.cartElementAttribution.upsert({
      where: { cartToken_experimentId: { cartToken, experimentId: assignment.experimentId } },
      update: {
        visitorId: input.visitorId,
        assignmentId: assignment.id,
        variantId: assignment.variantId,
        slotId: assignment.experiment.slotId,
        capturedAt: new Date(),
      },
      create: {
        shopId: input.shopId,
        cartToken,
        visitorId: input.visitorId,
        assignmentId: assignment.id,
        experimentId: assignment.experimentId,
        variantId: assignment.variantId,
        slotId: assignment.experiment.slotId,
      },
    });
    captured += 1;
  }
  return captured;
}

export async function promoteCartElementAssignmentsToCheckout(input: {
  shopId: string;
  cartToken: string | null | undefined;
  checkoutToken: string | null | undefined;
}) {
  const cartToken = normalizeShopifyCartToken(input.cartToken);
  const checkoutToken = String(input.checkoutToken ?? "").trim();
  if (!cartToken || !checkoutToken) return 0;
  const checkout = await prisma.checkoutAttribution.findUnique({ where: { checkoutToken } });
  if (!checkout || checkout.shopId !== input.shopId) return 0;
  const cartAssignments = await prisma.cartElementAttribution.findMany({
    where: { shopId: input.shopId, cartToken },
  });
  for (const attribution of cartAssignments) {
    await prisma.checkoutElementAttribution.upsert({
      where: { checkoutToken_experimentId: { checkoutToken, experimentId: attribution.experimentId } },
      update: {
        visitorId: attribution.visitorId,
        assignmentId: attribution.assignmentId,
        variantId: attribution.variantId,
        slotId: attribution.slotId,
        capturedAt: new Date(),
      },
      create: {
        shopId: input.shopId,
        checkoutToken,
        visitorId: attribution.visitorId,
        assignmentId: attribution.assignmentId,
        experimentId: attribution.experimentId,
        variantId: attribution.variantId,
        slotId: attribution.slotId,
      },
    });
  }
  if (cartAssignments.length > 0) {
    await prisma.checkoutAttribution.update({
      where: { checkoutToken },
      data: { visitorId: cartAssignments[0].visitorId, confidence: "HIGH" },
    });
  }
  return cartAssignments.length;
}

export async function snapshotOrderElementAssignments(orderAttributionId: string, checkoutToken: string | null) {
  if (!checkoutToken) return 0;
  const checkoutAssignments = await prisma.checkoutElementAttribution.findMany({
    where: { checkoutToken },
    include: { experiment: true, variant: true, slot: true },
  });
  const order = await prisma.orderAttribution.findUnique({ where: { id: orderAttributionId } });
  if (!order) return 0;
  for (const attribution of checkoutAssignments) {
    await prisma.orderElementAttribution.upsert({
      where: { orderAttributionId_experimentId: { orderAttributionId, experimentId: attribution.experimentId } },
      update: {
        checkoutAttributionId: attribution.id,
        assignmentId: attribution.assignmentId,
        variantId: attribution.variantId,
        slotId: attribution.slotId,
        attributedAt: new Date(),
      },
      create: {
        shopId: order.shopId,
        orderAttributionId,
        checkoutAttributionId: attribution.id,
        assignmentId: attribution.assignmentId,
        experimentId: attribution.experimentId,
        variantId: attribution.variantId,
        slotId: attribution.slotId,
      },
    });
    if (!order.isTest && order.status === "PAID") {
      const eventId = `element_purchase:${order.id}:${attribution.experimentId}`;
      await captureElementPurchaseToPostHog(attribution.visitorId, {
        eventId,
        assignmentId: attribution.assignmentId,
        experimentId: attribution.experimentId,
        experimentKey: attribution.experiment.key,
        posthogFlagKey: attribution.experiment.posthogFlagKey,
        variantId: attribution.variantId,
        variantKey: attribution.variant.key,
        slotId: attribution.slotId,
        slotKey: attribution.slot.slotKey,
        pagePath: attribution.slot.pagePath,
        orderId: order.shopifyOrderGid,
        checkoutToken,
        revenue: order.netRevenueAmount,
        currency: order.currency,
      });
    }
  }
  return checkoutAssignments.length;
}

export async function reconcileOrdersForCheckout(checkoutToken: string) {
  const orders = await prisma.orderAttribution.findMany({ where: { checkoutToken } });
  let captured = 0;
  for (const order of orders) captured += await snapshotOrderElementAssignments(order.id, checkoutToken);
  return captured;
}

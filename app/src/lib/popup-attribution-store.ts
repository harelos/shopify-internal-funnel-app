import prisma from "./db.js";
import { hashPopupIdentity } from "./popup-attribution.js";
import { verifyPopupIdentityToken } from "./popup-session-token.js";

const DEFAULT_ATTRIBUTION_WINDOW_DAYS = 14;

function attributionWindowDays(): number {
  const value = Number(process.env.POPUP_ATTRIBUTION_WINDOW_DAYS ?? DEFAULT_ATTRIBUTION_WINDOW_DAYS);
  return Number.isFinite(value) ? Math.max(1, Math.min(30, Math.round(value))) : DEFAULT_ATTRIBUTION_WINDOW_DAYS;
}

export async function linkPopupCheckoutFromPixel(input: {
  shopDomain: string;
  popupSessionToken?: string | null;
  checkoutToken?: string | null;
  eventName: "CART_CHECKOUT_STARTED" | "CHECKOUT_COMPLETED_OBSERVED";
  occurredAt: Date;
}) {
  const token = String(input.popupSessionToken || "");
  const checkoutToken = String(input.checkoutToken || "").trim();
  if (!token || !checkoutToken) return { linked: 0, reason: "missing_signed_popup_context" };

  const claims = verifyPopupIdentityToken(token, {
    expectedShopDomain: input.shopDomain,
    expectedKind: "session",
  });
  if (claims.kind !== "session") return { linked: 0, reason: "invalid_signed_popup_context" };

  const visitorHash = hashPopupIdentity(claims.visitorId);
  const sessionHash = hashPopupIdentity(claims.sessionId);
  const cutoff = new Date(input.occurredAt.getTime() - attributionWindowDays() * 86_400_000);
  const assignments = await prisma.popupExperimentAssignment.findMany({
    where: {
      shopDomain: input.shopDomain,
      assignedAt: { gte: cutoff },
      OR: [{ sessionHash }, { visitorHash }],
    },
    orderBy: { assignedAt: "desc" },
  });

  let linked = 0;
  for (const assignment of assignments) {
    await prisma.popupCheckoutConversion.upsert({
      where: {
        popupAssignmentId_checkoutToken: {
          popupAssignmentId: assignment.id,
          checkoutToken,
        },
      },
      update: input.eventName === "CHECKOUT_COMPLETED_OBSERVED"
        ? { checkoutCompletedAt: input.occurredAt }
        : { checkoutStartedAt: input.occurredAt },
      create: {
        popupAssignmentId: assignment.id,
        checkoutToken,
        checkoutStartedAt: input.occurredAt,
        checkoutCompletedAt: input.eventName === "CHECKOUT_COMPLETED_OBSERVED" ? input.occurredAt : null,
        source: "SIGNED_SESSION_SHOPIFY_PIXEL",
        isTest: assignment.isTest,
      },
    });
    linked += 1;
  }
  return { linked, reason: linked ? "signed_session_match" : "no_recent_popup_assignment" };
}

export async function reconcilePopupOrderFromWebhook(input: {
  checkoutToken?: string | null;
  shopifyOrderGid: string;
  currency: string;
  grossAmount: number;
  netRevenueAmount: number;
  refundedAmount?: number;
  orderStatus: string;
  orderPaidAt: Date;
}) {
  const checkoutToken = String(input.checkoutToken || "").trim();
  if (!checkoutToken) return { updated: 0, reason: "order_missing_checkout_token" };
  const result = await prisma.popupCheckoutConversion.updateMany({
    where: { checkoutToken },
    data: {
      shopifyOrderGid: input.shopifyOrderGid,
      currency: input.currency,
      grossAmount: input.grossAmount,
      netRevenueAmount: input.netRevenueAmount,
      refundedAmount: Math.max(0, Number(input.refundedAmount || 0)),
      orderStatus: input.orderStatus,
      orderPaidAt: input.orderPaidAt,
      verifiedAt: new Date(),
      source: "SHOPIFY_WEBHOOK_VERIFIED",
    },
  });
  return { updated: result.count, reason: result.count ? "verified_order_reconciled" : "no_popup_checkout_link" };
}

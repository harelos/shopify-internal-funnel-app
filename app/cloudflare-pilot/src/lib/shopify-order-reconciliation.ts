import { extractDiscountCodes, extractPopupAttribution, type PopupAttribution } from "./popup-attribution.js";

export interface ShopifyOrderForAttributionReconciliation {
  id: string;
  processedAt: string;
  test: boolean;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  discountCodes: string[];
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  netPaymentSet: { shopMoney: { amount: string; currencyCode: string } };
  customAttributes: Array<{ key: string; value: string | null }>;
  lineItems: { nodes: Array<{ customAttributes: Array<{ key: string; value: string | null }> }> };
}

export interface ExistingOrderAttributionSnapshot {
  currency: string;
  grossAmount: number;
  netRevenueAmount: number;
  refundedAmount: number;
  status: string;
  isTest: boolean;
  discountCodes: string;
  paidAt: Date;
  cancelledAt: Date | null;
  popupAttributed: boolean;
  popupVisitorKey: string | null;
  popupSessionKey: string | null;
  popupVersion: string | null;
  popupCouponCode: string | null;
  popupPage: string | null;
  popupDevice: string | null;
  popupUtmSource: string | null;
  popupUtmMedium: string | null;
  popupUtmCampaign: string | null;
  popupAttributionMethod: string | null;
}

export interface ReconciledOrderFields {
  shopifyOrderGid: string;
  currency: string;
  grossAmount: number;
  netRevenueAmount: number;
  refundedAmount: number;
  status: string;
  isTest: false;
  discountCodes: string;
  paidAt: Date;
  cancelledAt: Date | null;
  isRevenueOrder: boolean;
  popup: PopupAttribution | null;
}

function money(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asWebhookPayload(order: ShopifyOrderForAttributionReconciliation): Record<string, unknown> {
  return {
    note_attributes: order.customAttributes.map(attribute => ({ name: attribute.key, value: attribute.value })),
    line_items: order.lineItems.nodes.map(lineItem => ({
      properties: lineItem.customAttributes.map(attribute => ({ name: attribute.key, value: attribute.value })),
    })),
    discount_codes: order.discountCodes.map(code => ({ code })),
  };
}

export function normalizeShopifyOrderForAttribution(
  order: ShopifyOrderForAttributionReconciliation,
): ReconciledOrderFields | null {
  if (!order.id.startsWith("gid://shopify/Order/") || order.test) return null;
  const paidAt = validDate(order.processedAt);
  const grossAmount = money(order.currentTotalPriceSet.shopMoney.amount);
  const reportedNetAmount = money(order.netPaymentSet.shopMoney.amount);
  const currency = order.netPaymentSet.shopMoney.currencyCode.trim().toUpperCase();
  const grossCurrency = order.currentTotalPriceSet.shopMoney.currencyCode.trim().toUpperCase();
  if (!paidAt || grossAmount == null || reportedNetAmount == null || !/^[A-Z]{3}$/.test(currency) || currency !== grossCurrency) {
    return null;
  }

  const financialStatus = (order.displayFinancialStatus || "PAID").trim().toUpperCase();
  const cancelledAt = validDate(order.cancelledAt);
  const isClosed = Boolean(cancelledAt) || ["CANCELLED", "REFUNDED", "VOIDED"].includes(financialStatus);
  const netRevenueAmount = isClosed ? 0 : reportedNetAmount;
  const status = isClosed ? "REFUNDED_OR_CANCELLED" : financialStatus;
  const payload = asWebhookPayload(order);
  const discountCodes = JSON.stringify(extractDiscountCodes(payload));
  const isRevenueOrder = !isClosed
    && netRevenueAmount > 0
    && !["AUTHORIZED", "EXPIRED", "PENDING", "VOIDED"].includes(financialStatus);

  return {
    shopifyOrderGid: order.id,
    currency,
    grossAmount,
    netRevenueAmount,
    refundedAmount: Math.max(0, Number((grossAmount - netRevenueAmount).toFixed(2))),
    status,
    isTest: false,
    discountCodes,
    paidAt,
    cancelledAt,
    isRevenueOrder,
    popup: extractPopupAttribution(payload),
  };
}

export function reconciliationFinancialUpdate(
  fields: ReconciledOrderFields,
  existing?: ExistingOrderAttributionSnapshot,
) {
  const base = {
    currency: fields.currency,
    grossAmount: fields.grossAmount,
    netRevenueAmount: fields.netRevenueAmount,
    refundedAmount: fields.refundedAmount,
    status: fields.status,
    discountCodes: fields.discountCodes,
    paidAt: fields.paidAt,
    cancelledAt: fields.cancelledAt,
  };
  if (!fields.popup) return base;
  return {
    ...base,
    popupAttributed: true,
    popupVisitorKey: fields.popup.visitorId ?? existing?.popupVisitorKey ?? null,
    popupSessionKey: fields.popup.sessionId ?? existing?.popupSessionKey ?? null,
    popupVersion: fields.popup.version ?? existing?.popupVersion ?? null,
    popupCouponCode: fields.popup.code ?? existing?.popupCouponCode ?? null,
    popupPage: fields.popup.page ?? existing?.popupPage ?? null,
    popupDevice: fields.popup.device ?? existing?.popupDevice ?? null,
    popupUtmSource: fields.popup.utmSource ?? existing?.popupUtmSource ?? null,
    popupUtmMedium: fields.popup.utmMedium ?? existing?.popupUtmMedium ?? null,
    popupUtmCampaign: fields.popup.utmCampaign ?? existing?.popupUtmCampaign ?? null,
    popupAttributionMethod: fields.popup.method,
  };
}

export function reconciliationCreateFields(fields: ReconciledOrderFields) {
  return {
    ...reconciliationFinancialUpdate(fields),
    isTest: false as const,
    shopifyOrderGid: fields.shopifyOrderGid,
    checkoutToken: null,
    funnelId: null,
    variantId: null,
    confidence: "UNATTRIBUTED",
    popupAttributed: Boolean(fields.popup),
    popupVisitorKey: fields.popup?.visitorId ?? null,
    popupSessionKey: fields.popup?.sessionId ?? null,
    popupVersion: fields.popup?.version ?? null,
    popupCouponCode: fields.popup?.code ?? null,
    popupPage: fields.popup?.page ?? null,
    popupDevice: fields.popup?.device ?? null,
    popupUtmSource: fields.popup?.utmSource ?? null,
    popupUtmMedium: fields.popup?.utmMedium ?? null,
    popupUtmCampaign: fields.popup?.utmCampaign ?? null,
    popupAttributionMethod: fields.popup?.method ?? null,
  };
}

function dateEqual(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

export function needsOrderReconciliation(
  existing: ExistingOrderAttributionSnapshot,
  fields: ReconciledOrderFields,
): boolean {
  const financialChanged = existing.currency !== fields.currency
    || existing.grossAmount !== fields.grossAmount
    || existing.netRevenueAmount !== fields.netRevenueAmount
    || existing.refundedAmount !== fields.refundedAmount
    || existing.status !== fields.status
    || existing.discountCodes !== fields.discountCodes
    || !dateEqual(existing.paidAt, fields.paidAt)
    || !dateEqual(existing.cancelledAt, fields.cancelledAt);
  if (financialChanged) return true;
  if (!fields.popup) return false;
  return !existing.popupAttributed
    || (fields.popup.visitorId !== undefined && existing.popupVisitorKey !== fields.popup.visitorId)
    || (fields.popup.sessionId !== undefined && existing.popupSessionKey !== fields.popup.sessionId)
    || (fields.popup.version !== undefined && existing.popupVersion !== fields.popup.version)
    || (fields.popup.code !== undefined && existing.popupCouponCode !== fields.popup.code)
    || (fields.popup.page !== undefined && existing.popupPage !== fields.popup.page)
    || (fields.popup.device !== undefined && existing.popupDevice !== fields.popup.device)
    || (fields.popup.utmSource !== undefined && existing.popupUtmSource !== fields.popup.utmSource)
    || (fields.popup.utmMedium !== undefined && existing.popupUtmMedium !== fields.popup.utmMedium)
    || (fields.popup.utmCampaign !== undefined && existing.popupUtmCampaign !== fields.popup.utmCampaign)
    || existing.popupAttributionMethod !== fields.popup.method;
}

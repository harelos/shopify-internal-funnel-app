import { createHash } from "node:crypto";

export type PopupExperimentGroup = "POPUP" | "HOLDOUT";

export interface PopupAttributionVariant {
  key: string;
  weightBasisPoints: number;
}

export interface PopupTreatmentAssignment {
  group: PopupExperimentGroup;
  variantKey: string | null;
  holdoutBucket: number;
  variantBucket: number | null;
}

function clampBasisPoints(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(5000, Math.round(parsed)));
}

function bucket(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 10_000;
}

export function hashPopupIdentity(value: string, pepper?: string): string {
  const secret = String(pepper || process.env.POPUP_EVENT_HASH_PEPPER || process.env.POPUP_SESSION_SECRET || "");
  if (secret.length < 32) throw new Error("Popup attribution hashing requires a server secret of at least 32 characters.");
  return createHash("sha256").update(`${secret}:${String(value || "")}`).digest("hex");
}

export function assignPopupTreatment(input: {
  campaignKey: string;
  experimentVersion: number;
  visitorId: string;
  holdoutBasisPoints?: number;
  variants: PopupAttributionVariant[];
}): PopupTreatmentAssignment {
  const campaignKey = String(input.campaignKey || "").trim();
  const visitorId = String(input.visitorId || "").trim();
  if (!campaignKey || !visitorId) throw new Error("campaignKey and visitorId are required for popup treatment assignment.");

  const experimentVersion = Math.max(1, Math.floor(Number(input.experimentVersion || 1)));
  const holdoutBasisPoints = clampBasisPoints(input.holdoutBasisPoints, 1000);
  const holdoutBucket = bucket(`popup-holdout:${campaignKey}:${experimentVersion}:${visitorId}`);
  if (holdoutBucket < holdoutBasisPoints) {
    return { group: "HOLDOUT", variantKey: null, holdoutBucket, variantBucket: null };
  }

  const variants = input.variants
    .map(variant => ({ key: String(variant.key || "").trim(), weightBasisPoints: Math.max(0, Math.round(Number(variant.weightBasisPoints || 0))) }))
    .filter(variant => variant.key && variant.weightBasisPoints > 0);
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weightBasisPoints, 0);
  if (totalWeight !== 10_000) throw new Error("Popup attribution variants must total exactly 10,000 basis points.");

  const variantBucket = bucket(`popup-variant:${campaignKey}:${experimentVersion}:${visitorId}`);
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weightBasisPoints;
    if (variantBucket < cursor) {
      return { group: "POPUP", variantKey: variant.key, holdoutBucket, variantBucket };
    }
  }
  throw new Error("Popup treatment assignment failed to select a variant.");
}

export interface PopupAttributionAssignmentRecord {
  id: string;
  group: PopupExperimentGroup;
  variantKey: string | null;
}

export interface PopupAttributionConversionRecord {
  popupAssignmentId: string;
  checkoutToken: string;
  checkoutStartedAt: Date;
  checkoutCompletedAt?: Date | null;
  shopifyOrderGid?: string | null;
  netRevenueAmount?: number | null;
  currency?: string | null;
  orderStatus?: string | null;
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function summarizePopupAttribution(
  assignments: PopupAttributionAssignmentRecord[],
  conversions: PopupAttributionConversionRecord[],
) {
  const byAssignment = new Map(assignments.map(assignment => [assignment.id, assignment]));
  const popupAssignments = assignments.filter(assignment => assignment.group === "POPUP");
  const holdoutAssignments = assignments.filter(assignment => assignment.group === "HOLDOUT");

  const purchasedAssignmentIds = new Set<string>();
  const checkoutAssignmentIds = new Set<string>();
  const completedCheckoutAssignmentIds = new Set<string>();
  let verifiedRevenue = 0;

  const popupPurchased = new Set<string>();
  const holdoutPurchased = new Set<string>();
  const variantRevenue: Record<string, number> = {};
  const variantPurchases: Record<string, number> = {};

  for (const conversion of conversions) {
    const assignment = byAssignment.get(conversion.popupAssignmentId);
    if (!assignment) continue;
    checkoutAssignmentIds.add(assignment.id);
    if (conversion.checkoutCompletedAt) completedCheckoutAssignmentIds.add(assignment.id);
    if (!conversion.shopifyOrderGid) continue;

    purchasedAssignmentIds.add(assignment.id);
    const revenue = Number.isFinite(Number(conversion.netRevenueAmount)) ? Number(conversion.netRevenueAmount) : 0;
    verifiedRevenue += revenue;
    if (assignment.group === "POPUP") {
      popupPurchased.add(assignment.id);
      const key = assignment.variantKey || "unknown";
      variantRevenue[key] = Number(((variantRevenue[key] || 0) + revenue).toFixed(2));
      variantPurchases[key] = (variantPurchases[key] || 0) + 1;
    } else {
      holdoutPurchased.add(assignment.id);
    }
  }

  const popupPurchaseRatePct = pct(popupPurchased.size, popupAssignments.length);
  const holdoutPurchaseRatePct = pct(holdoutPurchased.size, holdoutAssignments.length);
  const absoluteLiftPctPoints = popupPurchaseRatePct !== null && holdoutPurchaseRatePct !== null
    ? Number((popupPurchaseRatePct - holdoutPurchaseRatePct).toFixed(2))
    : null;
  const relativeLiftPct = popupPurchaseRatePct !== null && holdoutPurchaseRatePct && holdoutPurchaseRatePct > 0
    ? Number((((popupPurchaseRatePct / holdoutPurchaseRatePct) - 1) * 100).toFixed(2))
    : null;

  return {
    assignedVisitors: assignments.length,
    popupVisitors: popupAssignments.length,
    holdoutVisitors: holdoutAssignments.length,
    checkoutVisitors: checkoutAssignmentIds.size,
    completedCheckoutVisitors: completedCheckoutAssignmentIds.size,
    purchaseVisitors: purchasedAssignmentIds.size,
    popupPurchaseVisitors: popupPurchased.size,
    holdoutPurchaseVisitors: holdoutPurchased.size,
    popupPurchaseRatePct,
    holdoutPurchaseRatePct,
    absoluteLiftPctPoints,
    relativeLiftPct,
    verifiedRevenue: Number(verifiedRevenue.toFixed(2)),
    variantRevenue,
    variantPurchases,
  };
}

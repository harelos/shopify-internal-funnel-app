export const BASIS_POINTS_TOTAL = 10_000;

export type FunnelStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type StepKind = "LANDING" | "ADVERTORIAL" | "SALES" | "OFFER" | "PRE_CHECKOUT" | "CHECKOUT_HANDOFF";
export type VersionState = "DRAFT" | "PREVIEW" | "PUBLISHED" | "ARCHIVED";
export type ExperimentStatus = "DRAFT" | "RUNNING" | "PAUSED" | "COMPLETED" | "ARCHIVED";
export type EventSource = "LOCAL_SYNTHETIC" | "STOREFRONT" | "PIXEL" | "WEBHOOK";
export type EventName = "FUNNEL_STEP_ENTERED" | "FUNNEL_PAGE_VIEWED" | "FUNNEL_CTA_CLICKED" | "FUNNEL_NEXT_STEP_ENTERED" | "CART_CHECKOUT_STARTED" | "CHECKOUT_COMPLETED_OBSERVED" | "SHOPIFY_ORDER_PAID";
export type AttributionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNATTRIBUTED";
export type DeviceClass = "mobile" | "tablet" | "desktop" | "unknown";

export interface Shop { id: string; domain: string; localOnly: true; createdAt: Date; }
export interface Funnel { id: string; shopId: string; name: string; slug: string; status: FunnelStatus; createdAt: Date; updatedAt: Date; archivedAt?: Date; }
export interface Step { id: string; funnelId: string; position: number; name: string; kind: StepKind; createdAt: Date; }
export interface Variant { id: string; stepId: string; name: string; publishedVersionId?: string; createdAt: Date; }

export type FindingSeverity = "portable" | "mapped" | "review" | "unsupported";
export interface PortabilityFinding { severity: FindingSeverity; subject: string; message: string; fallback: string; }
export interface PortabilityReport { findings: PortabilityFinding[]; scriptsRemoved: number; iframesRemoved: number; documentTagsExtracted: boolean; }
export interface ContentVersion {
  id: string; variantId: string; revision: number; state: VersionState; rawHtml: string; normalizedHtml: string;
  portabilityReport: PortabilityReport; createdAt: Date; publishedAt?: Date;
}
export interface Experiment { id: string; stepId: string; status: ExperimentStatus; allocationVersion: number; createdAt: Date; }
export interface ExperimentAllocation { id: string; experimentId: string; variantId: string; weightBasisPoints: number; }
export interface Visitor { id: string; shopId: string; anonymousKeyHash: string; createdAt: Date; }
export interface Assignment { id: string; visitorId: string; experimentId: string; variantId: string; allocationVersion: number; assignedAt: Date; }
export interface FunnelEvent {
  id: string; shopId: string; eventKey: string; name: EventName; occurredAt: Date; receivedAt: Date; visitorId?: string;
  source: EventSource; funnelId?: string; stepId?: string; variantId?: string; checkoutToken?: string;
  utmSource?: string; utmMedium?: string; utmCampaign?: string; deviceClass?: DeviceClass;
  payload: Record<string, unknown>; isTest: boolean;
}
export interface CheckoutAttribution {
  id: string; shopId: string; checkoutToken: string; visitorId?: string; funnelId?: string; lastStepId?: string;
  lastVariantId?: string; startedAt: Date; confidence: AttributionConfidence;
}
export interface OrderAttribution {
  id: string; shopId: string; shopifyOrderGid: string; checkoutToken?: string; funnelId?: string; variantId?: string;
  currency: string; grossAmount: number; netRevenueAmount: number; paidAt: Date; confidence: AttributionConfidence; isTest: boolean;
}
export interface SyntheticEventInput {
  shopId: string; eventKey: string; name: EventName; occurredAt?: Date; visitorId?: string; funnelId?: string; stepId?: string;
  variantId?: string; checkoutToken?: string; orderGid?: string; currency?: string; grossAmount?: number; payload?: Record<string, unknown>;
  source?: EventSource; isTest?: boolean; utmSource?: string; utmMedium?: string; utmCampaign?: string; deviceClass?: DeviceClass;
}

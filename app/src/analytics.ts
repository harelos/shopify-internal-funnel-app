import type { DeviceClass, EventSource, FunnelEvent, OrderAttribution } from "./types.js";
import { LocalStore } from "./store.js";

export interface ReportFilters {
  dataMode?: "TEST" | "LIVE";
  from?: Date;
  to?: Date;
  stepId?: string;
  variantId?: string;
  source?: EventSource;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  deviceClass?: DeviceClass;
}

export interface StepMetrics {
  stepId: string;
  uniqueEntries: number;
  pageViews: number;
  ctaClicks: number;
  checkoutStarts: number;
  paidOrders: number;
  attributedRevenue: number;
  ctaRate: number | null;
  checkoutRate: number | null;
  paidRate: number | null;
}

export interface FunnelAnalyticsReport {
  dataMode: "TEST" | "LIVE";
  funnelId: string;
  generatedAt: string;
  filters: Omit<ReportFilters, "from" | "to"> & { from?: string; to?: string };
  uniqueStepEntries: number;
  pageViews: number;
  ctaClicks: number;
  checkoutStartsObserved: number;
  paidOrdersConfirmed: number;
  attributedRevenue: number;
  aov: number | null;
  unattributedPaidOrders: number;
  stepMetrics: StepMetrics[];
  definitions: Record<string, string>;
  attributionCaveat: string;
}

function money(value: number): number { return Number(value.toFixed(2)); }
function rate(numerator: number, denominator: number): number | null { return denominator > 0 ? money((numerator / denominator) * 100) : null; }
function uniqueVisitors(events: FunnelEvent[]): number { return new Set(events.map((event) => event.visitorId ?? `unknown:${event.eventKey}`)).size; }
function inRange(date: Date, filters: ReportFilters): boolean {
  return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
}
function eventMatches(event: FunnelEvent, filters: ReportFilters): boolean {
  const modeMatches = filters.dataMode === "LIVE" ? !event.isTest : event.isTest;
  return modeMatches && inRange(event.occurredAt, filters)
    && (!filters.stepId || event.stepId === filters.stepId)
    && (!filters.variantId || event.variantId === filters.variantId)
    && (!filters.source || event.source === filters.source)
    && (!filters.utmSource || event.utmSource === filters.utmSource)
    && (!filters.utmMedium || event.utmMedium === filters.utmMedium)
    && (!filters.utmCampaign || event.utmCampaign === filters.utmCampaign)
    && (!filters.deviceClass || event.deviceClass === filters.deviceClass);
}
function hasContextFilter(filters: ReportFilters): boolean {
  return Boolean(filters.stepId || filters.variantId || filters.source || filters.utmSource || filters.utmMedium || filters.utmCampaign || filters.deviceClass);
}

function serializeFilters(filters: ReportFilters): FunnelAnalyticsReport["filters"] {
  return {
    ...filters,
    from: filters.from?.toISOString(),
    to: filters.to?.toISOString(),
  };
}

export function buildFunnelReport(store: LocalStore, funnelId: string, requestedFilters: ReportFilters = {}): FunnelAnalyticsReport {
  const filters: ReportFilters = { dataMode: "TEST", ...requestedFilters };
  const events = store.values(store.events).filter((event) => event.funnelId === funnelId && eventMatches(event, filters));
  const funnel = store.funnels.get(funnelId);
  const allOrders = store.values(store.orderAttributions).filter((order) => {
    const modeMatches = filters.dataMode === "LIVE" ? !order.isTest : order.isTest;
    return modeMatches && order.funnelId === funnelId && inRange(order.paidAt, filters);
  });
  const matchingCheckoutTokens = new Set(events.filter((event) => event.name === "CART_CHECKOUT_STARTED" && event.checkoutToken).map((event) => event.checkoutToken!));
  const orders = hasContextFilter(filters)
    ? allOrders.filter((order) => !order.checkoutToken || matchingCheckoutTokens.has(order.checkoutToken))
    : allOrders;
  const unattributedOrders = store.values(store.orderAttributions).filter((order) => {
    const modeMatches = filters.dataMode === "LIVE" ? !order.isTest : order.isTest;
    return modeMatches && !order.funnelId && inRange(order.paidAt, filters);
  });
  const entries = events.filter((event) => event.name === "FUNNEL_STEP_ENTERED");
  const pageViews = events.filter((event) => event.name === "FUNNEL_PAGE_VIEWED");
  const ctas = events.filter((event) => event.name === "FUNNEL_CTA_CLICKED");
  const checkouts = events.filter((event) => event.name === "CART_CHECKOUT_STARTED");
  const attributedRevenue = money(orders.reduce((total, order) => total + order.netRevenueAmount, 0));
  const stepIds = new Set(events.map((event) => event.stepId).filter((id): id is string => Boolean(id)));
  const stepMetrics = [...stepIds].map((stepId) => {
    const stepEvents = events.filter((event) => event.stepId === stepId);
    const stepEntries = stepEvents.filter((event) => event.name === "FUNNEL_STEP_ENTERED");
    const stepCtas = stepEvents.filter((event) => event.name === "FUNNEL_CTA_CLICKED");
    const stepCheckouts = stepEvents.filter((event) => event.name === "CART_CHECKOUT_STARTED");
    const stepOrders = orders.filter((order) => order.variantId && stepEvents.some((event) => event.variantId === order.variantId));
    return {
      stepId,
      uniqueEntries: uniqueVisitors(stepEntries),
      pageViews: stepEvents.filter((event) => event.name === "FUNNEL_PAGE_VIEWED").length,
      ctaClicks: stepCtas.length,
      checkoutStarts: stepCheckouts.length,
      paidOrders: stepOrders.length,
      attributedRevenue: money(stepOrders.reduce((total, order) => total + order.netRevenueAmount, 0)),
      ctaRate: rate(stepCtas.length, uniqueVisitors(stepEntries)),
      checkoutRate: rate(stepCheckouts.length, uniqueVisitors(stepEntries)),
      paidRate: rate(stepOrders.length, uniqueVisitors(stepEntries)),
    } satisfies StepMetrics;
  });
  return {
    dataMode: filters.dataMode!,
    funnelId,
    generatedAt: new Date().toISOString(),
    filters: serializeFilters(filters),
    uniqueStepEntries: uniqueVisitors(entries),
    pageViews: pageViews.length,
    ctaClicks: ctas.length,
    checkoutStartsObserved: checkouts.length,
    paidOrdersConfirmed: orders.length,
    attributedRevenue,
    aov: orders.length ? money(attributedRevenue / orders.length) : null,
    unattributedPaidOrders: unattributedOrders.length,
    stepMetrics,
    definitions: {
      uniqueStepEntries: "Distinct pseudonymous visitors with a deduplicated step-entry event.",
      pageViews: "Deduplicated event records for funnel page views; consent and browser blocking can reduce coverage.",
      checkoutStartsObserved: "Observed checkout-start browser signal; not a paid order.",
      paidOrdersConfirmed: "Paid-order records accepted from the verified order source for the selected mode.",
      attributedRevenue: "Paid-order amount linked to this funnel through a known checkout token or funnel attribution.",
      aov: "Attributed revenue divided by confirmed attributed paid orders; blank with no paid orders.",
      conversionRates: "Percentages use unique step entries as the denominator; they are directional for small samples.",
    },
    attributionCaveat: funnel ? `Attribution for ${funnel.name} can be incomplete when consent blocks events, checkout context is absent, completion pages do not load, or a buyer changes device.` : "Attribution can be incomplete when checkout context is absent or browser tracking is blocked.",
  };
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reportToCsv(report: FunnelAnalyticsReport): string {
  const headers = ["data_mode", "funnel_id", "unique_step_entries", "page_views", "cta_clicks", "checkout_starts_observed", "paid_orders_confirmed", "attributed_revenue", "aov", "unattributed_paid_orders", "attribution_caveat"];
  const values = [report.dataMode, report.funnelId, report.uniqueStepEntries, report.pageViews, report.ctaClicks, report.checkoutStartsObserved, report.paidOrdersConfirmed, report.attributedRevenue, report.aov, report.unattributedPaidOrders, report.attributionCaveat];
  return `${headers.join(",")}\n${values.map(csvCell).join(",")}\n`;
}

export function reportToJson(report: FunnelAnalyticsReport): string { return `${JSON.stringify(report, null, 2)}\n`; }

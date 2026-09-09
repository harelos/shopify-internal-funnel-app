import flowDocument from "../content/flows.json";
import { lifecycleConfig } from "./config";
import { FLOW_SPECS } from "./flow-specs";
import type { LifecycleEnv, LifecycleFlow } from "./types";

const FLOW_ORDER: LifecycleFlow[] = [
  "abandoned_checkout",
  "welcome",
  "abandoned_cart",
  "browse_abandonment",
  "post_purchase",
  "replenishment",
];

const CONTENT_NAMES: Record<LifecycleFlow, string> = {
  abandoned_checkout: "ABANDONED CHECKOUT",
  welcome: "WELCOME",
  abandoned_cart: "ABANDONED CART",
  browse_abandonment: "BROWSE ABANDONMENT",
  post_purchase: "POST-PURCHASE",
  replenishment: "REPLENISHMENT / WINBACK",
};

const AUTOMATION_NAMES: Record<LifecycleFlow, string> = {
  abandoned_checkout: "NovaHair — Abandoned Checkout — D1 Correlated",
  welcome: "NovaHair — Welcome",
  abandoned_cart: "NovaHair — Abandoned Cart",
  browse_abandonment: "NovaHair — Browse Abandonment",
  post_purchase: "NovaHair — Post-Purchase",
  replenishment: "NovaHair — Replenishment / Winback",
};

interface ContentEmail {
  number: number;
  title: string;
  timing: string;
  subject: string;
  preview: string;
  cta: string;
  purpose: string | null;
  body: string[];
}

interface ContentFlow {
  name: string;
  planned: number;
  trigger: string;
  exit: string;
  kpi: string;
  emails: ContentEmail[];
}

interface ResourceRow {
  resource_type: string;
  name: string;
  external_id: string;
  status: string;
}

interface TrackingRow {
  flow: LifecycleFlow;
  email_number: number;
  scheduled: number;
  triggered: number;
}

interface DeliveryRow {
  template_alias: string;
  sent: number;
  delivered: number;
  opened: number;
  provider_clicked: number;
  failed: number;
  suppressed: number;
}

interface ClickRow {
  flow: LifecycleFlow;
  email_number: number;
  first_party_clicked: number;
}

interface ConversionRow {
  flow: LifecycleFlow;
  email_number: number;
  currency: string;
  orders: number;
  revenue: number;
}

interface OrderRow {
  currency: string;
  orders: number;
  revenue: number;
}

interface EmailMetrics {
  scheduled: number;
  triggered: number;
  sent: number;
  delivered: number;
  opened: number;
  providerClicked: number;
  firstPartyClicked: number;
  failed: number;
  suppressed: number;
  attributedOrders: number;
  attributedRevenueByCurrency: Record<string, number>;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  firstPartyClickRate: number;
  attributedOrderRate: number;
}

const contentFlows = (flowDocument as unknown as { flows: ContentFlow[] }).flows;

function rows<T>(result: { results?: T[] }): T[] {
  return result.results ?? [];
}

function metricKey(flow: string, emailNumber: number): string {
  return `${flow}:${emailNumber}`;
}

function templateAlias(flow: LifecycleFlow, emailNumber: number): string {
  return `novahair_${flow}_e${String(emailNumber).padStart(2, "0")}`;
}

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10_000) / 100;
}

function emptyMetrics(): EmailMetrics {
  return {
    scheduled: 0,
    triggered: 0,
    sent: 0,
    delivered: 0,
    opened: 0,
    providerClicked: 0,
    firstPartyClicked: 0,
    failed: 0,
    suppressed: 0,
    attributedOrders: 0,
    attributedRevenueByCurrency: {},
    deliveryRate: 0,
    openRate: 0,
    clickRate: 0,
    firstPartyClickRate: 0,
    attributedOrderRate: 0,
  };
}

function finalize(metrics: EmailMetrics): EmailMetrics {
  metrics.deliveryRate = percent(metrics.delivered, metrics.sent);
  metrics.openRate = percent(metrics.opened, metrics.delivered);
  metrics.clickRate = percent(metrics.providerClicked, metrics.delivered);
  metrics.firstPartyClickRate = percent(metrics.firstPartyClicked, metrics.delivered);
  metrics.attributedOrderRate = percent(metrics.attributedOrders, metrics.sent);
  return metrics;
}

function addRevenue(target: Record<string, number>, currency: string | null | undefined, value: number): void {
  const key = currency?.trim().toUpperCase() || "UNKNOWN";
  target[key] = Math.round(((target[key] ?? 0) + Number(value || 0)) * 100) / 100;
}

function addMetrics(target: EmailMetrics, source: EmailMetrics): void {
  target.scheduled += source.scheduled;
  target.triggered += source.triggered;
  target.sent += source.sent;
  target.delivered += source.delivered;
  target.opened += source.opened;
  target.providerClicked += source.providerClicked;
  target.firstPartyClicked += source.firstPartyClicked;
  target.failed += source.failed;
  target.suppressed += source.suppressed;
  target.attributedOrders += source.attributedOrders;
  for (const [currency, revenue] of Object.entries(source.attributedRevenueByCurrency)) {
    addRevenue(target.attributedRevenueByCurrency, currency, revenue);
  }
}

export function analyticsRange(url: URL, activatedAt: string, now = new Date()): { from: string; to: string } {
  const toDate = url.searchParams.get("to") ? new Date(String(url.searchParams.get("to"))) : now;
  const activation = new Date(activatedAt);
  const fallbackFrom = new Date(toDate.getTime() - 30 * 86_400_000);
  const fromDate = url.searchParams.get("from")
    ? new Date(String(url.searchParams.get("from")))
    : Number.isFinite(activation.getTime()) && activation > fallbackFrom ? activation : fallbackFrom;
  if (
    !Number.isFinite(fromDate.getTime())
    || !Number.isFinite(toDate.getTime())
    || fromDate >= toDate
    || toDate.getTime() - fromDate.getTime() > 366 * 86_400_000
  ) {
    throw new Error("analytics_invalid_range");
  }
  return { from: fromDate.toISOString(), to: toDate.toISOString() };
}

async function resources(env: LifecycleEnv): Promise<ResourceRow[]> {
  return rows(await env.DB.prepare(
    `SELECT resource_type, name, external_id, status
     FROM resend_resources
     WHERE resource_type IN ('AUTOMATION', 'TEMPLATE')`,
  ).all<ResourceRow>());
}

export async function lifecycleFlowCatalog(env: LifecycleEnv): Promise<Record<string, unknown>> {
  const resourceRows = await resources(env);
  const automationResources = new Map(
    resourceRows.filter(row => row.resource_type === "AUTOMATION").map(row => [row.name, row]),
  );
  const templateResources = new Map(
    resourceRows.filter(row => row.resource_type === "TEMPLATE").map(row => [row.name, row]),
  );
  const flows = FLOW_ORDER.map((flow) => {
    const content = contentFlows.find(item => item.name === CONTENT_NAMES[flow]);
    if (!content) throw new Error(`analytics_content_missing:${flow}`);
    const automation = automationResources.get(AUTOMATION_NAMES[flow]);
    return {
      flow,
      name: content.name,
      plannedEmails: content.planned,
      trigger: content.trigger,
      exit: content.exit,
      kpi: content.kpi,
      status: automation?.status?.toLowerCase() ?? "unknown",
      automationId: automation?.external_id ?? null,
      automationUrl: automation?.external_id
        ? `https://resend.com/automations/${automation.external_id}`
        : null,
      emails: content.emails.map((email) => {
        const alias = templateAlias(flow, email.number);
        const template = templateResources.get(alias);
        const schedule = FLOW_SPECS[flow].emails.find(item => item.number === email.number);
        return {
          number: email.number,
          title: email.title,
          timing: email.timing,
          offsetMinutes: schedule?.offsetMinutes ?? null,
          scheduleAnchor: schedule?.anchor ?? "trigger",
          subject: email.subject,
          preview: email.preview,
          cta: email.cta,
          purpose: email.purpose,
          body: email.body,
          templateAlias: alias,
          templateId: template?.external_id ?? null,
          templateStatus: template?.status?.toLowerCase() ?? "unknown",
          templateUrl: template?.external_id
            ? `https://resend.com/templates/${template.external_id}`
            : null,
        };
      }),
    };
  });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    sourceDocument: {
      title: "NovaHair — Shopify Messaging Email Flow Master Plan (2026)",
      documentId: "1RDo83MrjHkgIgX-xYKmYcYSXJHgo6tM4jfUD_GHSf0s",
    },
    totalFlows: flows.length,
    totalEmails: flows.reduce((sum, flow) => sum + flow.emails.length, 0),
    flows,
  };
}

export async function lifecycleAnalytics(
  env: LifecycleEnv,
  url: URL,
  now = new Date(),
): Promise<Record<string, unknown>> {
  const config = lifecycleConfig(env);
  const range = analyticsRange(url, config.activatedAt, now);
  const [catalog, trackingResult, deliveryResult, clickResult, conversionResult, orderResult] = await Promise.all([
    lifecycleFlowCatalog(env),
    env.DB.prepare(
      `SELECT flow, email_number,
              SUM(CASE WHEN scheduled_at >= ? AND scheduled_at < ? THEN 1 ELSE 0 END) AS scheduled,
              SUM(CASE WHEN triggered_at >= ? AND triggered_at < ? THEN 1 ELSE 0 END) AS triggered
       FROM automation_tracking
       WHERE (scheduled_at >= ? AND scheduled_at < ?) OR (triggered_at >= ? AND triggered_at < ?)
       GROUP BY flow, email_number`,
    ).bind(range.from, range.to, range.from, range.to, range.from, range.to, range.from, range.to).all<TrackingRow>(),
    env.DB.prepare(
      `SELECT r.name AS template_alias,
              COUNT(DISTINCT CASE WHEN e.event_type = 'email.sent' THEN e.resend_email_id END) AS sent,
              COUNT(DISTINCT CASE WHEN e.event_type = 'email.delivered' THEN e.resend_email_id END) AS delivered,
              COUNT(DISTINCT CASE WHEN e.event_type = 'email.opened' THEN e.resend_email_id END) AS opened,
              COUNT(DISTINCT CASE WHEN e.event_type = 'email.clicked' THEN e.resend_email_id END) AS provider_clicked,
              COUNT(DISTINCT CASE WHEN e.event_type IN ('email.failed', 'email.bounced') THEN e.resend_email_id END) AS failed,
              COUNT(DISTINCT CASE WHEN e.event_type IN ('email.complained', 'email.suppressed') THEN e.resend_email_id END) AS suppressed
       FROM email_delivery_events e
       JOIN resend_resources r
         ON r.resource_type = 'TEMPLATE' AND r.external_id = e.template_id
       WHERE e.occurred_at >= ? AND e.occurred_at < ? AND e.status = 'PROCESSED'
       GROUP BY r.name`,
    ).bind(range.from, range.to).all<DeliveryRow>(),
    env.DB.prepare(
      `SELECT flow, email_number, COUNT(DISTINCT attribution_key) AS first_party_clicked
       FROM lifecycle_attribution
       WHERE source = 'FIRST_PARTY_CLICK' AND clicked_at >= ? AND clicked_at < ?
       GROUP BY flow, email_number`,
    ).bind(range.from, range.to).all<ClickRow>(),
    env.DB.prepare(
      `WITH ranked AS (
         SELECT o.shopify_order_id, o.total, COALESCE(o.currency, 'UNKNOWN') AS currency,
                a.flow, a.email_number,
                ROW_NUMBER() OVER (
                  PARTITION BY o.shopify_order_id
                  ORDER BY CASE
                    WHEN a.shopify_checkout_id IS NOT NULL
                     AND a.shopify_checkout_id = o.shopify_checkout_id THEN 0 ELSE 1 END,
                    julianday(a.clicked_at) DESC
                ) AS rank
         FROM lifecycle_orders o
         JOIN lifecycle_attribution a
           ON (a.shopify_checkout_id IS NOT NULL AND a.shopify_checkout_id = o.shopify_checkout_id)
           OR (a.recipient_hash IS NOT NULL AND a.recipient_hash = o.email_hash)
         WHERE o.completed_at >= ? AND o.completed_at < ?
           AND a.clicked_at IS NOT NULL
           AND julianday(a.clicked_at) <= julianday(o.completed_at)
           AND julianday(a.clicked_at) >= julianday(o.completed_at) - 30
       )
       SELECT flow, email_number, currency, COUNT(*) AS orders,
              ROUND(SUM(COALESCE(total, 0)), 2) AS revenue
       FROM ranked WHERE rank = 1
       GROUP BY flow, email_number, currency`,
    ).bind(range.from, range.to).all<ConversionRow>(),
    env.DB.prepare(
      `SELECT COALESCE(currency, 'UNKNOWN') AS currency, COUNT(*) AS orders,
              ROUND(SUM(COALESCE(total, 0)), 2) AS revenue
       FROM lifecycle_orders
       WHERE completed_at >= ? AND completed_at < ?
       GROUP BY COALESCE(currency, 'UNKNOWN')`,
    ).bind(range.from, range.to).all<OrderRow>(),
  ]);

  const metrics = new Map<string, EmailMetrics>();
  const forMetric = (flow: LifecycleFlow, emailNumber: number): EmailMetrics => {
    const key = metricKey(flow, emailNumber);
    const value = metrics.get(key) ?? emptyMetrics();
    metrics.set(key, value);
    return value;
  };
  for (const row of rows(trackingResult)) {
    Object.assign(forMetric(row.flow, row.email_number), {
      scheduled: Number(row.scheduled ?? 0),
      triggered: Number(row.triggered ?? 0),
    });
  }
  for (const row of rows(deliveryResult)) {
    const match = row.template_alias.match(/^novahair_(abandoned_checkout|welcome|abandoned_cart|browse_abandonment|post_purchase|replenishment)_e(\d{2})$/);
    if (!match) continue;
    const metric = forMetric(match[1] as LifecycleFlow, Number(match[2]));
    metric.sent = Number(row.sent ?? 0);
    metric.delivered = Number(row.delivered ?? 0);
    metric.opened = Number(row.opened ?? 0);
    metric.providerClicked = Number(row.provider_clicked ?? 0);
    metric.failed = Number(row.failed ?? 0);
    metric.suppressed = Number(row.suppressed ?? 0);
  }
  for (const row of rows(clickResult)) {
    forMetric(row.flow, row.email_number).firstPartyClicked = Number(row.first_party_clicked ?? 0);
  }
  for (const row of rows(conversionResult)) {
    const metric = forMetric(row.flow, row.email_number);
    metric.attributedOrders += Number(row.orders ?? 0);
    addRevenue(metric.attributedRevenueByCurrency, row.currency, Number(row.revenue ?? 0));
  }

  const catalogFlows = catalog.flows as Array<Record<string, unknown>>;
  const flowResults = catalogFlows.map((flowEntry) => {
    const flow = flowEntry.flow as LifecycleFlow;
    const flowMetrics = emptyMetrics();
    const emails = (flowEntry.emails as Array<Record<string, unknown>>).map((email) => {
      const emailMetrics = finalize(forMetric(flow, Number(email.number)));
      addMetrics(flowMetrics, emailMetrics);
      return {
        number: email.number,
        title: email.title,
        subject: email.subject,
        timing: email.timing,
        templateId: email.templateId,
        templateUrl: email.templateUrl,
        metrics: emailMetrics,
      };
    });
    return {
      flow,
      name: flowEntry.name,
      status: flowEntry.status,
      automationId: flowEntry.automationId,
      automationUrl: flowEntry.automationUrl,
      metrics: finalize(flowMetrics),
      emails,
    };
  });

  const shopifyRevenueByCurrency: Record<string, number> = {};
  let shopifyOrders = 0;
  for (const row of rows(orderResult)) {
    shopifyOrders += Number(row.orders ?? 0);
    addRevenue(shopifyRevenueByCurrency, row.currency, Number(row.revenue ?? 0));
  }
  const attributedRevenueByCurrency: Record<string, number> = {};
  let attributedOrders = 0;
  for (const row of rows(conversionResult)) {
    attributedOrders += Number(row.orders ?? 0);
    addRevenue(attributedRevenueByCurrency, row.currency, Number(row.revenue ?? 0));
  }

  return {
    ok: true,
    generatedAt: now.toISOString(),
    period: { ...range, attributionWindowDays: 30 },
    totals: {
      shopifyOrders,
      shopifyRevenueByCurrency,
      firstPartyAttributedOrders: attributedOrders,
      firstPartyAttributedRevenueByCurrency: attributedRevenueByCurrency,
      unattributedShopifyOrders: Math.max(0, shopifyOrders - attributedOrders),
    },
    flows: flowResults,
    attribution: {
      shopifyRevenueTruth: true,
      firstPartyModel: "last_click_30_days_exact_checkout_preferred",
      resendAttributedRevenue: { available: false, reason: "Resend does not expose a supported per-flow revenue feed to this Worker." },
      incrementalRevenueClaimed: false,
    },
    privacy: {
      customerEmailReturned: false,
      customerNameReturned: false,
      recoveryUrlReturned: false,
      customerEntityIdentifiersReturned: false,
      resendResourceIdentifiersReturned: true,
    },
  };
}

export type CommerceTrafficStatus = "QUALIFIED" | "EXCLUDED" | "UNKNOWN";

export type CommerceTrafficReason =
  | "TARGET_GEO_COMMERCIAL"
  | "INTERNAL_OR_TEST"
  | "AUTOMATION_NOISE"
  | "NON_TARGET_GEO"
  | "SUPPORT_ENTRY"
  | "ORDER_TRACKING_ENTRY"
  | "UNSUBSCRIBE_ENTRY"
  | "POLICY_ENTRY"
  | "CART_OR_CHECKOUT_ENTRY"
  | "MISSING_GEO"
  | "MISSING_LANDING_CONTEXT"
  | "NON_COMMERCIAL_ENTRY";

export interface CommerceEventInput {
  id: string;
  name: string;
  source?: string | null;
  occurredAt: Date | string;
  visitorId?: string | null;
  funnelId?: string | null;
  stepId?: string | null;
  variantId?: string | null;
  checkoutToken?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  deviceClass?: string | null;
  isTest?: boolean;
  payload?: Record<string, unknown> | string | null;
}

export interface CommerceCheckoutInput {
  checkoutToken: string;
  visitorId?: string | null;
  startedAt: Date | string;
  completedAt?: Date | string | null;
}

export interface CommerceOrderInput {
  id: string;
  checkoutToken?: string | null;
  paidAt: Date | string;
  netRevenueAmount: number;
  status?: string | null;
}

export interface CommerceQualificationPolicy {
  targetCountries: string[];
  internalCountries?: string[];
  sessionTimeoutMinutes?: number;
}

export interface CommerceSession {
  sessionKey: string;
  visitorId: string | null;
  startedAt: Date;
  endedAt: Date;
  eventIds: string[];
  eventNames: string[];
  checkoutTokens: string[];
  funnelIds: string[];
  landingPath: string | null;
  referrer: string | null;
  countryCode: string | null;
  userAgent: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  deviceClass: string | null;
  source: string | null;
  isTest: boolean;
  hasCheckout: boolean;
  checkoutCompleted: boolean;
  purchaseCount: number;
  revenue: number;
  qualification: {
    status: CommerceTrafficStatus;
    reason: CommerceTrafficReason;
  };
}

export interface QualifiedCommerceSummary {
  sessions: CommerceSession[];
  metrics: {
    allSessions: number;
    qualifiedSessions: number;
    excludedSessions: number;
    unknownSessions: number;
    classificationCoveragePct: number;
    qualifiedCheckoutSessions: number;
    qualifiedPurchaseSessions: number;
    qualifiedOrders: number;
    qualifiedRevenue: number;
    landingToCheckoutPct: number | null;
    checkoutToPurchasePct: number | null;
    landingToPurchasePct: number | null;
    revenuePerQualifiedSession: number | null;
    unattributedOrders: number;
    unattributedRevenue: number;
  };
  reasons: Array<{ reason: CommerceTrafficReason; status: CommerceTrafficStatus; sessions: number }>;
}

const SUPPORT_PATTERNS = [
  /^\/contact\/?$/i,
  /^\/pages\/contact(?:-us)?\/?$/i,
  /^\/pages\/customer-service\/?$/i,
  /^\/pages\/support\/?$/i,
];

const TRACKING_PATTERNS = [
  /order[-_/ ]?status/i,
  /order[-_/ ]?tracking/i,
  /track[-_/ ]?order/i,
  /^\/account\/orders(?:\/|$)/i,
  /^\/orders(?:\/|$)/i,
  /parcelpanel/i,
  /trackingmore/i,
];

const UNSUBSCRIBE_PATTERNS = [/unsubscribe/i, /email[-_/ ]?preferences/i];
const POLICY_PATTERNS = [/^\/policies(?:\/|$)/i, /^\/pages\/(?:privacy|terms|refund|returns|shipping-policy)(?:\/|$)/i];
const CART_CHECKOUT_PATTERNS = [/^\/cart(?:\/|$)/i, /^\/checkout(?:\/|$)/i, /^\/checkouts(?:\/|$)/i];
const COMMERCIAL_PATTERNS = [/^\/$/, /^\/products(?:\/|$)/i, /^\/collections(?:\/|$)/i, /^\/f(?:\/|$)/i, /^\/pages\/(?:sales|offer|advertorial|7-reasons|seven-reasons)(?:\/|$)/i];
const BOT_UA = /(bot|crawler|spider|slurp|headless|lighthouse|pagespeed|facebookexternalhit|preview|pingdom|uptimerobot)/i;

function objectPayload(value: CommerceEventInput["payload"]): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function nested(record: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>)[key] : undefined, record);
}

function firstText(record: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const value = nested(record, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeCountry(value: string | null): string | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  if (["IL", "ISR", "ISRAEL", "ישראל"].includes(upper)) return "IL";
  if (["PY", "PRY", "PARAGUAY"].includes(upper)) return "PY";
  if (upper.length === 2) return upper;
  if (upper.length === 3) return upper;
  return upper.slice(0, 64);
}

function normalizePath(value: string | null): string | null {
  if (!value) return null;
  try {
    if (/^https?:\/\//i.test(value)) return new URL(value).pathname || "/";
  } catch {}
  const clean = value.split(/[?#]/, 1)[0].trim();
  if (!clean) return null;
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function eventSessionId(event: CommerceEventInput): string | null {
  const payload = objectPayload(event.payload);
  return firstText(payload, ["sessionId", "session_id", "session.id"]);
}

function eventLandingPath(event: CommerceEventInput): string | null {
  const payload = objectPayload(event.payload);
  return normalizePath(firstText(payload, ["landingPath", "landing_path", "landingPage", "landing_page", "pagePath", "page_path", "path", "url", "page.url"]));
}

function eventReferrer(event: CommerceEventInput): string | null {
  const payload = objectPayload(event.payload);
  return firstText(payload, ["referrer", "documentReferrer", "document_referrer", "page.referrer"]);
}

function eventCountry(event: CommerceEventInput): string | null {
  const payload = objectPayload(event.payload);
  return normalizeCountry(firstText(payload, ["countryCode", "country_code", "country", "geoCountry", "geo.country", "client.country", "client_country", "context.countryCode"]));
}

function eventUserAgent(event: CommerceEventInput): string | null {
  const payload = objectPayload(event.payload);
  return firstText(payload, ["userAgent", "user_agent", "browser.userAgent", "client.userAgent"]);
}

function pathMatches(path: string | null, patterns: RegExp[]): boolean {
  return Boolean(path && patterns.some(pattern => pattern.test(path)));
}

function classifySession(session: Omit<CommerceSession, "qualification">, policy: CommerceQualificationPolicy): CommerceSession["qualification"] {
  const source = (session.source || "").toUpperCase();
  if (session.isTest || ["SYNTHETIC", "BOT_SIMULATOR", "PREVIEW"].includes(source)) {
    return { status: "EXCLUDED", reason: "INTERNAL_OR_TEST" };
  }
  if (session.userAgent && BOT_UA.test(session.userAgent)) {
    return { status: "EXCLUDED", reason: "AUTOMATION_NOISE" };
  }
  if (pathMatches(session.landingPath, SUPPORT_PATTERNS)) return { status: "EXCLUDED", reason: "SUPPORT_ENTRY" };
  if (pathMatches(session.landingPath, TRACKING_PATTERNS)) return { status: "EXCLUDED", reason: "ORDER_TRACKING_ENTRY" };
  if (pathMatches(session.landingPath, UNSUBSCRIBE_PATTERNS)) return { status: "EXCLUDED", reason: "UNSUBSCRIBE_ENTRY" };
  if (pathMatches(session.landingPath, POLICY_PATTERNS)) return { status: "EXCLUDED", reason: "POLICY_ENTRY" };
  if (pathMatches(session.landingPath, CART_CHECKOUT_PATTERNS)) return { status: "EXCLUDED", reason: "CART_OR_CHECKOUT_ENTRY" };

  const targetCountries = new Set(policy.targetCountries.map(value => normalizeCountry(value)).filter(Boolean));
  const internalCountries = new Set((policy.internalCountries || []).map(value => normalizeCountry(value)).filter(Boolean));
  if (session.countryCode && internalCountries.has(session.countryCode)) return { status: "EXCLUDED", reason: "INTERNAL_OR_TEST" };
  if (session.countryCode && targetCountries.size > 0 && !targetCountries.has(session.countryCode)) return { status: "EXCLUDED", reason: "NON_TARGET_GEO" };

  const commercial = pathMatches(session.landingPath, COMMERCIAL_PATTERNS);
  if (!session.landingPath) return { status: "UNKNOWN", reason: "MISSING_LANDING_CONTEXT" };
  if (!commercial) return { status: "EXCLUDED", reason: "NON_COMMERCIAL_ENTRY" };
  if (!session.countryCode && targetCountries.size > 0) return { status: "UNKNOWN", reason: "MISSING_GEO" };
  return { status: "QUALIFIED", reason: "TARGET_GEO_COMMERCIAL" };
}

function byTime<T extends { occurredAt: Date | string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

function makeSessionKey(event: CommerceEventInput, visitorKey: string, index: number): string {
  const explicit = eventSessionId(event);
  return explicit ? `sid:${explicit}` : `${visitorKey}:${index}`;
}

export function reconstructCommerceSessions(
  events: CommerceEventInput[],
  checkouts: CommerceCheckoutInput[],
  orders: CommerceOrderInput[],
  policy: CommerceQualificationPolicy,
): { sessions: CommerceSession[]; unattributedOrders: CommerceOrderInput[] } {
  const timeoutMs = Math.max(1, policy.sessionTimeoutMinutes ?? 30) * 60_000;
  const groups = new Map<string, CommerceEventInput[]>();

  for (const event of events) {
    const explicit = eventSessionId(event);
    if (explicit) {
      const key = `sid:${explicit}`;
      const list = groups.get(key) || [];
      list.push(event);
      groups.set(key, list);
      continue;
    }
    const visitorKey = event.visitorId ? `visitor:${event.visitorId}` : event.checkoutToken ? `checkout:${event.checkoutToken}` : `event:${event.id}`;
    const list = groups.get(visitorKey) || [];
    list.push(event);
    groups.set(visitorKey, list);
  }

  const sessionBuckets: Array<{ key: string; events: CommerceEventInput[] }> = [];
  for (const [groupKey, rawEvents] of groups.entries()) {
    if (groupKey.startsWith("sid:")) {
      sessionBuckets.push({ key: groupKey, events: byTime(rawEvents) });
      continue;
    }
    const sorted = byTime(rawEvents);
    let bucket: CommerceEventInput[] = [];
    let previousAt = 0;
    let index = 0;
    for (const event of sorted) {
      const at = new Date(event.occurredAt).getTime();
      if (bucket.length && at - previousAt > timeoutMs) {
        sessionBuckets.push({ key: makeSessionKey(bucket[0], groupKey, index++), events: bucket });
        bucket = [];
      }
      bucket.push(event);
      previousAt = at;
    }
    if (bucket.length) sessionBuckets.push({ key: makeSessionKey(bucket[0], groupKey, index), events: bucket });
  }

  const checkoutByToken = new Map(checkouts.map(checkout => [checkout.checkoutToken, checkout]));
  const orderByToken = new Map<string, CommerceOrderInput[]>();
  for (const order of orders) {
    if (!order.checkoutToken) continue;
    const list = orderByToken.get(order.checkoutToken) || [];
    list.push(order);
    orderByToken.set(order.checkoutToken, list);
  }
  const attributedOrderIds = new Set<string>();

  const sessions = sessionBuckets.map(bucket => {
    const sorted = byTime(bucket.events);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const checkoutTokens = [...new Set(sorted.map(event => event.checkoutToken).filter((value): value is string => Boolean(value)))];
    const checkoutRecords = checkoutTokens.map(token => checkoutByToken.get(token)).filter((value): value is CommerceCheckoutInput => Boolean(value));
    const matchedOrders = checkoutTokens.flatMap(token => orderByToken.get(token) || []);
    matchedOrders.forEach(order => attributedOrderIds.add(order.id));

    const payloads = sorted.map(event => objectPayload(event.payload));
    const firstPayloadText = (paths: string[]) => {
      for (const payload of payloads) {
        const value = firstText(payload, paths);
        if (value) return value;
      }
      return null;
    };
    const landingPath = sorted.map(eventLandingPath).find(Boolean) || null;
    const countryCode = sorted.map(eventCountry).find(Boolean) || null;
    const userAgent = sorted.map(eventUserAgent).find(Boolean) || null;
    const utmSource = sorted.map(event => event.utmSource).find(Boolean) || firstPayloadText(["utm_source", "utmSource"]);
    const utmMedium = sorted.map(event => event.utmMedium).find(Boolean) || firstPayloadText(["utm_medium", "utmMedium"]);
    const utmCampaign = sorted.map(event => event.utmCampaign).find(Boolean) || firstPayloadText(["utm_campaign", "utmCampaign"]);
    const referrer = sorted.map(eventReferrer).find(Boolean) || null;
    const base: Omit<CommerceSession, "qualification"> = {
      sessionKey: bucket.key,
      visitorId: first.visitorId || null,
      startedAt: new Date(first.occurredAt),
      endedAt: new Date(last.occurredAt),
      eventIds: sorted.map(event => event.id),
      eventNames: sorted.map(event => event.name),
      checkoutTokens,
      funnelIds: [...new Set(sorted.map(event => event.funnelId).filter((value): value is string => Boolean(value)))],
      landingPath,
      referrer,
      countryCode,
      userAgent,
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      deviceClass: sorted.map(event => event.deviceClass).find(Boolean) || firstPayloadText(["deviceClass", "device_class"]) || null,
      source: sorted.map(event => event.source).find(Boolean) || null,
      isTest: sorted.some(event => Boolean(event.isTest)),
      hasCheckout: sorted.some(event => ["checkout_started", "CHECKOUT_STARTED", "CART_CHECKOUT_STARTED"].includes(event.name)) || checkoutRecords.length > 0,
      checkoutCompleted: sorted.some(event => ["checkout_completed", "CHECKOUT_COMPLETED", "CHECKOUT_COMPLETED_OBSERVED"].includes(event.name)) || checkoutRecords.some(checkout => Boolean(checkout.completedAt)),
      purchaseCount: matchedOrders.length,
      revenue: Number(matchedOrders.reduce((sum, order) => sum + Number(order.netRevenueAmount || 0), 0).toFixed(2)),
    };
    return { ...base, qualification: classifySession(base, policy) };
  }).sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  return { sessions, unattributedOrders: orders.filter(order => !attributedOrderIds.has(order.id)) };
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function buildQualifiedCommerceSummary(
  events: CommerceEventInput[],
  checkouts: CommerceCheckoutInput[],
  orders: CommerceOrderInput[],
  policy: CommerceQualificationPolicy,
): QualifiedCommerceSummary {
  const reconstructed = reconstructCommerceSessions(events, checkouts, orders, policy);
  const sessions = reconstructed.sessions;
  const qualified = sessions.filter(session => session.qualification.status === "QUALIFIED");
  const excluded = sessions.filter(session => session.qualification.status === "EXCLUDED");
  const unknown = sessions.filter(session => session.qualification.status === "UNKNOWN");
  const qualifiedCheckout = qualified.filter(session => session.hasCheckout);
  const qualifiedPurchase = qualified.filter(session => session.purchaseCount > 0);
  const qualifiedOrders = qualified.reduce((sum, session) => sum + session.purchaseCount, 0);
  const qualifiedRevenue = Number(qualified.reduce((sum, session) => sum + session.revenue, 0).toFixed(2));
  const unattributedRevenue = Number(reconstructed.unattributedOrders.reduce((sum, order) => sum + Number(order.netRevenueAmount || 0), 0).toFixed(2));
  const reasonMap = new Map<string, { reason: CommerceTrafficReason; status: CommerceTrafficStatus; sessions: number }>();
  for (const session of sessions) {
    const key = `${session.qualification.status}:${session.qualification.reason}`;
    const row = reasonMap.get(key) || { ...session.qualification, sessions: 0 };
    row.sessions += 1;
    reasonMap.set(key, row);
  }

  return {
    sessions,
    metrics: {
      allSessions: sessions.length,
      qualifiedSessions: qualified.length,
      excludedSessions: excluded.length,
      unknownSessions: unknown.length,
      classificationCoveragePct: sessions.length ? Number((((qualified.length + excluded.length) / sessions.length) * 100).toFixed(2)) : 0,
      qualifiedCheckoutSessions: qualifiedCheckout.length,
      qualifiedPurchaseSessions: qualifiedPurchase.length,
      qualifiedOrders,
      qualifiedRevenue,
      landingToCheckoutPct: pct(qualifiedCheckout.length, qualified.length),
      checkoutToPurchasePct: pct(qualifiedPurchase.length, qualifiedCheckout.length),
      landingToPurchasePct: pct(qualifiedPurchase.length, qualified.length),
      revenuePerQualifiedSession: qualified.length ? Number((qualifiedRevenue / qualified.length).toFixed(2)) : null,
      unattributedOrders: reconstructed.unattributedOrders.length,
      unattributedRevenue,
    },
    reasons: [...reasonMap.values()].sort((a, b) => b.sessions - a.sessions),
  };
}

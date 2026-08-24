import { analyticsModeForRequest, isTestForMode } from "./analytics-config.js";

export const POPUP_VERSION = "novahair_popup_v1";
export const POPUP_EVENTS = [
  "popup_eligible",
  "popup_view",
  "popup_email_started",
  "popup_consent_checked",
  "popup_submit_attempt",
  "popup_submit_success",
  "popup_submit_failed",
  "popup_coupon_revealed",
  "popup_continue_clicked",
  "popup_closed",
  "popup_purchase",
] as const;

export type PopupEventName = typeof POPUP_EVENTS[number];

const STOREFRONT_EVENTS = new Set<PopupEventName>([
  "popup_eligible",
  "popup_view",
  "popup_email_started",
  "popup_consent_checked",
  "popup_submit_attempt",
  "popup_submit_failed",
  "popup_coupon_revealed",
  "popup_continue_clicked",
  "popup_closed",
]);
const DEVICES = new Set(["mobile", "desktop", "tablet", "other"]);
const CLOSE_METHODS = new Set(["x", "backdrop", "esc", "other"]);
const SAFE_PAYLOAD_KEYS = new Set([
  "popupId", "popupVersion", "sessionId", "path", "template", "device",
  "trigger", "consent", "attemptId", "attemptNumber", "closeMethod",
  "failureCategory", "couponConfigured", "confirmationSource", "customerKey",
]);

export interface PopupEventInput {
  event: PopupEventName;
  visitorId?: string;
  eventKey: string;
  occurredAt: Date;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  device?: string;
  payload: Record<string, string | number | boolean>;
}

export function isPopupEvent(value: unknown): value is PopupEventName {
  return typeof value === "string" && (POPUP_EVENTS as readonly string[]).includes(value);
}

function safeString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function safeIdentifier(value: unknown, max = 180): string | undefined {
  const cleaned = safeString(value, max);
  return cleaned && /^[a-zA-Z0-9_.:/-]+$/.test(cleaned) ? cleaned : undefined;
}

function safeOccurredAt(value: unknown): Date {
  const parsed = typeof value === "string" ? new Date(value) : new Date();
  const drift = Math.abs(Date.now() - parsed.getTime());
  return Number.isFinite(parsed.getTime()) && drift <= 24 * 60 * 60 * 1000 ? parsed : new Date();
}

function safePayload(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) continue;
    if (typeof raw === "boolean") result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "string") result[key] = raw.slice(0, key === "path" ? 500 : 180);
  }
  return result;
}

export function normalizePopupEventInput(body: unknown, allowServerEvents = false): PopupEventInput | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "A JSON event object is required." };
  const input = body as Record<string, unknown>;
  if (!isPopupEvent(input.event)) return { error: "Unsupported popup event." };
  if (!allowServerEvents && !STOREFRONT_EVENTS.has(input.event)) return { error: "This event requires server confirmation." };

  const payload = safePayload(input.payload);
  const popupVersion = safeIdentifier(payload.popupVersion ?? input.popupVersion, 80) ?? POPUP_VERSION;
  const sessionId = safeIdentifier(payload.sessionId, 160);
  const visitorId = safeIdentifier(input.visitorId, 160);
  const eventKey = safeIdentifier(input.explicitEventKey, 240);
  if (!sessionId || !visitorId || !eventKey) return { error: "visitorId, sessionId, and explicitEventKey are required." };
  if (!eventKey.startsWith(`${input.event}:${popupVersion}:`)) return { error: "Event key does not match the event and popup version." };

  const device = safeString(payload.device ?? input.deviceClass, 20);
  if (device && !DEVICES.has(device)) payload.device = "other";
  if (input.event === "popup_closed") {
    const method = safeString(payload.closeMethod, 20);
    payload.closeMethod = method && CLOSE_METHODS.has(method) ? method : "other";
  }
  payload.popupVersion = popupVersion;
  payload.sessionId = sessionId;

  return {
    event: input.event,
    visitorId,
    eventKey,
    occurredAt: safeOccurredAt(input.occurredAt),
    utmSource: safeString(input.utm_source, 120),
    utmMedium: safeString(input.utm_medium, 120),
    utmCampaign: safeString(input.utm_campaign, 180),
    device: safeString(payload.device, 20),
    payload,
  };
}

export async function persistPopupEvent(input: PopupEventInput, query: Record<string, unknown>, source = "STOREFRONT") {
  const [{ default: prisma }, { getShopifyConfig }] = await Promise.all([
    import("./db.js"), import("./shopify-config.js"),
  ]);
  const mode = analyticsModeForRequest(query);
  const shop = await prisma.shop.findUnique({ where: { domain: getShopifyConfig().shopDomain } });
  if (!shop) throw new Error("No shop record configured.");
  const visitor = input.visitorId
    ? await prisma.visitor.upsert({
      where: { shopId_anonymousKeyHash: { shopId: shop.id, anonymousKeyHash: input.visitorId } },
      update: {},
      create: { shopId: shop.id, anonymousKeyHash: input.visitorId },
    })
    : null;
  const existing = await prisma.event.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) return { event: existing, duplicate: true, mode };
  const event = await prisma.event.create({
    data: {
      shopId: shop.id,
      eventKey: input.eventKey,
      name: input.event,
      source,
      occurredAt: input.occurredAt,
      visitorId: visitor?.id ?? null,
      utmSource: input.utmSource ?? null,
      utmMedium: input.utmMedium ?? null,
      utmCampaign: input.utmCampaign ?? null,
      deviceClass: input.device ?? null,
      payload: JSON.stringify(input.payload),
      isTest: isTestForMode(mode),
    },
  });
  return { event, duplicate: false, mode };
}

export function parsePayload(payload: string): Record<string, unknown> {
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

import { analyticsModeForRequest, isTestForMode } from "./analytics-config.js";

export const POPUP_VERSION = "novahair_popup_v1";
export const POPUP_EVENTS = [
  "popup_signal",
  "popup_suppressed",
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
  "popup_result_email_sent",
  // A browser CTA is not proof that its cart marker survived. This event is
  // emitted only after Shopify's cart response is inspected.
  "popup_cart_attribution",
  // AI concierge: one row per conversation step, so every step of the flow
  // can be read back and improved independently.
  "popup_ai_step",
] as const;

export type PopupEventName = typeof POPUP_EVENTS[number];

const STOREFRONT_EVENTS = new Set<PopupEventName>([
  "popup_signal",
  "popup_suppressed",
  "popup_eligible",
  "popup_view",
  "popup_email_started",
  "popup_consent_checked",
  "popup_submit_attempt",
  "popup_submit_failed",
  "popup_coupon_revealed",
  "popup_continue_clicked",
  "popup_closed",
  "popup_ai_step",
  "popup_cart_attribution",
]);
const DEVICES = new Set(["mobile", "desktop", "tablet", "other"]);
const CLOSE_METHODS = new Set(["x", "backdrop", "esc", "other"]);
const SAFE_PAYLOAD_KEYS = new Set([
  "popupId", "popupVersion", "sessionId", "path", "template", "device",
  "trigger", "consent", "attemptId", "attemptNumber", "closeMethod",
  "failureCategory", "couponConfigured", "confirmationSource", "customerKey",
  // Behavioural engine v2. `reason` is the auditable decision string
  // (e.g. "return_to_top+depth67+returnToTop+52s+e7/a6") that lets us judge
  // months later which triggers produced leads and which only annoyed people.
  "reason", "engagementScore", "abandonScore", "intentScore",
  "scrollDepth", "engagedSeconds", "visitNumber", "pageVariant",
  "currentScrollDepth", "scrollVelocity", "timeOnPage", "qualified",
  "failedGates", "blockedBy", "evaluationSource", "experimentId", "experimentVariant",
  "experimentBucket", "holdoutPercent",
  // AI concierge step telemetry. `freeText` is shopper-typed and is the only
  // free-form field here, so it is length-capped and must never be used to
  // key anything; treat it as content to read, not as an identifier.
  "conversationId", "stepId", "stepIndex", "stepType", "action",
  "choiceId", "choiceLabel", "freeText", "dwellMs", "angle", "tags",
  "shadeKey", "shadeMethod", "shadeConfidence",
  // Coarse writing-style key (e.g. "terse/casual/skep") used to compare how
  // different registers move through the flow. Style only, never identity.
  "tone",
  // Which agent lane served the conversation (sales/retention/vip/service)
  // and where the widget was placed. Lets analytics compare lanes.
  "agent", "placement",
  "emailKind",
  // Cart attribution proof. These values are pseudonymous and allow a later
  // checkout observation to be reconciled without copying customer data.
  "cartToken", "cartMarkerVerified", "cartWriteReason",
  // Full marketing attribution carried on every event. utm_source/medium/
  // campaign already have dedicated Event columns; these are the rest, so a
  // step can be sliced by ad content, keyword, or click id, and matched to the
  // Shopify order that inherits the same values from cart attributes.
  "utm_content", "utm_term", "gclid", "fbclid", "landingPath", "referrerHost",
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

function redactFreeText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?:\+?972[-\s]?|0)(?:5\d|[23489])[-\s]?\d{3}[-\s]?\d{4}\b/g, "[phone]")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

function safePayload(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!SAFE_PAYLOAD_KEYS.has(key)) continue;
    if (typeof raw === "boolean") result[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
    else if (typeof raw === "string") {
      // freeText is a whole sentence a shopper typed; 180 chars would cut the
      // objection in half and make the step unreadable in analysis.
      const limit = key === "path" ? 500 : key === "freeText" ? 400 : 180;
      result[key] = key === "freeText" ? redactFreeText(raw) : raw.slice(0, limit);
    }
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
  const [{ default: prisma }, { getShopifyConfig }, { findOrCreateVisitor }, { createEventOnce }] = await Promise.all([
    import("./db.js"), import("./shopify-config.js"), import("./visitor-store.js"), import("./event-store.js"),
  ]);
  const mode = analyticsModeForRequest(query);
  const qaAttribution = [input.utmSource, input.utmMedium, input.utmCampaign, input.payload.trigger, input.payload.path, input.payload.template]
    .filter(Boolean)
    .map(value => String(value).toLowerCase());
  const isKnownQaEvent = qaAttribution.some(value => value === "codex_qa"
    || value === "production_test"
    || value.includes("concierge_email_release_")
    || value.includes("production_qa")
    || value.includes("popup-qa"));
  const shop = await prisma.shop.findUnique({ where: { domain: getShopifyConfig().shopDomain } });
  if (!shop) throw new Error("No shop record configured.");
  const visitor = input.visitorId
    ? await findOrCreateVisitor(shop.id, input.visitorId)
    : null;
  const result = await createEventOnce(input.eventKey, {
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
      isTest: isTestForMode(mode) || isKnownQaEvent,
  });
  return { event: result.event, duplicate: result.duplicate, mode };
}

export function parsePayload(payload: string): Record<string, unknown> {
  try {
    const value = JSON.parse(payload);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export type PopupExperience = "exit" | "concierge";

export function popupExperienceForVersion(value: unknown): PopupExperience {
  return String(value || "").toLowerCase().includes("_ai_") ? "concierge" : "exit";
}

export function popupSessionKey(event: {
  id?: unknown;
  visitorId?: unknown;
  payload?: unknown;
}): string {
  const payload = typeof event.payload === "string" ? parsePayload(event.payload) : {};
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId.trim() : "";
  if (sessionId) return `session:${sessionId}`;
  const visitorId = typeof event.visitorId === "string" ? event.visitorId.trim() : "";
  if (visitorId) return `visitor:${visitorId}`;
  return `event:${String(event.id || "unknown")}`;
}

export function uniquePopupSessionCount<T extends {
  id?: unknown;
  visitorId?: unknown;
  name?: unknown;
  payload?: unknown;
}>(events: T[], name?: string): number {
  return new Set(events
    .filter(event => !name || event.name === name)
    .map(popupSessionKey)).size;
}

export function percentage(numerator: number, denominator: number): number {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

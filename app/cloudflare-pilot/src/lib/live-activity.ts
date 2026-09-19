/**
 * The live funnel feed: what people on the sales page are doing right now.
 *
 * The storefront beacon sends small batches of actions; this file turns them
 * into rows the admin page can show and folds a session's rows into one card.
 * PostHog is minutes behind, so the page reports straight to the Worker instead.
 */

export const LIVE_KINDS = new Set([
  "view", "section", "bundle", "shade", "compare", "mix", "module", "module_action",
  "cart_add", "cart_open", "cart_close", "cart_change", "checkout_click", "click", "popup", "leave",
  "faq", "gallery", "reviews", "concierge", "signal",
]);

/* Thirty days, so a journey can be read back for any order in the month, and so
 * a test's per-visitor rows and the feed tell the same story. About three
 * thousand rows a day at today's traffic. */
export const LIVE_RETENTION_HOURS = 24 * 30;
export const MAX_BATCH = 30;

export interface BeaconEvent {
  kind: string;
  label: string;
  detail: Record<string, string | number | boolean | null>;
  at: number;
}

export interface BeaconBatch {
  sessionKey: string;
  visitorKey: string;
  page: string;
  device: string;
  source: string;
  variant: string | null;
  /** Assignments for other tests the page reports alongside its own variant, keyed by experiment. */
  experiments: Record<string, string>;
  isInternal: boolean;
  events: BeaconEvent[];
}

export interface LiveRow {
  id: string;
  sessionKey: string;
  visitorKey: string;
  occurredAt: string;
  receivedAt: string;
  kind: string;
  label: string;
  page: string;
  detail: string;
  device: string;
  source: string;
  variant: string | null;
  isInternal: number;
}

export interface LiveSession {
  sessionKey: string;
  visitorKey: string;
  device: string;
  source: string;
  variant: string | null;
  page: string;
  isInternal: boolean;
  firstSeen: string;
  lastSeen: string;
  lastLabel: string;
  active: boolean;
  events: number;
  reached: { bundle: string | null; shade: string | null; cart: boolean; checkout: boolean; paid: boolean };
  modules: string[];
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

const KEY = /^[A-Za-z0-9_-]{8,120}$/;

/** `{ experimentKey: variant }` pairs, shape-checked here and allow-listed by the route. */
function experimentsFrom(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  for (const [rawKey, rawVariant] of Object.entries(value as Record<string, unknown>).slice(0, 8)) {
    const key = text(rawKey, 60);
    const variant = text(rawVariant, 40);
    if (/^[a-z0-9_]{3,60}$/i.test(key) && /^[a-z0-9_]{1,40}$/i.test(variant)) out[key] = variant;
  }
  return out;
}

/** Validates one beacon post. Throws on anything that is not the shape the page sends. */
export function normalizeBeaconBatch(body: unknown, now = Date.now()): BeaconBatch {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const sessionKey = text(input.sessionKey, 120);
  const visitorKey = text(input.visitorKey, 120);
  if (!KEY.test(sessionKey)) throw new Error("A session key is required.");
  if (!KEY.test(visitorKey)) throw new Error("A visitor key is required.");
  const page = text(input.page, 160) || "/";
  if (!page.startsWith("/")) throw new Error("Page must be a path.");
  const rawEvents = Array.isArray(input.events) ? input.events.slice(0, MAX_BATCH) : [];
  const events: BeaconEvent[] = [];
  for (const raw of rawEvents) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const kind = text(item.kind, 24);
    if (!LIVE_KINDS.has(kind)) continue;
    const at = Number(item.at);
    const detailInput = (item.detail && typeof item.detail === "object" ? item.detail : {}) as Record<string, unknown>;
    const detail: BeaconEvent["detail"] = {};
    for (const [key, value] of Object.entries(detailInput).slice(0, 12)) {
      const safeKey = text(key, 32);
      if (!safeKey) continue;
      if (typeof value === "number" && Number.isFinite(value)) detail[safeKey] = value;
      else if (typeof value === "boolean") detail[safeKey] = value;
      else if (value === null) detail[safeKey] = null;
      else detail[safeKey] = text(value, 160);
    }
    events.push({
      kind,
      label: text(item.label, 120),
      detail,
      // the page's clock is not trusted: clamp to the last two minutes
      at: Number.isFinite(at) && at > now - 120_000 && at <= now + 5_000 ? at : now,
    });
  }
  if (!events.length) throw new Error("No recognised events in the batch.");
  return {
    sessionKey,
    visitorKey,
    page,
    device: text(input.device, 24) || "unknown",
    source: text(input.source, 80) || "direct",
    variant: text(input.variant, 40) || null,
    experiments: experimentsFrom(input.experiments),
    isInternal: input.isInternal === true,
    events,
  };
}

/** One card per session, newest activity first. */
export function summarizeSessions(rows: LiveRow[], now = Date.now(), activeWindowMs = 3 * 60_000): LiveSession[] {
  const sessions = new Map<string, LiveSession>();
  const ordered = [...rows].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const row of ordered) {
    let session = sessions.get(row.sessionKey);
    if (!session) {
      session = {
        sessionKey: row.sessionKey,
        visitorKey: row.visitorKey,
        device: row.device,
        source: row.source,
        variant: row.variant,
        page: row.page,
        isInternal: Boolean(row.isInternal),
        firstSeen: row.occurredAt,
        lastSeen: row.occurredAt,
        lastLabel: row.label,
        active: false,
        events: 0,
        reached: { bundle: null, shade: null, cart: false, checkout: false, paid: false },
        modules: [],
      };
      sessions.set(row.sessionKey, session);
    }
    session.events += 1;
    session.lastSeen = row.occurredAt;
    if (row.kind !== "section" && row.kind !== "leave") session.lastLabel = row.label || session.lastLabel;
    if (row.variant && !session.variant) session.variant = row.variant;
    let detail: Record<string, unknown> = {};
    try { detail = JSON.parse(row.detail || "{}"); } catch { detail = {}; }
    if (row.kind === "bundle" && detail.bundle != null) session.reached.bundle = String(detail.bundle);
    if (row.kind === "shade" && detail.shade != null) session.reached.shade = String(detail.shade);
    if (row.kind === "cart_add") session.reached.cart = true;
    if (row.kind === "checkout_click") session.reached.checkout = true;
    if (row.kind === "module" && detail.module && !session.modules.includes(String(detail.module))) session.modules.push(String(detail.module));
  }
  const result = [...sessions.values()];
  for (const session of result) {
    session.active = now - Date.parse(session.lastSeen) <= activeWindowMs;
  }
  return result.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** What a shopper's device reads like from the user agent, without fingerprinting. */
export function deviceClass(userAgent: string | undefined): string {
  const ua = String(userAgent || "");
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return /iPhone|iPad/i.test(ua) ? "iphone-facebook" : "android-facebook";
  if (/Instagram/i.test(ua)) return /iPhone|iPad/i.test(ua) ? "iphone-instagram" : "android-instagram";
  if (/iPhone|iPad/i.test(ua)) return "iphone";
  if (/Android/i.test(ua)) return "android";
  if (/Mobile/i.test(ua)) return "mobile";
  return "desktop";
}

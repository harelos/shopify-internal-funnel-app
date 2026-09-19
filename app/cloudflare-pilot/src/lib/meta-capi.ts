/**
 * Meta Conversions API: the same events, sent from here instead of from the browser.
 *
 * Seventeen per cent of this store's traffic arrives in the Facebook in-app browser, which is
 * where browser-side tracking loses the most. Every purchase already reaches this Worker through
 * the order webhook, so sending it to Meta from the server closes that gap and gives Meta a
 * fuller picture to optimise on.
 *
 * Two rules this file exists to enforce:
 *
 *   Nothing identifying is ever logged or returned. Email, phone, name and address are hashed
 *   with SHA-256 before they leave, which is what Meta expects, and the plain values never
 *   appear in a log line, an error message or a response body.
 *
 *   Every event carries an `event_id`. Meta drops a server event whose (event_name, event_id)
 *   already arrived from the browser pixel, so an order counted twice is counted once. The id
 *   is the Shopify order id, which the browser pixel also uses.
 *
 * Off unless META_CAPI_ENABLED is "true", because turning it on beside an existing Meta sales
 * channel can double-count until the ids line up. Point META_CAPI_TEST_CODE at a test event
 * code first and watch Events Manager.
 */
import { createHash } from "node:crypto";

export const META_GRAPH_VERSION = "v23.0";

export interface MetaUserData {
  em?: string[]; ph?: string[]; fn?: string[]; ln?: string[];
  ct?: string[]; st?: string[]; zp?: string[]; country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
}

/** SHA-256 of a normalised value, or undefined when there is nothing to hash. */
export function hashed(value: unknown): string | undefined {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return undefined;
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Phone numbers have to reach Meta as digits with a country code and no punctuation.
 * Israeli numbers arrive in several shapes: +972..., 0972..., or a local 05x number.
 */
export function normalisePhone(value: unknown, defaultCountry = "972"): string | undefined {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = defaultCountry + digits.slice(1);
  else if (!digits.startsWith(defaultCountry) && digits.length <= 10) digits = defaultCountry + digits;
  return digits.length >= 8 && digits.length <= 15 ? digits : undefined;
}

const list = (value: string | undefined): string[] | undefined => value ? [value] : undefined;

export interface OrderLike {
  id?: unknown;
  admin_graphql_api_id?: unknown;
  order_number?: unknown;
  created_at?: unknown;
  currency?: unknown;
  current_total_price?: unknown;
  total_price?: unknown;
  email?: unknown;
  phone?: unknown;
  browser_ip?: unknown;
  client_details?: { browser_ip?: unknown; user_agent?: unknown } | null;
  customer?: { id?: unknown; email?: unknown; phone?: unknown; first_name?: unknown; last_name?: unknown } | null;
  billing_address?: Record<string, unknown> | null;
  shipping_address?: Record<string, unknown> | null;
  note_attributes?: Array<{ name?: unknown; value?: unknown }> | null;
  line_items?: Array<{ product_id?: unknown; variant_id?: unknown; quantity?: unknown; price?: unknown; title?: unknown }> | null;
  landing_site?: unknown;
}

/** A named cart attribute from the order, which is how the page hands us fbp, fbc and the visitor key. */
export function noteAttribute(order: OrderLike, name: string): string | undefined {
  const found = (order.note_attributes || []).find(entry => String(entry?.name ?? "") === name);
  const value = String(found?.value ?? "").trim();
  return value || undefined;
}

/** The Shopify order id as a plain number string, which is what the browser pixel uses as its event id. */
export function orderEventId(order: OrderLike): string | undefined {
  const fromGid = String(order.admin_graphql_api_id ?? "").split("/").pop();
  const id = String(order.id ?? fromGid ?? "").trim();
  return id || undefined;
}

export function buildPurchaseEvent(order: OrderLike, options: { sourceUrl?: string } = {}): MetaEvent | { error: string } {
  const eventId = orderEventId(order);
  if (!eventId) return { error: "The order carries no id." };
  const amount = Number(order.current_total_price ?? order.total_price ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return { error: "The order carries no positive total." };
  const currency = String(order.currency ?? "ILS").toUpperCase();

  const billing = (order.billing_address || order.shipping_address || {}) as Record<string, unknown>;
  const customer = order.customer || {};
  const created = Date.parse(String(order.created_at ?? ""));
  const client = order.client_details || {};

  const user: MetaUserData = {
    em: list(hashed(order.email ?? customer.email)),
    ph: list(hashed(normalisePhone(order.phone ?? customer.phone ?? billing.phone))),
    fn: list(hashed(customer.first_name ?? billing.first_name)),
    ln: list(hashed(customer.last_name ?? billing.last_name)),
    ct: list(hashed(billing.city)),
    st: list(hashed(billing.province_code ?? billing.province)),
    zp: list(hashed(billing.zip)),
    country: list(hashed(billing.country_code ?? billing.country)),
    // The page's own visitor key, hashed. Meta matches on it across sessions and devices.
    external_id: list(hashed(noteAttribute(order, "nova_visitor") ?? customer.id)),
    client_ip_address: String(order.browser_ip ?? client.browser_ip ?? "") || undefined,
    client_user_agent: String(client.user_agent ?? "") || undefined,
    fbp: noteAttribute(order, "nova_fbp"),
    fbc: noteAttribute(order, "nova_fbc"),
  };
  for (const key of Object.keys(user) as Array<keyof MetaUserData>) if (user[key] === undefined) delete user[key];

  const items = (order.line_items || []).map(line => ({
    id: String(line?.variant_id ?? line?.product_id ?? ""),
    quantity: Number(line?.quantity ?? 1) || 1,
    item_price: Number(line?.price ?? 0) || 0,
  })).filter(item => item.id);

  return {
    event_name: "Purchase",
    event_time: Math.floor((Number.isFinite(created) ? created : Date.now()) / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: options.sourceUrl || (String(order.landing_site ?? "") || undefined),
    user_data: user,
    custom_data: {
      currency,
      value: Number(amount.toFixed(2)),
      order_id: eventId,
      num_items: items.reduce((sum, item) => sum + item.quantity, 0) || undefined,
      contents: items.length ? items : undefined,
      content_type: items.length ? "product" : undefined,
    },
  };
}

/** How complete the match signals are, for the admin to read. Counts fields, never values. */
export function matchQuality(event: MetaEvent): { fields: string[]; score: number } {
  const present = Object.entries(event.user_data)
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value))
    .map(([key]) => key);
  // Meta weighs email, phone and the click id most heavily; this is a rough local read of the same idea.
  const weights: Record<string, number> = { em: 3, ph: 3, fbc: 3, fbp: 2, external_id: 2, fn: 1, ln: 1, ct: 1, st: 1, zp: 1, country: 1, client_ip_address: 1, client_user_agent: 1 };
  const score = present.reduce((sum, key) => sum + (weights[key] ?? 0), 0);
  return { fields: present, score };
}

export interface MetaCapiConfig { pixelId: string; accessToken: string; testCode?: string; enabled: boolean; }

export function capiConfigFrom(read: (key: string) => string): MetaCapiConfig {
  return {
    pixelId: read("META_PIXEL_ID") || "",
    accessToken: read("META_ACCESS_TOKEN") || "",
    testCode: read("META_CAPI_TEST_CODE") || undefined,
    enabled: read("META_CAPI_ENABLED") === "true",
  };
}

export interface MetaSendResult { sent: boolean; received?: number; skipped?: string; error?: string; }

/**
 * Send events to Meta. Errors are returned, never thrown, because a conversion that Meta
 * refuses must not fail the webhook that Shopify is waiting on. Nothing identifying is
 * included in the returned error.
 */
export async function sendMetaEvents(events: MetaEvent[], config: MetaCapiConfig, fetchImpl: typeof fetch = fetch): Promise<MetaSendResult> {
  if (!config.enabled) return { sent: false, skipped: "disabled" };
  if (!events.length) return { sent: false, skipped: "nothing to send" };
  if (!config.pixelId || !config.accessToken) return { sent: false, skipped: "no pixel id or token" };
  const body: Record<string, unknown> = { data: events, access_token: config.accessToken };
  if (config.testCode) body.test_event_code = config.testCode;
  try {
    const response = await fetchImpl(`https://graph.facebook.com/${META_GRAPH_VERSION}/${config.pixelId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as { events_received?: number; error?: { message?: string } };
    if (!response.ok) return { sent: false, error: String(payload?.error?.message || `Meta replied ${response.status}`).slice(0, 200) };
    return { sent: true, received: Number(payload?.events_received ?? events.length) };
  } catch (error) {
    return { sent: false, error: String((error as Error)?.message || "the request to Meta failed").slice(0, 200) };
  }
}

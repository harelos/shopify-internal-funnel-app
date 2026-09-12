import { decryptSensitive, encryptSensitive, hashPayload } from "./crypto";
import { isoNow, recordLifecycleError, setHealth } from "./db";
import { evaluateShipmentRisk, type NormalizedShipmentState } from "./shipment-risk";
import type { LifecycleEnv } from "./types";

interface CjTrackingEvent {
  eventTime?: string;
  activity?: string;
  location?: string;
  eventTimestamp?: number | string;
}

interface CjTrackingRow {
  trackNumber?: string;
  statusDescription?: string;
  status?: string;
  trackEvent?: CjTrackingEvent[];
}

interface ShipmentRow {
  shopify_order_id: string;
  completed_at: string;
  tracking_status: string | null;
  tracking_available_at: string | null;
  fulfillment_updated_at: string | null;
  ready_for_pickup_at: string | null;
  delivered_at: string | null;
  tracking_number_encrypted: string | null;
}

function text(value: unknown, maximum = 180): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function validDate(value: unknown): string | null {
  const candidate = text(value, 80);
  if (!candidate || !Number.isFinite(new Date(candidate).getTime())) return null;
  return new Date(candidate).toISOString();
}

function newestEvent(events: CjTrackingEvent[] | undefined): CjTrackingEvent | null {
  return [...(events ?? [])].sort((left, right) => {
    const a = new Date(left.eventTime ?? 0).getTime();
    const b = new Date(right.eventTime ?? 0).getTime();
    return b - a;
  })[0] ?? null;
}

export function cjState(row: CjTrackingRow): NormalizedShipmentState {
  const status = `${row.statusDescription ?? ""} ${row.status ?? ""} ${newestEvent(row.trackEvent)?.activity ?? ""}`.toLowerCase();
  if (/delivered/.test(status)) return "DELIVERED";
  if (/ready.*(?:pickup|collect)|available.*(?:pickup|collect)/.test(status)) return "READY_FOR_PICKUP";
  if (/picked up|collected/.test(status)) return "PICKED_UP";
  if (/return/.test(status)) return "RETURNING_TO_SENDER";
  if (/attempt.*deliver|delivery failure/.test(status)) return "ATTEMPTED_DELIVERY";
  if (/action required|buyer action/.test(status)) return "BUYER_ACTION_REQUIRED";
  if (/delay|exception/.test(status)) return "DELAYED";
  if (/out for delivery/.test(status)) return "OUT_FOR_DELIVERY";
  if (/en route|in transit/.test(status)) return "IN_TRANSIT";
  if (/dispatched|shipped/.test(status)) return "CARRIER_PICKED_UP";
  if (/processing|not found/.test(status)) return "TRACKING_ASSIGNED";
  return "UNKNOWN";
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCjPacket(numbers: string[]): Promise<CjTrackingRow[]> {
  const rows: CjTrackingRow[] = [];
  for (let index = 0; index < numbers.length; index += 40) {
    const response = await fetchWithTimeout("https://www.cjpacket.com/cj-logistics-api/refactoring/cjpacket/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(numbers.slice(index, index + 40)),
    });
    if (!response.ok) throw new Error(`cjpacket_http_${response.status}`);
    const body = await response.json() as { success?: boolean; data?: unknown };
    if (!body.success || !Array.isArray(body.data)) throw new Error("cjpacket_invalid_response");
    for (const item of body.data) {
      if (item && typeof item === "object") rows.push(item as CjTrackingRow);
    }
  }
  return rows;
}

async function upsertInternalAlert(
  env: LifecycleEnv,
  orderId: string,
  ruleId: string,
  severity: "INFO" | "WARNING" | "CRITICAL",
  stateVersion: number,
  now: string,
): Promise<void> {
  const alertKey = `shipment:${orderId}:${ruleId}:${stateVersion}`;
  await env.DB.prepare(
    `INSERT INTO lifecycle_internal_alerts
      (alert_key, shopify_order_id, rule_id, severity, state_version, safe_message, status, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
     ON CONFLICT(alert_key) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).bind(alertKey, orderId, ruleId, severity, stateVersion, ruleId, now, now).run();
}

async function persistShipment(
  env: LifecycleEnv,
  order: ShipmentRow,
  input: { state: NormalizedShipmentState; source: "SHOPIFY" | "CJPACKET"; safeStatus: string | null; eventAt: string | null; raw: unknown },
  now: string,
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT normalized_state, state_version, tracking_assigned_at, last_carrier_event_at, latest_safe_status
       FROM lifecycle_shipments WHERE shopify_order_id = ?`,
  ).bind(order.shopify_order_id).first<{
    normalized_state: NormalizedShipmentState;
    state_version: number;
    tracking_assigned_at: string | null;
    last_carrier_event_at: string | null;
    latest_safe_status: string | null;
  }>();
  const terminal = new Set<NormalizedShipmentState>(["DELIVERED", "PICKED_UP", "REFUNDED", "DISPUTED"]);
  const state = terminal.has(existing?.normalized_state ?? "UNKNOWN")
    ? existing?.normalized_state ?? input.state
    : input.state;
  const changed = !existing
    || existing.normalized_state !== state
    || (existing.latest_safe_status ?? null) !== (input.safeStatus ?? null);
  const stateVersion = (existing?.state_version ?? 0) + (changed ? 1 : 0);
  const eventAt = input.eventAt ?? now;
  const trackingAssignedAt = order.tracking_available_at ?? existing?.tracking_assigned_at ?? (order.tracking_number_encrypted ? eventAt : null);
  const deliveredAt = state === "DELIVERED" ? eventAt : order.delivered_at;
  const readyForPickupAt = state === "READY_FOR_PICKUP" ? eventAt : order.ready_for_pickup_at;
  await env.DB.prepare(
    `INSERT INTO lifecycle_shipments (
      shopify_order_id, normalized_state, state_source, state_version, paid_at,
      tracking_assigned_at, first_carrier_event_at, last_carrier_event_at,
      ready_for_pickup_at, delivered_at, latest_safe_status, next_review_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shopify_order_id) DO UPDATE SET
      normalized_state = excluded.normalized_state,
      state_source = excluded.state_source,
      state_version = excluded.state_version,
      tracking_assigned_at = COALESCE(excluded.tracking_assigned_at, lifecycle_shipments.tracking_assigned_at),
      first_carrier_event_at = COALESCE(lifecycle_shipments.first_carrier_event_at, excluded.first_carrier_event_at),
      last_carrier_event_at = CASE
        WHEN excluded.last_carrier_event_at >= COALESCE(lifecycle_shipments.last_carrier_event_at, '')
        THEN excluded.last_carrier_event_at ELSE lifecycle_shipments.last_carrier_event_at END,
      ready_for_pickup_at = COALESCE(lifecycle_shipments.ready_for_pickup_at, excluded.ready_for_pickup_at),
      delivered_at = COALESCE(lifecycle_shipments.delivered_at, excluded.delivered_at),
      latest_safe_status = COALESCE(excluded.latest_safe_status, lifecycle_shipments.latest_safe_status),
      next_review_at = excluded.next_review_at,
      updated_at = excluded.updated_at`,
  ).bind(
    order.shopify_order_id, state, input.source, stateVersion, order.completed_at,
    trackingAssignedAt, eventAt, eventAt, readyForPickupAt, deliveredAt,
    input.safeStatus, now, now, now,
  ).run();
  const eventKey = `shipment:${input.source}:${order.shopify_order_id}:${await hashPayload({ state, eventAt, safe: input.safeStatus })}`;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO lifecycle_tracking_events
      (event_key, shopify_order_id, source, normalized_state, safe_status, happened_at, received_at, payload_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(eventKey, order.shopify_order_id, input.source, state, input.safeStatus, eventAt, now, await hashPayload(input.raw)).run();
  const findings = evaluateShipmentRisk({
    state,
    paidAt: order.completed_at,
    trackingAssignedAt,
    lastCarrierEventAt: input.source === "CJPACKET" ? eventAt : order.tracking_available_at,
    now,
  });
  for (const finding of findings) {
    await upsertInternalAlert(env, order.shopify_order_id, finding.ruleId, finding.severity, stateVersion, now);
  }
}

export async function reconcileShipmentAssurance(env: LifecycleEnv, now = new Date()): Promise<{ checked: number; tracked: number; alerts: number }> {
  if (env.SHIPMENT_ASSURANCE_ENABLED !== "true") return { checked: 0, tracked: 0, alerts: 0 };
  const current = isoNow(now);
  const cutoff = new Date(now.getTime() - 35 * 86_400_000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT shopify_order_id, completed_at, tracking_status, tracking_available_at, fulfillment_updated_at,
            ready_for_pickup_at, delivered_at, tracking_number_encrypted
       FROM lifecycle_orders
      WHERE completed_at >= ?
        AND delivered_at IS NULL
      ORDER BY completed_at ASC LIMIT 120`,
  ).bind(cutoff).all<ShipmentRow>();
  const orders = rows.results ?? [];
  const pairs = await Promise.all(orders.map(async order => ({
    order,
    trackingNumber: order.tracking_number_encrypted
      ? await decryptSensitive(order.tracking_number_encrypted, env.LIFECYCLE_DATA_KEY ?? "").catch(() => null)
      : null,
  })));
  const numbers = [...new Set(pairs.map(pair => pair.trackingNumber).filter((value): value is string => Boolean(value)))];
  let trackingRows: CjTrackingRow[] = [];
  try {
    if (numbers.length) trackingRows = await fetchCjPacket(numbers);
  } catch (error) {
    const code = error instanceof Error ? error.message : "cjpacket_failed";
    await recordLifecycleError(env.DB, {
      component: "shipment_assurance", code, safeMessage: "CJ tracking source unavailable", retryable: true, now: current,
    });
    await setHealth(env.DB, "shipment_assurance_cjpacket", code, "WARN", current);
  }
  const byNumber = new Map(trackingRows.map(row => [row.trackNumber ?? "", row]));
  let alerts = 0;
  for (const pair of pairs) {
    const tracking = pair.trackingNumber ? byNumber.get(pair.trackingNumber) : null;
    const event = newestEvent(tracking?.trackEvent);
    const state = tracking ? cjState(tracking) : pair.order.delivered_at ? "DELIVERED" : pair.order.ready_for_pickup_at ? "READY_FOR_PICKUP" : pair.order.tracking_number_encrypted ? "TRACKING_ASSIGNED" : "SUPPLIER_PROCESSING";
    const safeStatus = text(tracking?.statusDescription) ?? text(pair.order.tracking_status);
    const eventAt = validDate(event?.eventTime) ?? pair.order.fulfillment_updated_at ?? pair.order.tracking_available_at ?? pair.order.completed_at;
    await persistShipment(env, pair.order, { state, source: tracking ? "CJPACKET" : "SHOPIFY", safeStatus, eventAt, raw: tracking ?? pair.order }, current);
    alerts += evaluateShipmentRisk({
      state,
      paidAt: pair.order.completed_at,
      trackingAssignedAt: pair.order.tracking_available_at,
      lastCarrierEventAt: tracking ? eventAt : pair.order.tracking_available_at,
      now: current,
    }).length;
  }
  await setHealth(env.DB, "shipment_assurance_last_run", JSON.stringify({ checked: orders.length, tracked: trackingRows.length, alerts }), alerts ? "WARN" : "OK", current);
  return { checked: orders.length, tracked: trackingRows.length, alerts };
}

export async function encryptTrackingNumber(env: LifecycleEnv, number: string | null | undefined): Promise<string | null> {
  const normalized = text(number, 160);
  return normalized ? encryptSensitive(normalized, env.LIFECYCLE_DATA_KEY ?? "") : null;
}

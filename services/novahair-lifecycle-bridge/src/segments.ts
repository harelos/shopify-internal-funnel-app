import { isoNow } from "./db";
import type { LifecycleEnv } from "./types";

// ---------------------------------------------------------------------------
// A segment is a stored filter over the customers table. The filter never
// contains SQL: it is a small, validated object that this module compiles into
// a parameterised WHERE clause. Every value reaches D1 as a bound parameter and
// every column name is written here in source, so a malformed or hostile filter
// can only ever be rejected, never executed.
// ---------------------------------------------------------------------------

/** Consent states a marketing campaign may ever reach. */
export const REACHABLE_CONSENT = ["SUBSCRIBED", "NOT_SUBSCRIBED"] as const;
export type ReachableConsent = (typeof REACHABLE_CONSENT)[number];

export interface SegmentFilter {
  consent?: ReachableConsent[];
  novahairBuyer?: boolean;
  minOrders?: number;
  maxOrders?: number;
  neverOrdered?: boolean;
  minLifetimeValue?: number;
  orderedWithinDays?: number;
  lastOrderOlderThanDays?: number;
  minScore?: number;
  maxScore?: number;
  productHandleAny?: string[];
  excludeProductHandleAny?: string[];
  openedWithinDays?: number;
  clickedWithinDays?: number;
  notEmailedWithinDays?: number;
  limit?: number;
}

const DAY = 86_400_000;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const SEGMENT_MAX_LIMIT = 10_000;

function fail(field: string): never {
  throw new Error(`segment_filter_invalid_${field}`);
}

function integer(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < min || parsed > max) fail(field);
  return parsed;
}

function decimal(value: unknown, field: string, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) fail(field);
  return parsed;
}

function handleList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) fail(field);
  const handles = value.map((entry) => String(entry).trim().toLowerCase());
  for (const handle of handles) if (!HANDLE.test(handle)) fail(field);
  return [...new Set(handles)];
}

/**
 * Parse and validate an untrusted filter object. Unknown keys are rejected
 * rather than ignored, so a typo in an agent proposal fails loudly instead of
 * silently widening the audience.
 */
export function parseSegmentFilter(raw: unknown): SegmentFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("shape");
  const input = raw as Record<string, unknown>;
  const allowed = new Set([
    "consent", "novahairBuyer", "minOrders", "maxOrders", "neverOrdered", "minLifetimeValue",
    "orderedWithinDays", "lastOrderOlderThanDays", "minScore", "maxScore", "productHandleAny",
    "excludeProductHandleAny", "openedWithinDays", "clickedWithinDays", "notEmailedWithinDays", "limit",
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail(`unknown_key_${key.slice(0, 40)}`);

  const filter: SegmentFilter = {};

  if (input.consent !== undefined) {
    if (!Array.isArray(input.consent) || input.consent.length === 0) fail("consent");
    const states = input.consent.map((entry) => String(entry).toUpperCase());
    for (const state of states) {
      if (!(REACHABLE_CONSENT as readonly string[]).includes(state)) fail("consent");
    }
    filter.consent = [...new Set(states)] as ReachableConsent[];
  }
  if (input.novahairBuyer !== undefined) {
    if (typeof input.novahairBuyer !== "boolean") fail("novahairBuyer");
    filter.novahairBuyer = input.novahairBuyer;
  }
  if (input.neverOrdered !== undefined) {
    if (typeof input.neverOrdered !== "boolean") fail("neverOrdered");
    filter.neverOrdered = input.neverOrdered;
  }
  if (input.minOrders !== undefined) filter.minOrders = integer(input.minOrders, "minOrders", 0, 1000);
  if (input.maxOrders !== undefined) filter.maxOrders = integer(input.maxOrders, "maxOrders", 0, 1000);
  if (input.minLifetimeValue !== undefined) {
    filter.minLifetimeValue = decimal(input.minLifetimeValue, "minLifetimeValue", 0, 1_000_000);
  }
  if (input.orderedWithinDays !== undefined) {
    filter.orderedWithinDays = integer(input.orderedWithinDays, "orderedWithinDays", 1, 3650);
  }
  if (input.lastOrderOlderThanDays !== undefined) {
    filter.lastOrderOlderThanDays = integer(input.lastOrderOlderThanDays, "lastOrderOlderThanDays", 1, 3650);
  }
  if (input.minScore !== undefined) filter.minScore = integer(input.minScore, "minScore", 0, 100);
  if (input.maxScore !== undefined) filter.maxScore = integer(input.maxScore, "maxScore", 0, 100);
  if (input.productHandleAny !== undefined) {
    filter.productHandleAny = handleList(input.productHandleAny, "productHandleAny");
  }
  if (input.excludeProductHandleAny !== undefined) {
    filter.excludeProductHandleAny = handleList(input.excludeProductHandleAny, "excludeProductHandleAny");
  }
  if (input.openedWithinDays !== undefined) {
    filter.openedWithinDays = integer(input.openedWithinDays, "openedWithinDays", 1, 3650);
  }
  if (input.clickedWithinDays !== undefined) {
    filter.clickedWithinDays = integer(input.clickedWithinDays, "clickedWithinDays", 1, 3650);
  }
  if (input.notEmailedWithinDays !== undefined) {
    filter.notEmailedWithinDays = integer(input.notEmailedWithinDays, "notEmailedWithinDays", 1, 3650);
  }
  if (input.limit !== undefined) filter.limit = integer(input.limit, "limit", 1, SEGMENT_MAX_LIMIT);

  if (filter.minOrders !== undefined && filter.maxOrders !== undefined && filter.minOrders > filter.maxOrders) {
    fail("orders_range");
  }
  if (filter.minScore !== undefined && filter.maxScore !== undefined && filter.minScore > filter.maxScore) {
    fail("score_range");
  }
  if (filter.neverOrdered && (filter.minOrders ?? 0) > 0) fail("never_ordered_conflict");
  return filter;
}

export interface CompiledSegment {
  where: string;
  binds: unknown[];
  limit: number;
}

/**
 * Compile a filter to a WHERE clause over `customers c`.
 *
 * Three rules are always applied and are not expressible in the filter, so no
 * segment can ever opt out of them:
 *   1. the row must have a usable email address
 *   2. consent must be a reachable state (never UNSUBSCRIBED or REDACTED)
 *   3. the address must not carry an active suppression
 */
export function compileSegment(filter: SegmentFilter, now = new Date()): CompiledSegment {
  const clauses: string[] = ["c.email IS NOT NULL", "c.email <> ''"];
  const binds: unknown[] = [];
  const since = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

  const consent = filter.consent ?? [...REACHABLE_CONSENT];
  clauses.push(`c.consent_state IN (${consent.map(() => "?").join(", ")})`);
  binds.push(...consent);

  clauses.push("NOT EXISTS (SELECT 1 FROM suppressions s WHERE s.email_hash = c.email_hash AND s.active = 1)");

  if (filter.novahairBuyer !== undefined) {
    clauses.push("c.novahair_buyer = ?");
    binds.push(filter.novahairBuyer ? 1 : 0);
  }
  if (filter.neverOrdered) clauses.push("c.order_count = 0");
  if (filter.minOrders !== undefined) {
    clauses.push("c.order_count >= ?");
    binds.push(filter.minOrders);
  }
  if (filter.maxOrders !== undefined) {
    clauses.push("c.order_count <= ?");
    binds.push(filter.maxOrders);
  }
  if (filter.minLifetimeValue !== undefined) {
    clauses.push("c.lifetime_value >= ?");
    binds.push(filter.minLifetimeValue);
  }
  if (filter.orderedWithinDays !== undefined) {
    clauses.push("c.last_order_at IS NOT NULL AND c.last_order_at >= ?");
    binds.push(since(filter.orderedWithinDays));
  }
  if (filter.lastOrderOlderThanDays !== undefined) {
    clauses.push("c.last_order_at IS NOT NULL AND c.last_order_at < ?");
    binds.push(since(filter.lastOrderOlderThanDays));
  }
  if (filter.minScore !== undefined) {
    clauses.push("c.engagement_score >= ?");
    binds.push(filter.minScore);
  }
  if (filter.maxScore !== undefined) {
    clauses.push("c.engagement_score <= ?");
    binds.push(filter.maxScore);
  }
  // products_json is a sorted JSON array of lowercase handles. Quoting both
  // sides of the LIKE keeps "nova" from matching "novasale-4".
  if (filter.productHandleAny?.length) {
    clauses.push(`(${filter.productHandleAny.map(() => "c.products_json LIKE ?").join(" OR ")})`);
    binds.push(...filter.productHandleAny.map((handle) => `%"${handle}"%`));
  }
  if (filter.excludeProductHandleAny?.length) {
    clauses.push(`NOT (${filter.excludeProductHandleAny.map(() => "c.products_json LIKE ?").join(" OR ")})`);
    binds.push(...filter.excludeProductHandleAny.map((handle) => `%"${handle}"%`));
  }
  if (filter.openedWithinDays !== undefined) {
    clauses.push("c.last_open_at IS NOT NULL AND c.last_open_at >= ?");
    binds.push(since(filter.openedWithinDays));
  }
  if (filter.clickedWithinDays !== undefined) {
    clauses.push("c.last_click_at IS NOT NULL AND c.last_click_at >= ?");
    binds.push(since(filter.clickedWithinDays));
  }
  if (filter.notEmailedWithinDays !== undefined) {
    clauses.push("(c.last_email_at IS NULL OR c.last_email_at < ?)");
    binds.push(since(filter.notEmailedWithinDays));
  }

  return {
    where: clauses.join(" AND "),
    binds,
    limit: filter.limit ?? SEGMENT_MAX_LIMIT,
  };
}

export async function countSegment(
  env: LifecycleEnv,
  filter: SegmentFilter,
  now = new Date(),
): Promise<number> {
  const compiled = compileSegment(filter, now);
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT c.email_hash FROM customers c WHERE ${compiled.where} LIMIT ?
     )`,
  ).bind(...compiled.binds, compiled.limit).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

function maskEmail(email: string): string {
  const [local = "", domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 2)}***@${domain}`;
}

export interface SegmentPreview {
  count: number;
  sample: Array<{
    email: string;
    firstName: string | null;
    orderCount: number;
    lifetimeValue: number;
    engagementScore: number;
    lastOrderAt: string | null;
    novahairBuyer: boolean;
  }>;
}

export async function previewSegment(
  env: LifecycleEnv,
  filter: SegmentFilter,
  now = new Date(),
  sampleSize = 10,
): Promise<SegmentPreview> {
  const compiled = compileSegment(filter, now);
  const count = await countSegment(env, filter, now);
  const rows = await env.DB.prepare(
    `SELECT email, first_name, order_count, lifetime_value, engagement_score, last_order_at, novahair_buyer
     FROM customers c WHERE ${compiled.where}
     ORDER BY c.engagement_score DESC, c.last_order_at DESC
     LIMIT ?`,
  ).bind(...compiled.binds, Math.max(1, Math.min(50, sampleSize))).all<{
    email: string;
    first_name: string | null;
    order_count: number;
    lifetime_value: number;
    engagement_score: number;
    last_order_at: string | null;
    novahair_buyer: number;
  }>();
  return {
    count,
    sample: (rows.results ?? []).map((row) => ({
      email: maskEmail(row.email),
      firstName: row.first_name,
      orderCount: Number(row.order_count),
      lifetimeValue: Number(row.lifetime_value),
      engagementScore: Number(row.engagement_score),
      lastOrderAt: row.last_order_at,
      novahairBuyer: Number(row.novahair_buyer) === 1,
    })),
  };
}

// ---------------------------------------------------------------------------
// Stored segments
// ---------------------------------------------------------------------------
export interface SegmentRow {
  segment_id: string;
  name: string;
  description: string | null;
  filter_json: string;
  last_count: number | null;
  last_counted_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function segmentSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function saveSegment(
  env: LifecycleEnv,
  input: { name: string; description?: string | null; filter: unknown; createdBy: string },
  now = new Date(),
): Promise<{ segmentId: string; count: number; filter: SegmentFilter }> {
  const name = input.name?.trim() ?? "";
  if (name.length < 2 || name.length > 120) throw new Error("segment_name_invalid");
  const slug = segmentSlug(name);
  if (!slug) throw new Error("segment_name_invalid");
  const filter = parseSegmentFilter(input.filter);
  const count = await countSegment(env, filter, now);
  const current = isoNow(now);
  const segmentId = `seg_${slug}`;
  await env.DB.prepare(
    `INSERT INTO segments (
       segment_id, name, description, filter_json, last_count, last_counted_at,
       created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(segment_id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       filter_json = excluded.filter_json,
       last_count = excluded.last_count,
       last_counted_at = excluded.last_counted_at,
       updated_at = excluded.updated_at`,
  ).bind(
    segmentId,
    name.slice(0, 120),
    input.description?.trim().slice(0, 500) ?? null,
    JSON.stringify(filter),
    count,
    current,
    input.createdBy.slice(0, 40),
    current,
    current,
  ).run();
  return { segmentId, count, filter };
}

export async function getSegment(env: LifecycleEnv, segmentId: string): Promise<SegmentRow | null> {
  return env.DB.prepare(
    `SELECT segment_id, name, description, filter_json, last_count, last_counted_at,
            created_by, created_at, updated_at
     FROM segments WHERE segment_id = ?`,
  ).bind(segmentId).first<SegmentRow>();
}

export async function listSegments(env: LifecycleEnv, now = new Date()): Promise<{
  ok: true;
  segments: Array<{
    segmentId: string;
    name: string;
    description: string | null;
    filter: SegmentFilter;
    count: number;
    countedAt: string | null;
    createdBy: string;
    updatedAt: string;
  }>;
}> {
  const rows = await env.DB.prepare(
    `SELECT segment_id, name, description, filter_json, last_count, last_counted_at,
            created_by, created_at, updated_at
     FROM segments ORDER BY updated_at DESC LIMIT 100`,
  ).all<SegmentRow>();
  const segments = [];
  for (const row of rows.results ?? []) {
    let filter: SegmentFilter = {};
    try { filter = parseSegmentFilter(JSON.parse(row.filter_json)); } catch { filter = {}; }
    segments.push({
      segmentId: row.segment_id,
      name: row.name,
      description: row.description,
      filter,
      count: await countSegment(env, filter, now),
      countedAt: row.last_counted_at,
      createdBy: row.created_by,
      updatedAt: row.updated_at,
    });
  }
  return { ok: true, segments };
}

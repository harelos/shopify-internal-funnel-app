import { canDispatchTo, lifecycleConfig, usageLimitsFor } from "./config";
import { encryptSensitive, randomOpaqueToken } from "./crypto";
import {
  createClickToken,
  isoNow,
  recordLifecycleError,
  setHealth,
  usageSnapshot,
  usageThresholds,
} from "./db";
import { classifyResendResponse } from "./resend";
import { compileSegment, getSegment, parseSegmentFilter, segmentSlug, SEGMENT_MAX_LIMIT } from "./segments";
import type { LifecycleEnv } from "./types";

// ---------------------------------------------------------------------------
// Campaigns. An agent (or a person) proposes a draft; nothing leaves DRAFT
// without an explicit approval; approval freezes the audience into
// campaign_recipients; cron sends it in small batches inside a quota budget
// that always keeps room for lifecycle mail.
// ---------------------------------------------------------------------------

export type CampaignStatus = "DRAFT" | "APPROVED" | "SENDING" | "SENT" | "REJECTED" | "CANCELLED";

export interface CampaignRow {
  campaign_id: string;
  name: string;
  slug: string;
  segment_id: string;
  subject: string;
  preheader: string | null;
  html: string;
  cta_url: string | null;
  kind: "marketing" | "transactional";
  status: CampaignStatus;
  send_after: string | null;
  max_recipients: number | null;
  proposed_by: string;
  proposal_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  audience_built_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  recipients_total: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
  updated_at: string;
}

interface RecipientRow {
  campaign_id: string;
  email_hash: string;
  email: string;
  first_name: string | null;
  attempts: number;
}

const MAX_ATTEMPTS = 3;

function fail(code: string): never {
  throw new Error(`campaign_invalid_${code}`);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * A campaign may only link to our own storefront or to the Worker. This keeps a
 * generated proposal from turning into an open redirect or an off-brand link.
 */
export function assertAllowedCtaUrl(env: LifecycleEnv, raw: string): string {
  const config = lifecycleConfig(env);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { fail("cta_url"); }
  if (parsed.protocol !== "https:") fail("cta_url_protocol");
  const host = parsed.host.toLowerCase();
  const allowed = [config.storefrontDomain, config.shopDomain].filter(Boolean);
  const appHost = config.appUrl ? new URL(config.appUrl).host.toLowerCase() : "";
  if (appHost) allowed.push(appHost);
  const ok = allowed.some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!ok) fail("cta_url_host");
  return parsed.toString();
}

export interface CampaignInput {
  name: string;
  segmentId: string;
  subject: string;
  preheader?: string | null;
  html: string;
  ctaUrl?: string | null;
  kind?: "marketing" | "transactional";
  sendAfter?: string | null;
  maxRecipients?: number | null;
  proposedBy: string;
  proposalReason?: string | null;
}

export async function createCampaign(
  env: LifecycleEnv,
  input: CampaignInput,
  now = new Date(),
): Promise<{ ok: true; campaignId: string; slug: string; status: CampaignStatus; audienceEstimate: number }> {
  const name = input.name?.trim() ?? "";
  if (name.length < 2 || name.length > 120) fail("name");
  const subject = input.subject?.trim() ?? "";
  if (subject.length < 3 || subject.length > 200) fail("subject");
  const html = input.html ?? "";
  if (html.length < 20 || html.length > 200_000) fail("html");
  const kind = input.kind ?? "marketing";
  if (!["marketing", "transactional"].includes(kind)) fail("kind");
  // Every marketing email must carry a working way out. Enforced here so a
  // proposal cannot reach approval without one.
  if (kind === "marketing" && !html.includes("{{UNSUBSCRIBE_URL}}")) fail("html_missing_unsubscribe");
  if (html.includes("{{CTA_URL}}") && !input.ctaUrl) fail("cta_url_required");

  const segment = await getSegment(env, input.segmentId);
  if (!segment) fail("segment_unknown");

  const ctaUrl = input.ctaUrl ? assertAllowedCtaUrl(env, input.ctaUrl) : null;
  let sendAfter: string | null = null;
  if (input.sendAfter) {
    const parsed = new Date(input.sendAfter);
    if (!Number.isFinite(parsed.getTime())) fail("send_after");
    sendAfter = parsed.toISOString();
  }
  const maxRecipients = input.maxRecipients == null
    ? null
    : Math.max(1, Math.min(SEGMENT_MAX_LIMIT, Math.trunc(Number(input.maxRecipients)) || 0));
  if (input.maxRecipients != null && !maxRecipients) fail("max_recipients");

  const base = segmentSlug(name) || "campaign";
  const slug = `${base}-${now.getTime().toString(36)}`.slice(0, 70);
  const campaignId = `cmp_${slug}`;
  const current = isoNow(now);

  await env.DB.prepare(
    `INSERT INTO campaigns (
       campaign_id, name, slug, segment_id, subject, preheader, html, cta_url, kind,
       status, send_after, max_recipients, proposed_by, proposal_reason, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    campaignId,
    name.slice(0, 120),
    slug,
    input.segmentId,
    subject,
    input.preheader?.trim().slice(0, 200) ?? null,
    html,
    ctaUrl,
    kind,
    sendAfter,
    maxRecipients,
    input.proposedBy.slice(0, 40),
    input.proposalReason?.trim().slice(0, 1000) ?? null,
    current,
    current,
  ).run();

  const filter = parseSegmentFilter(JSON.parse(segment.filter_json));
  const compiled = compileSegment(filter, now);
  const estimate = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT c.email_hash FROM customers c WHERE ${compiled.where} LIMIT ?)`,
  ).bind(...compiled.binds, Math.min(compiled.limit, maxRecipients ?? compiled.limit)).first<{ n: number }>();

  return {
    ok: true,
    campaignId,
    slug,
    status: "DRAFT",
    audienceEstimate: Number(estimate?.n ?? 0),
  };
}

export async function getCampaign(env: LifecycleEnv, campaignId: string): Promise<CampaignRow | null> {
  return env.DB.prepare("SELECT * FROM campaigns WHERE campaign_id = ?").bind(campaignId).first<CampaignRow>();
}

/**
 * Approval freezes the audience. The people who receive the campaign are
 * exactly the people counted here, even if the segment shifts mid-send.
 */
export async function approveCampaign(
  env: LifecycleEnv,
  campaignId: string,
  approvedBy: string,
  now = new Date(),
): Promise<{ ok: true; recipients: number; status: CampaignStatus }> {
  const campaign = await getCampaign(env, campaignId);
  if (!campaign) throw new Error("campaign_not_found");
  if (campaign.status !== "DRAFT") throw new Error(`campaign_not_draft_${campaign.status.toLowerCase()}`);
  const segment = await getSegment(env, campaign.segment_id);
  if (!segment) throw new Error("campaign_segment_missing");

  const filter = parseSegmentFilter(JSON.parse(segment.filter_json));
  const compiled = compileSegment(filter, now);
  const current = isoNow(now);
  const limit = Math.min(compiled.limit, campaign.max_recipients ?? compiled.limit);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO campaign_recipients
       (campaign_id, email_hash, email, first_name, status, queued_at)
     SELECT ?, c.email_hash, c.email, c.first_name, 'QUEUED', ?
     FROM customers c
     WHERE ${compiled.where}
     ORDER BY c.engagement_score DESC, c.last_order_at DESC
     LIMIT ?`,
  ).bind(campaignId, current, ...compiled.binds, limit).run();

  const total = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = ?",
  ).bind(campaignId).first<{ n: number }>();
  const recipients = Number(total?.n ?? 0);

  await env.DB.prepare(
    `UPDATE campaigns
     SET status = 'APPROVED', approved_by = ?, approved_at = ?, audience_built_at = ?,
         recipients_total = ?, updated_at = ?
     WHERE campaign_id = ?`,
  ).bind(approvedBy.slice(0, 60), current, current, recipients, current, campaignId).run();

  return { ok: true, recipients, status: "APPROVED" };
}

export async function setCampaignStatus(
  env: LifecycleEnv,
  campaignId: string,
  status: "REJECTED" | "CANCELLED",
  reason: string | null,
  now = new Date(),
): Promise<{ ok: true; status: CampaignStatus }> {
  const campaign = await getCampaign(env, campaignId);
  if (!campaign) throw new Error("campaign_not_found");
  const allowed = status === "REJECTED"
    ? ["DRAFT"]
    : ["DRAFT", "APPROVED", "SENDING"];
  if (!allowed.includes(campaign.status)) throw new Error(`campaign_cannot_${status.toLowerCase()}_from_${campaign.status.toLowerCase()}`);
  const current = isoNow(now);
  await env.DB.prepare(
    "UPDATE campaigns SET status = ?, rejected_reason = ?, updated_at = ? WHERE campaign_id = ?",
  ).bind(status, reason?.slice(0, 500) ?? null, current, campaignId).run();
  if (status === "CANCELLED") {
    await env.DB.prepare(
      `UPDATE campaign_recipients SET status = 'SKIPPED', skip_reason = 'campaign_cancelled'
       WHERE campaign_id = ? AND status = 'QUEUED'`,
    ).bind(campaignId).run();
  }
  return { ok: true, status };
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------
export async function ensureUnsubscribeToken(
  env: LifecycleEnv,
  emailHash: string,
  now = new Date(),
): Promise<string | null> {
  const existing = await env.DB.prepare(
    "SELECT unsubscribe_token FROM customers WHERE email_hash = ?",
  ).bind(emailHash).first<{ unsubscribe_token: string | null }>();
  if (!existing) return null;
  if (existing.unsubscribe_token) return existing.unsubscribe_token;
  const token = randomOpaqueToken(24);
  await env.DB.prepare(
    "UPDATE customers SET unsubscribe_token = ?, updated_at = ? WHERE email_hash = ? AND unsubscribe_token IS NULL",
  ).bind(token, isoNow(now), emailHash).run();
  const stored = await env.DB.prepare(
    "SELECT unsubscribe_token FROM customers WHERE email_hash = ?",
  ).bind(emailHash).first<{ unsubscribe_token: string | null }>();
  return stored?.unsubscribe_token ?? null;
}

export function unsubscribeUrl(env: LifecycleEnv, token: string): string {
  const config = lifecycleConfig(env);
  if (!config.appUrl) throw new Error("app_url_missing");
  return `${config.appUrl}/api/lifecycle/u/${token}`;
}

/**
 * A customer opting out must stop every marketing path at once: our own
 * suppression list, the consent state we segment on, Resend's contact record,
 * and Shopify (queued), or the next consent sync would resurrect it.
 */
export async function applyUnsubscribe(
  env: LifecycleEnv,
  token: string,
  now = new Date(),
): Promise<{ ok: boolean; alreadyUnsubscribed: boolean }> {
  const current = isoNow(now);
  const row = await env.DB.prepare(
    "SELECT email_hash, email, shopify_customer_id, consent_state FROM customers WHERE unsubscribe_token = ?",
  ).bind(token).first<{
    email_hash: string;
    email: string;
    shopify_customer_id: string | null;
    consent_state: string;
  }>();
  if (!row) return { ok: false, alreadyUnsubscribed: false };
  const already = row.consent_state === "UNSUBSCRIBED";

  await env.DB.prepare(
    `INSERT INTO suppressions
       (email_hash, source, reason, occurred_at, shopify_customer_id, active, created_at, updated_at)
     VALUES (?, 'CUSTOMER_LINK', 'marketing_unsubscribed', ?, ?, 1, ?, ?)
     ON CONFLICT(email_hash) DO UPDATE SET
       source = excluded.source,
       reason = CASE WHEN suppressions.reason IN ('bounce', 'complaint', 'hard_bounce')
                     THEN suppressions.reason ELSE excluded.reason END,
       active = 1,
       updated_at = excluded.updated_at`,
  ).bind(row.email_hash, current, row.shopify_customer_id, current, current).run();

  await env.DB.prepare(
    `UPDATE customers SET consent_state = 'UNSUBSCRIBED', consent_updated_at = ?, updated_at = ?
     WHERE email_hash = ?`,
  ).bind(current, current, row.email_hash).run();

  await env.DB.prepare(
    `UPDATE campaign_recipients SET status = 'SKIPPED', skip_reason = 'unsubscribed', unsubscribed_at = ?
     WHERE email_hash = ? AND status = 'QUEUED'`,
  ).bind(current, row.email_hash).run();
  await env.DB.prepare(
    "UPDATE campaign_recipients SET unsubscribed_at = COALESCE(unsubscribed_at, ?) WHERE email_hash = ? AND status = 'SENT'",
  ).bind(current, row.email_hash).run();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO resend_contact_updates (
       idempotency_key, email, email_hash, unsubscribed, status, attempts, max_attempts,
       next_attempt_at, created_at, updated_at
     ) VALUES (?, ?, ?, 1, 'PENDING', 0, 7, ?, ?, ?)`,
  ).bind(`unsub:${row.email_hash}:${current.slice(0, 10)}`, row.email, row.email_hash, current, current, current).run();

  if (row.shopify_customer_id) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO shopify_consent_updates (
         idempotency_key, shopify_customer_id, email_hash, marketing_state, status,
         attempts, max_attempts, next_attempt_at, created_at, updated_at
       ) VALUES (?, ?, ?, 'UNSUBSCRIBED', 'PENDING', 0, 7, ?, ?, ?)`,
    ).bind(
      `shopify-unsub:${row.email_hash}:${current.slice(0, 10)}`,
      row.shopify_customer_id,
      row.email_hash,
      current,
      current,
      current,
    ).run();
  }

  return { ok: true, alreadyUnsubscribed: already };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
export interface CampaignBudget {
  allowed: number;
  reason: string | null;
  dayEmails: number;
  monthEmails: number;
  dayCeiling: number;
}

export async function campaignBudget(env: LifecycleEnv, now = new Date()): Promise<CampaignBudget> {
  const config = lifecycleConfig(env);
  const usage = await usageSnapshot(env.DB, now, usageLimitsFor(env));
  const threshold = usageThresholds(usage.limits);
  const dayCeiling = Math.max(0, threshold.dayCritical - config.campaignLifecycleReserve);
  if (!usage.dispatchAllowed) {
    return { allowed: 0, reason: "quota_guard_active", dayEmails: usage.dayEmails, monthEmails: usage.monthEmails, dayCeiling };
  }
  const remainingToday = Math.max(0, dayCeiling - usage.dayEmails);
  const remainingMonth = Math.max(0, threshold.monthCritical - usage.monthEmails);
  const allowed = Math.min(config.campaignBatchSize, remainingToday, remainingMonth);
  return {
    allowed,
    reason: allowed > 0 ? null : remainingToday === 0 ? "daily_campaign_ceiling" : "monthly_ceiling",
    dayEmails: usage.dayEmails,
    monthEmails: usage.monthEmails,
    dayCeiling,
  };
}

async function renderForRecipient(
  env: LifecycleEnv,
  campaign: CampaignRow,
  recipient: RecipientRow,
  now: Date,
): Promise<{ html: string; unsubscribeUrl: string | null }> {
  const config = lifecycleConfig(env);
  let unsubUrl: string | null = null;
  const token = await ensureUnsubscribeToken(env, recipient.email_hash, now);
  if (token) unsubUrl = unsubscribeUrl(env, token);

  let ctaUrl = "";
  if (campaign.cta_url) {
    const clickToken = await createClickToken(env.DB, {
      entityType: "campaign",
      entityId: `${campaign.campaign_id}:${recipient.email_hash}`,
      flow: "campaign",
      emailNumber: 1,
      encryptedTargetUrl: await encryptSensitive(campaign.cta_url, config.dataKey),
      utmCampaign: `novahair_campaign_${campaign.slug}`,
      utmContent: campaign.slug,
      now,
    });
    ctaUrl = `${config.appUrl}/api/lifecycle/click/${clickToken}`;
  }

  const html = campaign.html
    .replaceAll("{{FIRST_NAME}}", escapeHtml(recipient.first_name?.trim() ?? ""))
    .replaceAll("{{UNSUBSCRIBE_URL}}", unsubUrl ?? "")
    .replaceAll("{{CTA_URL}}", ctaUrl);
  return { html, unsubscribeUrl: unsubUrl };
}

async function sendOne(
  env: LifecycleEnv,
  campaign: CampaignRow,
  recipient: RecipientRow,
  now: Date,
  fetcher: typeof fetch,
): Promise<"SENT" | "FAILED" | "SKIPPED" | "RETRY"> {
  const config = lifecycleConfig(env);
  const current = isoNow(now);

  // The snapshot was taken at approval time. Re-check the things that must be
  // true at the moment of sending, not the moment of approval.
  const gapCutoff = new Date(now.getTime() - config.campaignMinGapDays * 86_400_000).toISOString();
  const live = await env.DB.prepare(
    `SELECT c.consent_state,
            (SELECT COUNT(*) FROM suppressions s WHERE s.email_hash = c.email_hash AND s.active = 1) AS suppressed,
            (SELECT COUNT(*) FROM campaign_recipients r
              WHERE r.email_hash = c.email_hash AND r.campaign_id <> ?
                AND r.sent_at IS NOT NULL AND r.sent_at >= ?) AS recent_campaigns
     FROM customers c WHERE c.email_hash = ?`,
  ).bind(campaign.campaign_id, gapCutoff, recipient.email_hash).first<{
    consent_state: string;
    suppressed: number;
    recent_campaigns: number;
  }>();
  const skip = !live
    ? "customer_row_missing"
    : Number(live.suppressed) > 0
      ? "suppressed"
      : campaign.kind === "marketing" && !["SUBSCRIBED", "NOT_SUBSCRIBED"].includes(live.consent_state)
        ? `consent_${live.consent_state.toLowerCase()}`
        // Two campaigns approved close together must not both land on the same
        // person. Lifecycle mail is deliberately not counted here.
        : campaign.kind === "marketing" && Number(live.recent_campaigns) > 0
          ? "frequency_cap"
          : !canDispatchTo(env, recipient.email)
            ? "recipient_not_allowed_in_current_mode"
            : null;
  if (skip) {
    await env.DB.prepare(
      `UPDATE campaign_recipients SET status = 'SKIPPED', skip_reason = ?
       WHERE campaign_id = ? AND email_hash = ?`,
    ).bind(skip, campaign.campaign_id, recipient.email_hash).run();
    return "SKIPPED";
  }

  await env.DB.prepare(
    `UPDATE campaign_recipients SET status = 'SENDING', attempts = attempts + 1
     WHERE campaign_id = ? AND email_hash = ? AND status = 'QUEUED'`,
  ).bind(campaign.campaign_id, recipient.email_hash).run();

  const rendered = await renderForRecipient(env, campaign, recipient, now);
  const headers: Record<string, string> = {};
  if (rendered.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${rendered.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "novahair-lifecycle-worker/1.0",
        "Idempotency-Key": `campaign:${campaign.campaign_id}:${recipient.email_hash}`.slice(0, 256),
      },
      body: JSON.stringify({
        from: config.resendFrom,
        to: [recipient.email],
        reply_to: config.resendReplyTo || undefined,
        subject: campaign.subject,
        html: rendered.html,
        headers: Object.keys(headers).length ? headers : undefined,
        tags: [{ name: "campaign", value: campaign.slug.slice(0, 50) }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // The outcome is unknown, so retrying could send it twice. Stop instead.
    await env.DB.prepare(
      `UPDATE campaign_recipients SET status = 'FAILED', last_error_code = 'network_outcome_uncertain'
       WHERE campaign_id = ? AND email_hash = ?`,
    ).bind(campaign.campaign_id, recipient.email_hash).run();
    return "FAILED";
  }

  const classification = classifyResendResponse(response.status);
  if (classification === "success") {
    let emailId: string | null = null;
    try { emailId = ((await response.json()) as { id?: string }).id ?? null; } catch { emailId = null; }
    await env.DB.prepare(
      `UPDATE campaign_recipients
       SET status = 'SENT', sent_at = ?, resend_email_id = ?, last_error_code = NULL
       WHERE campaign_id = ? AND email_hash = ?`,
    ).bind(current, emailId, campaign.campaign_id, recipient.email_hash).run();
    // The emails_sent counter is owned by the Resend webhook, so it is not
    // incremented here. last_email_at is, so frequency caps are correct now
    // rather than whenever the webhook lands.
    await env.DB.prepare(
      `UPDATE customers
       SET last_email_at = CASE WHEN last_email_at IS NULL OR ? > last_email_at THEN ? ELSE last_email_at END,
           updated_at = ?
       WHERE email_hash = ?`,
    ).bind(current, current, current, recipient.email_hash).run();
    return "SENT";
  }

  const exhausted = recipient.attempts + 1 >= MAX_ATTEMPTS;
  const retry = classification === "retry" && !exhausted;
  await env.DB.prepare(
    `UPDATE campaign_recipients SET status = ?, last_error_code = ?
     WHERE campaign_id = ? AND email_hash = ?`,
  ).bind(
    retry ? "QUEUED" : "FAILED",
    `resend_http_${response.status}`,
    campaign.campaign_id,
    recipient.email_hash,
  ).run();
  return retry ? "RETRY" : "FAILED";
}

async function refreshCampaignCounts(env: LifecycleEnv, campaignId: string, now: Date): Promise<{
  queued: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const row = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN status IN ('QUEUED', 'SENDING') THEN 1 ELSE 0 END) AS queued,
       SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped
     FROM campaign_recipients WHERE campaign_id = ?`,
  ).bind(campaignId).first<{ queued: number; sent: number; failed: number; skipped: number }>();
  const counts = {
    queued: Number(row?.queued ?? 0),
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
  await env.DB.prepare(
    "UPDATE campaigns SET sent_count = ?, failed_count = ?, skipped_count = ?, updated_at = ? WHERE campaign_id = ?",
  ).bind(counts.sent, counts.failed, counts.skipped, isoNow(now), campaignId).run();
  return counts;
}

export async function dispatchDueCampaigns(
  env: LifecycleEnv,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<{ campaigns: number; sent: number; failed: number; skipped: number; budget: number; reason: string | null }> {
  const current = isoNow(now);
  const config = lifecycleConfig(env);
  const due = await env.DB.prepare(
    `SELECT * FROM campaigns
     WHERE status IN ('APPROVED', 'SENDING')
       AND (send_after IS NULL OR send_after <= ?)
     ORDER BY COALESCE(send_after, approved_at, created_at) ASC
     LIMIT 5`,
  ).bind(current).all<CampaignRow>();
  const campaigns = due.results ?? [];
  if (campaigns.length === 0) return { campaigns: 0, sent: 0, failed: 0, skipped: 0, budget: 0, reason: null };

  const budget = await campaignBudget(env, now);
  let remaining = budget.allowed;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const campaign of campaigns) {
    if (remaining <= 0) break;
    if (!config.resendApiKey || !config.resendFrom) break;
    if (campaign.status === "APPROVED") {
      await env.DB.prepare(
        "UPDATE campaigns SET status = 'SENDING', started_at = COALESCE(started_at, ?), updated_at = ? WHERE campaign_id = ?",
      ).bind(current, current, campaign.campaign_id).run();
      campaign.status = "SENDING";
    }
    const batch = await env.DB.prepare(
      `SELECT campaign_id, email_hash, email, first_name, attempts
       FROM campaign_recipients
       WHERE campaign_id = ? AND status = 'QUEUED'
       ORDER BY queued_at ASC LIMIT ?`,
    ).bind(campaign.campaign_id, remaining).all<RecipientRow>();

    for (const recipient of batch.results ?? []) {
      if (remaining <= 0) break;
      let outcome: Awaited<ReturnType<typeof sendOne>>;
      try {
        outcome = await sendOne(env, campaign, recipient, now, fetcher);
      } catch (error) {
        const code = error instanceof Error ? error.message : "campaign_send_failed";
        await recordLifecycleError(env.DB, {
          component: "campaign_send",
          code: code.slice(0, 100),
          safeMessage: "A campaign email could not be sent; the campaign will continue on the next tick.",
          retryable: true,
          now: current,
        });
        await env.DB.prepare(
          `UPDATE campaign_recipients SET status = 'FAILED', last_error_code = 'campaign_send_exception'
           WHERE campaign_id = ? AND email_hash = ?`,
        ).bind(campaign.campaign_id, recipient.email_hash).run();
        outcome = "FAILED";
      }
      // Only a real send consumes quota; skips and failures do not.
      if (outcome === "SENT") { sent += 1; remaining -= 1; }
      else if (outcome === "FAILED") failed += 1;
      else if (outcome === "SKIPPED") skipped += 1;
    }

    const counts = await refreshCampaignCounts(env, campaign.campaign_id, now);
    if (counts.queued === 0) {
      await env.DB.prepare(
        "UPDATE campaigns SET status = 'SENT', completed_at = ?, updated_at = ? WHERE campaign_id = ? AND status = 'SENDING'",
      ).bind(current, current, campaign.campaign_id).run();
    }
  }

  await setHealth(
    env.DB,
    "campaign_dispatch_status",
    JSON.stringify({ campaigns: campaigns.length, sent, failed, skipped, budget: budget.allowed, reason: budget.reason }),
    failed > 0 ? "DEGRADED" : "OK",
    current,
  );
  return { campaigns: campaigns.length, sent, failed, skipped, budget: budget.allowed, reason: budget.reason };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
export async function campaignReport(env: LifecycleEnv, campaignId: string): Promise<Record<string, unknown>> {
  const campaign = await getCampaign(env, campaignId);
  if (!campaign) return { ok: false, error: "campaign_not_found" };
  const stats = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) AS sent,
       SUM(CASE WHEN status IN ('QUEUED', 'SENDING') THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'SKIPPED' THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) AS opened,
       SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked,
       SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) AS unsubscribed
     FROM campaign_recipients WHERE campaign_id = ?`,
  ).bind(campaignId).first<Record<string, number>>();
  const skips = await env.DB.prepare(
    `SELECT skip_reason AS reason, COUNT(*) AS n FROM campaign_recipients
     WHERE campaign_id = ? AND status = 'SKIPPED' GROUP BY skip_reason ORDER BY n DESC LIMIT 10`,
  ).bind(campaignId).all<{ reason: string | null; n: number }>();
  // Orders placed by people this campaign reached, after it reached them.
  const orders = await env.DB.prepare(
    `SELECT COUNT(*) AS orders FROM campaign_recipients r
     JOIN lifecycle_orders o ON o.email_hash = r.email_hash
     WHERE r.campaign_id = ? AND r.sent_at IS NOT NULL
       AND o.completed_at IS NOT NULL AND o.completed_at >= r.sent_at`,
  ).bind(campaignId).first<{ orders: number }>();

  const sent = Number(stats?.sent ?? 0);
  const rate = (value: number) => (sent > 0 ? Math.round((value / sent) * 1000) / 10 : 0);
  return {
    ok: true,
    campaign: {
      campaignId: campaign.campaign_id,
      name: campaign.name,
      slug: campaign.slug,
      segmentId: campaign.segment_id,
      subject: campaign.subject,
      kind: campaign.kind,
      status: campaign.status,
      proposedBy: campaign.proposed_by,
      proposalReason: campaign.proposal_reason,
      approvedBy: campaign.approved_by,
      approvedAt: campaign.approved_at,
      startedAt: campaign.started_at,
      completedAt: campaign.completed_at,
    },
    audience: {
      total: Number(stats?.total ?? 0),
      sent,
      pending: Number(stats?.pending ?? 0),
      failed: Number(stats?.failed ?? 0),
      skipped: Number(stats?.skipped ?? 0),
      skipReasons: (skips.results ?? []).map((row) => ({ reason: row.reason ?? "unknown", count: Number(row.n) })),
    },
    engagement: {
      opened: Number(stats?.opened ?? 0),
      clicked: Number(stats?.clicked ?? 0),
      unsubscribed: Number(stats?.unsubscribed ?? 0),
      openRate: rate(Number(stats?.opened ?? 0)),
      clickRate: rate(Number(stats?.clicked ?? 0)),
      unsubscribeRate: rate(Number(stats?.unsubscribed ?? 0)),
      ordersAfterSend: Number(orders?.orders ?? 0),
    },
  };
}

// ---------------------------------------------------------------------------
// The proposal brief. Everything an agent needs before it writes a campaign,
// in one read: how much room there is to send, who is actually reachable, what
// already went out, and the rules that are enforced whether it follows them or
// not. A proposal written without this is guessing.
// ---------------------------------------------------------------------------
const BRIEF_SEGMENTS: Array<{ key: string; filter: Record<string, unknown> }> = [
  { key: "reachable_total", filter: {} },
  { key: "explicitly_subscribed", filter: { consent: ["SUBSCRIBED"] } },
  { key: "never_asked", filter: { consent: ["NOT_SUBSCRIBED"] } },
  { key: "bought_last_30d", filter: { orderedWithinDays: 30 } },
  { key: "lapsed_90d", filter: { lastOrderOlderThanDays: 90 } },
  { key: "repeat_buyers", filter: { minOrders: 2 } },
  { key: "one_time_buyers", filter: { minOrders: 1, maxOrders: 1 } },
  { key: "never_ordered", filter: { neverOrdered: true } },
  { key: "novahair_buyers", filter: { novahairBuyer: true } },
  { key: "engaged_score_40_plus", filter: { minScore: 40 } },
  { key: "opened_last_90d", filter: { openedWithinDays: 90 } },
];

export async function campaignBrief(env: LifecycleEnv, now = new Date()): Promise<Record<string, unknown>> {
  const config = lifecycleConfig(env);
  const budget = await campaignBudget(env, now);
  const usage = await usageSnapshot(env.DB, now, usageLimitsFor(env));
  const threshold = usageThresholds(usage.limits);

  const audience: Record<string, number> = {};
  for (const entry of BRIEF_SEGMENTS) {
    const compiled = compileSegment(parseSegmentFilter(entry.filter), now);
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT c.email_hash FROM customers c WHERE ${compiled.where} LIMIT ?)`,
    ).bind(...compiled.binds, compiled.limit).first<{ n: number }>();
    audience[entry.key] = Number(row?.n ?? 0);
  }

  const excluded = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM customers) AS customers,
       (SELECT COUNT(*) FROM customers WHERE consent_state = 'UNSUBSCRIBED') AS unsubscribed,
       (SELECT COUNT(*) FROM suppressions WHERE active = 1) AS suppressed,
       (SELECT COUNT(*) FROM customers WHERE email IS NULL OR email = '') AS no_email`,
  ).first<Record<string, number>>();

  const recent = await env.DB.prepare(
    `SELECT campaign_id, name, subject, status, recipients_total, sent_count,
            skipped_count, approved_at, completed_at
     FROM campaigns
     WHERE status IN ('APPROVED', 'SENDING', 'SENT')
     ORDER BY COALESCE(completed_at, approved_at, created_at) DESC LIMIT 10`,
  ).all<Record<string, unknown>>();

  const gapCutoff = new Date(now.getTime() - config.campaignMinGapDays * 86_400_000).toISOString();
  const recentlyMailed = await env.DB.prepare(
    "SELECT COUNT(DISTINCT email_hash) AS n FROM campaign_recipients WHERE sent_at >= ?",
  ).bind(gapCutoff).first<{ n: number }>();

  return {
    ok: true,
    capacity: {
      perTick: budget.allowed,
      reason: budget.reason,
      dailyCampaignCeiling: budget.dayCeiling,
      sentToday: usage.dayEmails,
      sentThisMonth: usage.monthEmails,
      remainingToday: Math.max(0, budget.dayCeiling - usage.dayEmails),
      remainingThisMonth: Math.max(0, threshold.monthCritical - usage.monthEmails),
      planLimits: usage.limits,
      lifecycleReservePerDay: config.campaignLifecycleReserve,
      // At this rate, a campaign of N people takes N / remainingToday days.
      note: "A campaign larger than remainingThisMonth cannot finish this month.",
    },
    audience,
    excludedFromEveryCampaign: {
      unsubscribed: Number(excluded?.unsubscribed ?? 0),
      suppressed: Number(excluded?.suppressed ?? 0),
      noEmail: Number(excluded?.no_email ?? 0),
      totalCustomers: Number(excluded?.customers ?? 0),
    },
    frequency: {
      minGapDays: config.campaignMinGapDays,
      peopleMailedInsideTheGap: Number(recentlyMailed?.n ?? 0),
      note: "Anyone in that group is skipped at send time, whatever the segment says.",
    },
    recentCampaigns: recent.results ?? [],
    // Enforced in code, not advice: a proposal that breaks one is rejected.
    enforcedRules: [
      "A marketing campaign must contain {{UNSUBSCRIBE_URL}} or it cannot be created.",
      "A CTA link must be https and on the storefront, shop, or worker domain.",
      "A segment filter is an allowlist; unknown keys are rejected, never ignored.",
      "No campaign reaches UNSUBSCRIBED, REDACTED, suppressed or address-less people.",
      "Nothing sends from DRAFT: a human approval is required to build the audience.",
      "Consent and suppression are re-checked per recipient at the moment of sending.",
      `No one receives two campaign emails within ${config.campaignMinGapDays} days.`,
    ],
    // Brand rules the code cannot check. The proposer is responsible for these.
    brandRules: [
      "Write Hebrew for an Israeli reader, RTL, second person female.",
      "Sign as סיוון מ-NovaHair by TigerBrandsGlobal.",
      "No em-dashes anywhere in the copy.",
      "No health or medical claims, and no claim of regulatory approval.",
      "No invented reviews, statistics, scarcity or deadlines.",
      "Say אפשר rather than ניתן.",
    ],
  };
}

export async function listCampaigns(env: LifecycleEnv, url: URL): Promise<Record<string, unknown>> {
  const status = url.searchParams.get("status")?.toUpperCase() ?? "";
  const valid = ["DRAFT", "APPROVED", "SENDING", "SENT", "REJECTED", "CANCELLED"];
  const rows = valid.includes(status)
    ? await env.DB.prepare(
      `SELECT campaign_id, name, slug, segment_id, subject, kind, status, send_after,
              recipients_total, sent_count, failed_count, skipped_count, proposed_by,
              proposal_reason, approved_at, completed_at, created_at
       FROM campaigns WHERE status = ? ORDER BY created_at DESC LIMIT 100`,
    ).bind(status).all<Record<string, unknown>>()
    : await env.DB.prepare(
      `SELECT campaign_id, name, slug, segment_id, subject, kind, status, send_after,
              recipients_total, sent_count, failed_count, skipped_count, proposed_by,
              proposal_reason, approved_at, completed_at, created_at
       FROM campaigns ORDER BY created_at DESC LIMIT 100`,
    ).all<Record<string, unknown>>();
  return { ok: true, campaigns: rows.results ?? [] };
}

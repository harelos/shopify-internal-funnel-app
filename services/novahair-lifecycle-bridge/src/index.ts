import { lifecycleConfig, lifecycleMode } from "./config";
import { lifecycleAnalytics, lifecycleAudienceActivity, lifecycleFlowCatalog } from "./analytics";
import {
  applyUnsubscribe,
  approveCampaign,
  campaignBrief,
  campaignReport,
  createCampaign,
  listCampaigns,
  setCampaignStatus,
} from "./campaigns";
import { decryptSensitive, hashPayload } from "./crypto";
import { customerDirectory } from "./customers";
import { listSegments, parseSegmentFilter, previewSegment, saveSegment } from "./segments";
import { dispatchDueLifecycleEvents } from "./dispatch";
import { consumeClickToken, isoNow, setHealth } from "./db";
import { isLifecycleAdmin, lifecycleHealth } from "./health";
import {
  brandedTrackingDestination,
  safeCompletedCheckoutDestination,
  staticLifecycleDestination,
} from "./lifecycle-links";
import { dispatchResendContactUpdates } from "./resend";
import {
  ensureLifecycleWebhooks,
  syncAbandonedCheckouts,
  syncCustomerConsent,
  syncPaidOrders,
} from "./shopify";
import { handleResendWebhook } from "./webhooks";
import type { LifecycleEnv } from "./types";
import type { ClickTokenRow } from "./db";
import { appendLifecycleUtm } from "./url";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function currentClickDestination(
  env: LifecycleEnv,
  row: ClickTokenRow,
  storedTarget: string,
): Promise<string> {
  const config = lifecycleConfig(env);
  if (row.flow === "abandoned_checkout") {
    const checkout = await env.DB.prepare(
      "SELECT state, completed_at FROM abandoned_checkouts WHERE shopify_checkout_id = ?",
    ).bind(row.entity_id).first<{ state: string; completed_at: string | null }>();
    if (checkout && (checkout.completed_at || checkout.state !== "ABANDONED")) {
      return safeCompletedCheckoutDestination(config.storefrontDomain);
    }
    return storedTarget;
  }
  if (row.flow === "post_purchase" && (row.email_number === 3 || row.email_number === 4)) {
    const order = await env.DB.prepare(
      `SELECT tracking_number_encrypted, tracking_url_encrypted
       FROM lifecycle_orders WHERE shopify_order_id = ?`,
    ).bind(row.entity_id).first<{
      tracking_number_encrypted: string | null;
      tracking_url_encrypted: string | null;
    }>();
    const trackingNumber = order?.tracking_number_encrypted
      ? await decryptSensitive(order.tracking_number_encrypted, config.dataKey).catch(() => null)
      : null;
    if (trackingNumber) return brandedTrackingDestination(config.storefrontDomain, trackingNumber);
    const carrierUrl = order?.tracking_url_encrypted
      ? await decryptSensitive(order.tracking_url_encrypted, config.dataKey).catch(() => null)
      : null;
    if (carrierUrl && /^https:\/\//i.test(carrierUrl)) return carrierUrl;
    return staticLifecycleDestination(config.storefrontDomain, "post_purchase", 6)
      ?? safeCompletedCheckoutDestination(config.storefrontDomain);
  }
  return staticLifecycleDestination(config.storefrontDomain, row.flow, row.email_number) ?? storedTarget;
}

async function handleClick(env: LifecycleEnv, token: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const row = await consumeClickToken(env.DB, token);
  if (!row) return new Response("Link expired", { status: 410 });
  const storedTarget = await decryptSensitive(row.target_url, lifecycleConfig(env).dataKey);
  const currentTarget = await currentClickDestination(env, row, storedTarget);
  const target = appendLifecycleUtm(currentTarget, row.flow, row.utm_content, row.utm_campaign).url;
  const parsed = new URL(target);
  if (
    parsed.searchParams.get("utm_source") !== "resend"
    || parsed.searchParams.get("utm_medium") !== "email"
    || parsed.searchParams.get("utm_campaign") !== row.utm_campaign
    || parsed.searchParams.get("utm_content") !== row.utm_content
  ) {
    await setHealth(env.DB, "click_redirect_status", "utm_validation_failed", "ERROR");
    return new Response("Link unavailable", { status: 503 });
  }
  const now = isoNow();
  const attributionKey = `click:${token}`;
  // A campaign click token carries its recipient in the entity id, so it needs
  // no automation_tracking row to be attributable.
  const campaignRecipientHash = row.entity_type === "campaign"
    ? row.entity_id.split(":")[1] ?? null
    : null;
  if (campaignRecipientHash) {
    await env.DB.prepare(
      `UPDATE campaign_recipients SET clicked_at = COALESCE(clicked_at, ?)
       WHERE campaign_id = ? AND email_hash = ?`,
    ).bind(now, row.entity_id.split(":")[0] ?? "", campaignRecipientHash).run();
  }
  const tracking = await env.DB.prepare(
    `SELECT recipient_hash, template_id, automation_id, resend_email_id, sent_at
     FROM automation_tracking
     WHERE entity_type = ? AND entity_id = ? AND flow = ? AND email_number = ?
     ORDER BY COALESCE(triggered_at, scheduled_at, created_at) DESC
     LIMIT 1`,
  ).bind(row.entity_type, row.entity_id, row.flow, row.email_number).first<{
    recipient_hash: string | null;
    template_id: string | null;
    automation_id: string | null;
    resend_email_id: string | null;
    sent_at: string | null;
  }>();
  await env.DB.prepare(
    `INSERT INTO lifecycle_attribution (
       attribution_key, source, flow, email_number, template_id, automation_id,
       resend_email_id, shopify_checkout_id, utm_campaign, utm_content, sent_at,
       clicked_at, entity_type, entity_id, recipient_hash, created_at, updated_at
     ) VALUES (?, 'FIRST_PARTY_CLICK', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(attribution_key) DO UPDATE SET
       template_id = COALESCE(excluded.template_id, lifecycle_attribution.template_id),
       automation_id = COALESCE(excluded.automation_id, lifecycle_attribution.automation_id),
       resend_email_id = COALESCE(excluded.resend_email_id, lifecycle_attribution.resend_email_id),
       sent_at = COALESCE(excluded.sent_at, lifecycle_attribution.sent_at),
       clicked_at = excluded.clicked_at,
       entity_type = excluded.entity_type,
       entity_id = excluded.entity_id,
       recipient_hash = COALESCE(excluded.recipient_hash, lifecycle_attribution.recipient_hash),
       updated_at = excluded.updated_at`,
  ).bind(
    attributionKey,
    row.flow,
    row.email_number,
    tracking?.template_id ?? null,
    tracking?.automation_id ?? null,
    tracking?.resend_email_id ?? null,
    row.entity_type === "checkout" ? row.entity_id : null,
    row.utm_campaign,
    row.utm_content,
    tracking?.sent_at ?? null,
    now,
    row.entity_type,
    row.entity_id,
    tracking?.recipient_hash ?? campaignRecipientHash,
    now,
    now,
  ).run();
  return new Response(null, {
    status: 303,
    headers: {
      Location: parsed.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

// ---------------------------------------------------------------------------
// Unsubscribe. GET shows a page with one button; POST performs it, which is
// also what Gmail's one-click List-Unsubscribe-Post sends.
// ---------------------------------------------------------------------------
function unsubscribePage(title: string, body: string, buttonToken?: string): Response {
  const button = buttonToken
    ? `<form method="post" action="/api/lifecycle/u/${buttonToken}">
         <button type="submit">להסיר אותי מהרשימה</button>
       </form>`
    : "";
  return new Response(
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<style>
  body{margin:0;background:#faf7f4;color:#1d1a17;font-family:Arial,Helvetica,sans-serif;
       display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border:1px solid #e8e0d8;border-radius:14px;padding:28px;max-width:440px;width:100%;
        box-shadow:0 2px 12px rgba(0,0,0,.05)}
  h1{font-size:20px;margin:0 0 12px}
  p{font-size:15px;line-height:1.7;margin:0 0 18px;color:#4a443e}
  button{background:#1d1a17;color:#fff;border:0;border-radius:8px;padding:13px 22px;font-size:15px;
         cursor:pointer;width:100%}
  .brand{font-size:12px;letter-spacing:.12em;color:#8b8179;margin:0 0 20px}
</style></head><body><div class="card">
<p class="brand">TIGERBRANDSGLOBAL</p><h1>${title}</h1><p>${body}</p>${button}
</div></body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function handleUnsubscribeRoute(
  env: LifecycleEnv,
  token: string,
  method: string,
): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return new Response("Not found", { status: 404 });
  if (method === "GET") {
    const known = await env.DB.prepare(
      "SELECT 1 AS found FROM customers WHERE unsubscribe_token = ?",
    ).bind(token).first<{ found: number }>();
    if (!known) {
      return unsubscribePage("הקישור כבר לא פעיל", "אפשר לכתוב לנו ונטפל בזה ידנית.");
    }
    return unsubscribePage(
      "להפסיק לקבל מיילים שיווקיים?",
      "עדכוני הזמנה ומשלוח ימשיכו להישלח, כי הם חלק מהשירות על הזמנה שכבר בוצעה.",
      token,
    );
  }
  const result = await applyUnsubscribe(env, token);
  if (!result.ok) return unsubscribePage("הקישור כבר לא פעיל", "אפשר לכתוב לנו ונטפל בזה ידנית.");
  return unsubscribePage(
    result.alreadyUnsubscribed ? "כבר הסרנו אותך קודם" : "הוסרת מהרשימה",
    "לא נשלח לך יותר מיילים שיווקיים. עדכונים על הזמנה פעילה עדיין יגיעו.",
  );
}

// ---------------------------------------------------------------------------
// Segment and campaign administration. Everything here is behind the admin
// token; the only public surfaces this feature adds are the click redirect and
// the unsubscribe page.
// ---------------------------------------------------------------------------
async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("body_invalid");
    return body as Record<string, unknown>;
  } catch {
    throw new Error("body_invalid");
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function campaignAdminRoute(env: LifecycleEnv, request: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  try {
    if (path === "/api/lifecycle/admin/segments" && method === "GET") {
      return json(await listSegments(env));
    }
    if (path === "/api/lifecycle/admin/segments/preview" && method === "POST") {
      const body = await readJson(request);
      const filter = parseSegmentFilter(body.filter);
      return json({ ok: true, filter, ...(await previewSegment(env, filter)) });
    }
    if (path === "/api/lifecycle/admin/segments" && method === "POST") {
      const body = await readJson(request);
      const saved = await saveSegment(env, {
        name: text(body.name),
        description: text(body.description) || null,
        filter: body.filter,
        createdBy: text(body.createdBy) || "ADMIN",
      });
      return json({ ok: true, ...saved });
    }
    if (path === "/api/lifecycle/admin/campaigns/brief" && method === "GET") {
      return json(await campaignBrief(env));
    }
    if (path === "/api/lifecycle/admin/campaigns" && method === "GET") {
      return json(await listCampaigns(env, url));
    }
    if (path === "/api/lifecycle/admin/campaigns" && method === "POST") {
      const body = await readJson(request);
      return json(await createCampaign(env, {
        name: text(body.name),
        segmentId: text(body.segmentId),
        subject: text(body.subject),
        preheader: text(body.preheader) || null,
        html: text(body.html),
        ctaUrl: text(body.ctaUrl) || null,
        kind: body.kind === "transactional" ? "transactional" : "marketing",
        sendAfter: text(body.sendAfter) || null,
        maxRecipients: typeof body.maxRecipients === "number" ? body.maxRecipients : null,
        proposedBy: text(body.proposedBy) || "ADMIN",
        proposalReason: text(body.proposalReason) || null,
      }), 201);
    }
    const action = path.match(/^\/api\/lifecycle\/admin\/campaigns\/([A-Za-z0-9_.-]+)(?:\/(approve|reject|cancel))?$/);
    if (action) {
      const campaignId = action[1] ?? "";
      const verb = action[2];
      if (!verb && method === "GET") return json(await campaignReport(env, campaignId));
      if (verb === "approve" && method === "POST") {
        const body = await readJson(request);
        return json(await approveCampaign(env, campaignId, text(body.approvedBy) || "ADMIN"));
      }
      if (verb === "reject" && method === "POST") {
        const body = await readJson(request);
        return json(await setCampaignStatus(env, campaignId, "REJECTED", text(body.reason) || null));
      }
      if (verb === "cancel" && method === "POST") {
        const body = await readJson(request);
        return json(await setCampaignStatus(env, campaignId, "CANCELLED", text(body.reason) || null));
      }
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (error) {
    const code = error instanceof Error ? error.message : "campaign_admin_failed";
    const clientError = /^(segment_|campaign_invalid_|campaign_not_|campaign_cannot_|body_invalid|segment_name_invalid)/.test(code);
    return json({ ok: false, error: code.slice(0, 120) }, clientError ? 400 : 500);
  }
}

async function registerResources(env: LifecycleEnv, request: Request): Promise<Response> {
  const body = await request.json() as {
    resources?: Array<{
      resourceType?: string;
      name?: string;
      externalId?: string;
      status?: string;
      metadata?: Record<string, unknown>;
    }>;
  };
  const resources = body.resources ?? [];
  if (resources.length > 100) return json({ ok: false, error: "too_many_resources" }, 400);
  const now = isoNow();
  for (const resource of resources) {
    const type = resource.resourceType?.toUpperCase() ?? "";
    if (!["EVENT", "TEMPLATE", "AUTOMATION", "WEBHOOK", "DOMAIN"].includes(type)) {
      return json({ ok: false, error: "invalid_resource_type" }, 400);
    }
    if (!resource.name || !resource.externalId || !resource.status) {
      return json({ ok: false, error: "missing_resource_field" }, 400);
    }
    await env.DB.prepare(
      `INSERT INTO resend_resources
        (resource_type, name, external_id, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(resource_type, name) DO UPDATE SET
         external_id = excluded.external_id,
         status = excluded.status,
         metadata_json = excluded.metadata_json,
         updated_at = excluded.updated_at`,
    ).bind(
      type,
      resource.name.slice(0, 160),
      resource.externalId.slice(0, 160),
      resource.status.slice(0, 40),
      resource.metadata ? JSON.stringify(resource.metadata) : null,
      now,
      now,
    ).run();
  }
  return json({ ok: true, registered: resources.length });
}

export async function handleLifecycleRequest(
  request: Request,
  env: LifecycleEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname.startsWith("/api/lifecycle/click/")) {
    return handleClick(env, url.pathname.slice("/api/lifecycle/click/".length));
  }
  if (request.method === "POST" && url.pathname === "/api/lifecycle/webhooks/resend") {
    return handleResendWebhook(env, request);
  }
  if (url.pathname === "/api/lifecycle/health" && request.method === "GET") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    return json(await lifecycleHealth(env));
  }
  if (url.pathname === "/api/lifecycle/admin/flows" && request.method === "GET") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    return json(await lifecycleFlowCatalog(env));
  }
  if (url.pathname === "/api/lifecycle/admin/customers" && request.method === "GET") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    return json(await customerDirectory(env, url));
  }
  if (url.pathname.startsWith("/api/lifecycle/u/") && ["GET", "POST"].includes(request.method)) {
    return handleUnsubscribeRoute(env, url.pathname.slice("/api/lifecycle/u/".length), request.method);
  }
  if (url.pathname.startsWith("/api/lifecycle/admin/segments")) {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    return campaignAdminRoute(env, request, url);
  }
  if (url.pathname.startsWith("/api/lifecycle/admin/campaigns")) {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    return campaignAdminRoute(env, request, url);
  }
  if (url.pathname === "/api/lifecycle/admin/analytics" && request.method === "GET") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    try {
      return json(await lifecycleAnalytics(env, url));
    } catch (error) {
      const code = error instanceof Error ? error.message : "analytics_failed";
      return json({ ok: false, error: code.slice(0, 100) }, code === "analytics_invalid_range" ? 400 : 500);
    }
  }
  if (url.pathname === "/api/lifecycle/admin/audience" && request.method === "GET") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    try {
      return json(await lifecycleAudienceActivity(env, url));
    } catch (error) {
      const code = error instanceof Error ? error.message : "audience_failed";
      return json({ ok: false, error: code.slice(0, 100) }, code.startsWith("audience_invalid_") ? 400 : 500);
    }
  }
  if (url.pathname === "/api/lifecycle/admin/run" && request.method === "POST") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    if (lifecycleMode(env) === "production") return json({ ok: false, error: "manual_run_disabled_in_production" }, 409);
    const sync = {
      abandonedCheckouts: await syncAbandonedCheckouts(env),
      paidOrders: await syncPaidOrders(env),
      customerConsent: await syncCustomerConsent(env),
      resendContacts: await dispatchResendContactUpdates(env),
    };
    const dispatch = await dispatchDueLifecycleEvents(env);
    return json({ ok: true, sync, dispatch });
  }
  if (url.pathname === "/api/lifecycle/admin/resources" && request.method === "POST") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    return registerResources(env, request);
  }
  if (url.pathname === "/api/lifecycle/admin/shopify-webhooks" && request.method === "POST") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    try {
      return json({ ok: true, ...(await ensureLifecycleWebhooks(env)) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "shopify_webhook_setup_failed";
      return json({ ok: false, error: code.slice(0, 120) }, 422);
    }
  }
  if (url.pathname === "/api/lifecycle/admin/correlation-proof" && request.method === "GET") {
    if (!isLifecycleAdmin(request, env)) return new Response("Not found", { status: 404 });
    const proof = await env.DB.prepare(
      `SELECT email_hash, COUNT(*) AS checkout_count,
              SUM(CASE WHEN state = 'RECOVERED' THEN 1 ELSE 0 END) AS recovered_count,
              SUM(CASE WHEN state = 'ABANDONED' THEN 1 ELSE 0 END) AS abandoned_count
       FROM abandoned_checkouts
       GROUP BY email_hash HAVING checkout_count >= 2
       ORDER BY checkout_count DESC LIMIT 20`,
    ).all<{ email_hash: string; checkout_count: number; recovered_count: number; abandoned_count: number }>();
    return json({
      ok: true,
      groups: (proof.results ?? []).map(row => ({
        correlationKey: (row.email_hash ? row.email_hash.slice(0, 12) : "none"),
        checkouts: row.checkout_count,
        recovered: row.recovered_count,
        abandoned: row.abandoned_count,
      })),
    });
  }
  return null;
}

export async function lifecycleDiagnosticFingerprint(value: unknown): Promise<string> {
  return hashPayload(value);
}

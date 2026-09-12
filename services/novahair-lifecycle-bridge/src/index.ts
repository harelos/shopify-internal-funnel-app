import { lifecycleConfig, lifecycleMode } from "./config";
import { lifecycleAnalytics, lifecycleAudienceActivity, lifecycleFlowCatalog } from "./analytics";
import { decryptSensitive, hashPayload } from "./crypto";
import { dispatchDueLifecycleEvents } from "./dispatch";
import { consumeClickToken, isoNow, setHealth } from "./db";
import { isLifecycleAdmin, lifecycleHealth } from "./health";
import { dispatchResendContactUpdates } from "./resend";
import {
  ensureLifecycleWebhooks,
  syncAbandonedCheckouts,
  syncCustomerConsent,
  syncPaidOrders,
} from "./shopify";
import { handleResendWebhook } from "./webhooks";
import type { LifecycleEnv } from "./types";

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function handleClick(env: LifecycleEnv, token: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return new Response("Not found", { status: 404 });
  const row = await consumeClickToken(env.DB, token);
  if (!row) return new Response("Link expired", { status: 410 });
  const target = await decryptSensitive(row.target_url, lifecycleConfig(env).dataKey);
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
    tracking?.recipient_hash ?? null,
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
    return json(await lifecycleAudienceActivity(env, url));
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

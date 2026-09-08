import { lifecycleConfig } from "./config";
import { constantTimeEqual } from "./crypto";
import { healthValue, usageSnapshot } from "./db";
import type { D1Database, LifecycleEnv } from "./types";

function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export function isLifecycleAdmin(request: Request, env: LifecycleEnv): boolean {
  const expected = lifecycleConfig(env).adminToken;
  const supplied = bearerToken(request);
  return Boolean(expected && supplied && constantTimeEqual(expected, supplied));
}

async function scalar(db: D1Database, query: string, ...values: unknown[]): Promise<number> {
  const row = await db.prepare(query).bind(...values).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function lifecycleHealth(env: LifecycleEnv, now = new Date()): Promise<Record<string, unknown>> {
  const config = lifecycleConfig(env);
  const since24h = new Date(now.getTime() - 86_400_000).toISOString();
  const [
    lastShopifySync,
    lastShopifyOrdersSync,
    lastShopifyConsentSync,
    lastShopifyApi,
    shopifySyncStatus,
    shopifyOrdersSyncStatus,
    shopifyConsentSyncStatus,
    lastResendEvent,
    lastResendWebhook,
    resendContactSyncStatus,
    dispatchStatus,
    abandonedTracked,
    triggers24h,
    emails24h,
    recoveries24h,
    openErrors,
    deadSchedules,
    uncertainEvents,
    pendingContactUpdates,
    templates,
    automations,
    webhooks,
    verifiedDomains,
    quota,
  ] = await Promise.all([
    healthValue(env.DB, "last_shopify_sync"),
    healthValue(env.DB, "last_shopify_orders_sync"),
    healthValue(env.DB, "last_shopify_consent_sync"),
    healthValue(env.DB, "last_successful_shopify_api_call"),
    healthValue(env.DB, "shopify_sync_status"),
    healthValue(env.DB, "shopify_orders_sync_status"),
    healthValue(env.DB, "shopify_consent_sync_status"),
    healthValue(env.DB, "last_resend_event"),
    healthValue(env.DB, "last_resend_webhook"),
    healthValue(env.DB, "resend_contact_sync_status"),
    healthValue(env.DB, "lifecycle_dispatch_status"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM abandoned_checkouts WHERE state = 'ABANDONED'"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_events WHERE event_name = 'shopify.checkout_abandoned' AND sent_at >= ?", since24h),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM email_delivery_events WHERE event_type = 'email.sent' AND occurred_at >= ?", since24h),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM abandoned_checkouts WHERE completed_at >= ?", since24h),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM lifecycle_errors WHERE resolved_at IS NULL"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM scheduled_lifecycle_events WHERE status = 'DEAD'"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_events WHERE status = 'UNCERTAIN'"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_contact_updates WHERE status IN ('PENDING', 'RETRY', 'DEAD')"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_resources WHERE resource_type = 'TEMPLATE'"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_resources WHERE resource_type = 'AUTOMATION'"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_resources WHERE resource_type = 'WEBHOOK' AND UPPER(status) = 'ENABLED'"),
    scalar(env.DB, "SELECT COUNT(*) AS count FROM resend_resources WHERE resource_type = 'DOMAIN' AND UPPER(status) = 'VERIFIED'"),
    usageSnapshot(env.DB, now),
  ]);
  const degraded = openErrors > 0 || deadSchedules > 0 || uncertainEvents > 0 || pendingContactUpdates > 0 || quota.critical;
  return {
    status: degraded ? "degraded" : "ok",
    workerAlive: true,
    checkedAt: now.toISOString(),
    mode: config.mode,
    enabled: config.enabled,
    connections: {
      shopifyConfigured: Boolean(config.shopDomain && config.shopifyAccessToken),
      resendConfigured: Boolean(config.resendApiKey),
      resendWebhookVerificationConfigured: Boolean(config.resendWebhookSecret),
    },
    shopify: {
      lastSync: lastShopifySync,
      lastOrderSync: lastShopifyOrdersSync,
      lastConsentSync: lastShopifyConsentSync,
      lastSuccessfulApiCall: lastShopifyApi,
      syncStatus: shopifySyncStatus,
      orderSyncStatus: shopifyOrdersSyncStatus,
      consentSyncStatus: shopifyConsentSyncStatus,
    },
    resend: {
      lastEvent: lastResendEvent,
      lastWebhook: lastResendWebhook,
      webhookResources: webhooks,
      templateResources: templates,
      automationResources: automations,
      verifiedSendingDomains: verifiedDomains,
      contactSyncStatus: resendContactSyncStatus,
      quota,
    },
    lifecycle: {
      abandonedCheckoutsTracked: abandonedTracked,
      abandonmentTriggersLast24h: triggers24h,
      emailsSentLast24h: emails24h,
      recoveriesLast24h: recoveries24h,
      openErrors,
      deadSchedules,
      uncertainEvents,
      pendingContactUpdates,
      dispatchStatus,
      browseCartIdentity: "WAITING_FOR_RELIABLE_IDENTITY_LINK_FOR_GENERAL_VISITORS",
    },
  };
}

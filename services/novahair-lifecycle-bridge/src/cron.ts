import { assertCoreConfiguration, lifecycleConfig, lifecycleMode } from "./config";
import { acquireCronLock, healthValue, isoNow, releaseCronLock, setHealth } from "./db";
import { dispatchDueLifecycleEvents } from "./dispatch";
import { monitorResendQuota } from "./quota";
import { dispatchResendContactUpdates } from "./resend";
import { ensureLifecycleWebhooks, syncAbandonedCheckouts, syncCustomerConsent, syncPaidOrders } from "./shopify";
import { reconcilePostPurchaseTransitUpdates } from "./webhooks";
import { processLifecycleIdentityClaims, processStorefrontLifecycleEvents } from "./storefront";
import type { LifecycleEnv, ScheduledControllerLike } from "./types";

function syncIsDue(lastSync: string | null, now: Date, intervalMinutes: number): boolean {
  if (!lastSync) return true;
  const timestamp = new Date(lastSync).getTime();
  return !Number.isFinite(timestamp) || now.getTime() - timestamp >= intervalMinutes * 60_000;
}

async function monitorDeliveryWatch(env: LifecycleEnv, now: Date): Promise<void> {
  const current = isoNow(now);
  const threshold = new Date(now.getTime() - 23 * 86_400_000).toISOString();
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM lifecycle_orders
     WHERE completed_at <= ? AND delivered_at IS NULL`,
  ).bind(threshold).first<{ count: number }>();
  const count = Number(row?.count ?? 0);
  await setHealth(
    env.DB,
    "post_purchase_delivery_watch",
    JSON.stringify({ overdueUndeliveredOrders: count, thresholdDays: 23 }),
    count > 0 ? "WARN" : "OK",
    current,
  );
}

export async function runLifecycleCron(
  env: LifecycleEnv,
  event?: ScheduledControllerLike,
  now = new Date(event?.scheduledTime ?? Date.now()),
): Promise<void> {
  const current = isoNow(now);
  await setHealth(env.DB, "lifecycle_worker_alive", current, "OK", current);
  if (lifecycleMode(env) === "disabled" || env.LIFECYCLE_ENABLED !== "true") {
    await setHealth(env.DB, "lifecycle_runtime_status", "disabled", "PAUSED", current);
    return;
  }
  assertCoreConfiguration(env);
  const owner = crypto.randomUUID();
  const locked = await acquireCronLock(env.DB, "novahair_lifecycle_cron", owner, now, 240);
  if (!locked) return;
  try {
    const config = lifecycleConfig(env);
    const lastWebhookEnsure = await healthValue(env.DB, "last_shopify_webhooks_ensure");
    if (syncIsDue(lastWebhookEnsure, now, 12 * 60)) {
      await ensureLifecycleWebhooks(env);
    }
    const lastSync = await healthValue(env.DB, "last_shopify_sync");
    if (syncIsDue(lastSync, now, config.syncIntervalMinutes)) {
      await syncAbandonedCheckouts(env, now);
    }
    const lastOrderSync = await healthValue(env.DB, "last_shopify_orders_sync");
    if (syncIsDue(lastOrderSync, now, config.syncIntervalMinutes)) {
      await syncPaidOrders(env, now);
      await reconcilePostPurchaseTransitUpdates(env, now);
    }
    const lastConsentSync = await healthValue(env.DB, "last_shopify_consent_sync");
    if (syncIsDue(lastConsentSync, now, config.syncIntervalMinutes)) {
      await syncCustomerConsent(env, now);
    }
    await processLifecycleIdentityClaims(env, now);
    await processStorefrontLifecycleEvents(env, now);
    await dispatchResendContactUpdates(env, now);
    await dispatchDueLifecycleEvents(env, now, owner);
    await monitorDeliveryWatch(env, now);
    await monitorResendQuota(env, now);
    await setHealth(env.DB, "lifecycle_runtime_status", "healthy", "OK", current);
  } finally {
    await releaseCronLock(env.DB, "novahair_lifecycle_cron", owner);
  }
}

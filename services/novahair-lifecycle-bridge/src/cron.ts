import { assertCoreConfiguration, lifecycleConfig, lifecycleMode } from "./config";
import { acquireCronLock, healthValue, isoNow, releaseCronLock, setHealth } from "./db";
import { dispatchDueLifecycleEvents } from "./dispatch";
import { monitorResendQuota } from "./quota";
import { dispatchResendContactUpdates } from "./resend";
import { syncAbandonedCheckouts, syncCustomerConsent, syncPaidOrders } from "./shopify";
import type { LifecycleEnv, ScheduledControllerLike } from "./types";

function syncIsDue(lastSync: string | null, now: Date, intervalMinutes: number): boolean {
  if (!lastSync) return true;
  const timestamp = new Date(lastSync).getTime();
  return !Number.isFinite(timestamp) || now.getTime() - timestamp >= intervalMinutes * 60_000;
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
    const lastSync = await healthValue(env.DB, "last_shopify_sync");
    if (syncIsDue(lastSync, now, config.syncIntervalMinutes)) {
      await syncAbandonedCheckouts(env, now);
    }
    const lastOrderSync = await healthValue(env.DB, "last_shopify_orders_sync");
    if (syncIsDue(lastOrderSync, now, config.syncIntervalMinutes)) {
      await syncPaidOrders(env, now);
    }
    const lastConsentSync = await healthValue(env.DB, "last_shopify_consent_sync");
    if (syncIsDue(lastConsentSync, now, config.syncIntervalMinutes)) {
      await syncCustomerConsent(env, now);
    }
    await dispatchResendContactUpdates(env, now);
    await dispatchDueLifecycleEvents(env, now, owner);
    await monitorResendQuota(env, now);
    await setHealth(env.DB, "lifecycle_runtime_status", "healthy", "OK", current);
  } finally {
    await releaseCronLock(env.DB, "novahair_lifecycle_cron", owner);
  }
}

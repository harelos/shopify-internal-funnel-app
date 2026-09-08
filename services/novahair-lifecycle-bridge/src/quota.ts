import { lifecycleConfig } from "./config";
import { isoNow, setHealth, usageSnapshot } from "./db";
import type { D1Database, LifecycleEnv } from "./types";

function usedQuota(value: string | null): number | null {
  if (!value) return null;
  const match = value.replaceAll(",", "").match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function captureResendQuotaHeaders(
  db: D1Database,
  headers: Headers,
  now = new Date(),
): Promise<void> {
  const dayEmails = usedQuota(headers.get("x-resend-daily-quota"));
  const monthEmails = usedQuota(headers.get("x-resend-monthly-quota"));
  if (dayEmails === null && monthEmails === null) return;
  const dayKey = now.toISOString().slice(0, 10);
  const monthKey = dayKey.slice(0, 7);
  await setHealth(
    db,
    "resend_quota_observed",
    JSON.stringify({ dayKey, monthKey, dayEmails, monthEmails, observedAt: now.toISOString() }),
    "OK",
    now.toISOString(),
  );
}

interface QuotaAlert {
  key: string;
  period: string;
  level: "WARNING" | "CRITICAL";
  label: string;
  used: number;
  limit: number;
}

function alertsFor(snapshot: Awaited<ReturnType<typeof usageSnapshot>>, now: Date): QuotaAlert[] {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  const alerts: QuotaAlert[] = [];
  if (snapshot.dayEmails >= 90) {
    alerts.push({ key: "daily_critical", period: day, level: "CRITICAL", label: "emails/day", used: snapshot.dayEmails, limit: 100 });
  } else if (snapshot.dayEmails >= 70) {
    alerts.push({ key: "daily_warning", period: day, level: "WARNING", label: "emails/day", used: snapshot.dayEmails, limit: 100 });
  }
  if (snapshot.monthEmails >= 2900) {
    alerts.push({ key: "monthly_email_critical", period: month, level: "CRITICAL", label: "emails/month", used: snapshot.monthEmails, limit: 3000 });
  } else if (snapshot.monthEmails >= 2400) {
    alerts.push({ key: "monthly_email_warning", period: month, level: "WARNING", label: "emails/month", used: snapshot.monthEmails, limit: 3000 });
  }
  if (snapshot.monthRuns >= 9800) {
    alerts.push({ key: "monthly_runs_critical", period: month, level: "CRITICAL", label: "automation runs/month", used: snapshot.monthRuns, limit: 10000 });
  } else if (snapshot.monthRuns >= 9000) {
    alerts.push({ key: "monthly_runs_warning", period: month, level: "WARNING", label: "automation runs/month", used: snapshot.monthRuns, limit: 10000 });
  }
  return alerts;
}

async function deliverAlert(
  env: LifecycleEnv,
  alert: QuotaAlert,
  fetcher: typeof fetch,
): Promise<boolean> {
  const config = lifecycleConfig(env);
  if (!config.resendApiKey || !config.resendFrom || !config.alertEmail) return false;
  const subject = `[NovaHair] Resend ${alert.level}: ${alert.used}/${alert.limit} ${alert.label}`;
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "novahair-lifecycle-worker/1.0",
      "Idempotency-Key": `novahair-quota:${alert.key}:${alert.period}`,
    },
    body: JSON.stringify({
      from: config.resendFrom,
      to: [config.alertEmail],
      reply_to: config.resendReplyTo || undefined,
      subject,
      text: `${subject}\n\nLifecycle dispatch remains guarded. Review the private health endpoint before changing any plan.`,
      html: `<div dir="ltr" style="font-family:Arial,sans-serif"><h2>${subject}</h2><p>Lifecycle dispatch remains guarded.</p><p>Review the private health endpoint before changing any plan.</p></div>`,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  await captureResendQuotaHeaders(env.DB, response.headers);
  return response.ok;
}

export async function monitorResendQuota(
  env: LifecycleEnv,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const snapshot = await usageSnapshot(env.DB, now);
  const current = isoNow(now);
  await setHealth(
    env.DB,
    "resend_quota_status",
    JSON.stringify(snapshot),
    snapshot.critical ? "CRITICAL" : snapshot.warning ? "WARNING" : "OK",
    current,
  );
  for (const alert of alertsFor(snapshot, now)) {
    const stateKey = `resend_quota_alert:${alert.key}:${alert.period}`;
    const existing = await env.DB.prepare(
      "SELECT status FROM health_state WHERE key = ?",
    ).bind(stateKey).first<{ status: string }>();
    if (existing && existing.status !== "ERROR") continue;
    let delivered = false;
    try {
      delivered = await deliverAlert(env, alert, fetcher);
    } catch {
      delivered = false;
    }
    const record = { ...alert, delivered, observedAt: current };
    console.warn(JSON.stringify({ type: "novahair_quota_alert", ...record }));
    await setHealth(
      env.DB,
      stateKey,
      JSON.stringify(record),
      delivered ? "SENT" : lifecycleConfig(env).resendApiKey ? "ERROR" : alert.level,
      current,
    );
  }
}

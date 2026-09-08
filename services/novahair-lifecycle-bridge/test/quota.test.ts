import assert from "node:assert/strict";
import { test } from "node:test";
import { usageSnapshot } from "../src/db";
import { captureResendQuotaHeaders, monitorResendQuota } from "../src/quota";
import { testDatabase, testEnv } from "./helpers/d1";

test("official Resend quota headers strengthen the local free-tier guard", async () => {
  const { db, dispose } = await testDatabase();
  const now = new Date("2026-09-08T05:00:00.000Z");
  try {
    await captureResendQuotaHeaders(db, new Headers({
      "x-resend-daily-quota": "71 / 100",
      "x-resend-monthly-quota": "2,401 / 3,000",
    }), now);
    const warning = await usageSnapshot(db, now);
    assert.equal(warning.dayEmails, 71);
    assert.equal(warning.monthEmails, 2401);
    assert.equal(warning.warning, true);
    assert.equal(warning.dispatchAllowed, true);

    await captureResendQuotaHeaders(db, new Headers({
      "x-resend-daily-quota": "90",
      "x-resend-monthly-quota": "2900",
    }), now);
    const critical = await usageSnapshot(db, now);
    assert.equal(critical.critical, true);
    assert.equal(critical.dispatchAllowed, false);
  } finally {
    await dispose();
  }
});

test("quota alert is emailed to the owner once per threshold period", async () => {
  const { db, dispose } = await testDatabase();
  const now = new Date("2026-09-08T05:00:00.000Z");
  const env = testEnv(db);
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    assert.equal(init?.method, "POST");
    assert.match(String(new Headers(init?.headers).get("idempotency-key")), /^novahair-quota:daily_warning:/);
    return new Response(JSON.stringify({ id: "email_alert" }), { status: 200 });
  };
  const originalWarn = console.warn;
  console.warn = () => undefined;
  try {
    await db.prepare(
      `INSERT INTO lifecycle_usage_counters
        (period_type, period_key, emails_sent, automation_runs, updated_at)
       VALUES ('DAY', '2026-09-08', 70, 0, ?), ('MONTH', '2026-09', 70, 0, ?)`,
    ).bind(now.toISOString(), now.toISOString()).run();
    await monitorResendQuota(env, now, fetcher);
    await monitorResendQuota(env, now, fetcher);
    assert.equal(calls, 1);
    const status = await db.prepare(
      "SELECT status FROM health_state WHERE key = 'resend_quota_alert:daily_warning:2026-09-08'",
    ).first("status");
    assert.equal(status, "SENT");
  } finally {
    console.warn = originalWarn;
    await dispose();
  }
});

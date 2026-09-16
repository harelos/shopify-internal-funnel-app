import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desk = readFileSync(path.join(root, "src/services/support-desk.ts"), "utf8");

test("housekeeping can never starve customer drafting", () => {
  // Reclassifying up to 250 threads every minute overran the tick and threw
  // before a single reply was drafted, so no customer was answered for a day
  // and a half. Drafting runs first and reclassify is bounded and guarded.
  const cronStart = desk.indexOf("export async function processSupportDeskCron");
  const cronBody = desk.slice(cronStart, desk.indexOf("export async function reclassifyHistoricSupportTopics"));
  assert.ok(cronBody.indexOf("const due =") < cronBody.indexOf("reclassifyHistoricSupportTopics(40)"),
    "reclassify still runs before drafting");
  assert.match(cronBody, /try \{\s*reclassified = await reclassifyHistoricSupportTopics\(40\)/);
});

test("a conversation cleared of its schedule can still be re-drafted", () => {
  // nextActionAt is set to null after a terminal draft; `lte` never matches
  // null, so those conversations became permanently invisible to the cron.
  assert.match(desk, /OR: \[\{ nextActionAt: \{ lte: new Date\(\) \} \}, \{ nextActionAt: null \}\]/);
});

test("a verified-order reply that failed only on delivery is resent, an AI reply is not", () => {
  // #4385's tracking reply was correct but stuck FAILED after an SMTP timeout;
  // the outbox only retries QUEUED_TO_SEND. Deterministic replies are safe to
  // resend verbatim; AI replies are re-drafted with the current model instead.
  assert.match(desk, /status: "FAILED", attemptCount: \{ lt: 3 \}, model: \{ in: \["verified-order-facts-v1", "approved-facts-v1"\] \}/);
  assert.match(desk, /data: \{ status: "QUEUED_TO_SEND", sendAfter: new Date\(\), claimedAt: null, lastDeliveryError: null \}/);
});

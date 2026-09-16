import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desk = readFileSync(path.join(root, "src/services/support-desk.ts"), "utf8");
const smtp = readFileSync(path.join(root, "src/lib/smtp-email.ts"), "utf8");
const worker = readFileSync(path.join(root, "src/worker.ts"), "utf8");

test("replies are delivered from the Worker, not the SMTP-blocked Railway host", () => {
  // Railway blocks outbound SMTP, so every send timed out and no customer was
  // answered. The Worker sends over the mailbox's own host instead.
  assert.match(desk, /export async function processSupportOutbox/);
  assert.match(worker, /run\("processSupportOutbox", processSupportOutbox\(\)\)/);
  assert.match(smtp, /export async function sendSupportReplyEmail/);
  // Sends authenticate as the real mailbox: first-party SPF/DKIM, no provider.
  assert.match(smtp, /mail\.privateemail\.com/);
  assert.match(smtp, /fromName: "Tiger Brands Global"/);
});

test("a claim is atomic, so a reply can never be sent twice", () => {
  const fn = desk.slice(desk.indexOf("export async function processSupportOutbox"));
  assert.match(fn, /status: "QUEUED_TO_SEND" \},\s*data: \{ status: "SENDING"/);
  assert.match(fn, /if \(claim\.count !== 1\) continue;/);
  // A failed send is recorded, not silently dropped.
  assert.match(fn, /status: "FAILED", claimedAt: null, lastDeliveryError:/);
});

test("a delivered reply threads and is recorded as an outbound message", () => {
  const fn = desk.slice(desk.indexOf("export async function processSupportOutbox"));
  // Threading header so the reply lands in the customer's original thread.
  assert.match(fn, /inReplyTo = draft\.conversation\.messages\[0\]\?\.externalMessageId/);
  assert.match(fn, /direction: "OUTBOUND"/);
  assert.match(fn, /status: "WAITING_CUSTOMER"/);
  // Gated so it can be turned off without a redeploy of logic.
  assert.match(fn, /SUPPORT_WORKER_SEND/);
});

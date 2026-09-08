import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSupportPolicy, mayAutoSend } from "../src/lib/support-policy.js";
import { triageMailboxMessage } from "../src/lib/support-triage.js";

test("chargeback, legal, refund and safety messages always escalate", () => {
  for (const text of [
    "אני פונה לחברת האשראי להכחשת עסקה",
    "העברתי את זה לעורך דין",
    "אני רוצה החזר כספי",
    "הייתה לי פריחה אחרי השימוש",
  ]) {
    const result = evaluateSupportPolicy(text);
    assert.equal(result.riskLevel, "HIGH");
    assert.equal(result.mustEscalate, true);
    assert.equal(result.priority, "URGENT");
  }
});

test("a simple tracking request is low risk but still needs verified order context", () => {
  const policy = evaluateSupportPolicy("היי, איפה החבילה שלי? יש מספר מעקב?");
  assert.equal(policy.topic, "ORDER_STATUS");
  assert.equal(policy.mustEscalate, false);
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.96, hasVerifiedOrder: false, hasUnverifiedClaims: false }), false);
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.96, hasVerifiedOrder: true, hasUnverifiedClaims: false }), true);
});

test("draft-only mode can never send automatically", () => {
  const policy = evaluateSupportPolicy("איפה ההזמנה שלי?");
  assert.equal(mayAutoSend({ automationMode: "DRAFT_ONLY", policy, confidence: 1, hasVerifiedOrder: true, hasUnverifiedClaims: false }), false);
});

test("a general shipping question can auto-send from approved store facts without an order", () => {
  const policy = evaluateSupportPolicy("היי, כמה זמן המשלוח וכמה הוא עולה?");
  assert.equal(policy.topic, "GENERAL_SHIPPING");
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.96, hasVerifiedOrder: false, hasUnverifiedClaims: false }), true);
});

test("mailbox triage accepts a Hebrew shipping prospect and rejects unrelated system mail", () => {
  const prospect = triageMailboxMessage({
    direction: "INBOUND",
    fromAddress: "person@example.com",
    subject: "משלוח",
    textBody: "היי, כמה זמן המשלוח וכמה הוא עולה?",
  });
  assert.equal(prospect.classification, "SALES_QUESTION");
  assert.ok(prospect.confidence >= 0.9);

  const unrelated = triageMailboxMessage({
    direction: "INBOUND",
    fromAddress: "billing@example.com",
    subject: "Monthly hosting invoice",
    textBody: "Your billing notice is ready.",
  });
  assert.equal(unrelated.classification, "IGNORE");
});

test("ambiguous Hebrew personal mail is held for triage rather than auto-processed", () => {
  const result = triageMailboxMessage({
    direction: "INBOUND",
    fromAddress: "person@example.com",
    subject: "שלום",
    textBody: "רציתי לשאול משהו קטן",
  });
  assert.equal(result.classification, "REVIEW");
});

test("Support Inbox ships responsive controls and human-readable copy", () => {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const html = fs.readFileSync(path.join(appRoot, "public/admin/support.html"), "utf8");
  const css = fs.readFileSync(path.join(appRoot, "public/admin/css/support.css"), "utf8");
  const js = fs.readFileSync(path.join(appRoot, "public/admin/js/support.js"), "utf8");
  assert.match(html, /AI Support Inbox/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(js, /Approve & send/);
  assert.doesNotMatch(html + js, /utm_|externalMessageId|policyFlagsJson/);
});

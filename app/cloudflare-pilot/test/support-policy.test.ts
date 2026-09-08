import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSupportPolicy, mayAutoSend } from "../src/lib/support-policy.js";
import { triageMailboxMessage } from "../src/lib/support-triage.js";
import { extractSupportOrderNumber } from "../src/lib/support-email.js";
import { deterministicLowRiskDecision } from "../src/lib/support-replies.js";

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

test("marketing opt-out and privacy requests always escalate while product approval questions stay review-only", () => {
  for (const text of ["בבקשה להוציא אותי מרשימת התפוצה", "I want you to delete my data"]) {
    const result = evaluateSupportPolicy(text);
    assert.equal(result.mustEscalate, true);
    assert.equal(result.riskLevel, "HIGH");
  }
  const regulatory = evaluateSupportPolicy("אפשר לקבל רשימת רכיבים ואישור משרד הבריאות?");
  assert.equal(regulatory.topic, "PRODUCT_INFORMATION");
  assert.equal(regulatory.riskLevel, "MEDIUM");
  assert.equal(regulatory.mustEscalate, false);
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

test("a delivery ETA phrasing in Hebrew is recognized as order status", () => {
  const policy = evaluateSupportPolicy("יש צפי לקבלת המשלוח??");
  assert.equal(policy.topic, "ORDER_STATUS");
  assert.equal(policy.riskLevel, "LOW");
});

test("old mail and conversations already answered can never auto-send", () => {
  const policy = evaluateSupportPolicy("איפה ההזמנה שלי?");
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.99, hasVerifiedOrder: true, hasUnverifiedClaims: false, messageAgeMinutes: 73 * 60 }), false);
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.99, hasVerifiedOrder: true, hasUnverifiedClaims: false, latestMessageIsInbound: false }), false);
});

test("a reported delivered-but-missing parcel requires human review", () => {
  const policy = evaluateSupportPolicy("כתוב שנמסר אבל לא קיבלתי את החבילה");
  assert.equal(policy.topic, "DELIVERY_DISPUTE");
  assert.equal(policy.riskLevel, "MEDIUM");
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.99, hasVerifiedOrder: true, hasUnverifiedClaims: false }), false);
});

test("verified tracking context renders a bounded Hebrew reply without an LLM", () => {
  const policy = evaluateSupportPolicy("יש צפי לקבלת המשלוח??");
  const decision = deterministicLowRiskDecision({
    policy,
    orderContext: [{
      name: "#4379",
      cancelledAt: null,
      displayFinancialStatus: "PAID",
      displayFulfillmentStatus: "FULFILLED",
      fulfillments: [{ displayStatus: "IN_TRANSIT", deliveredAt: null, trackingInfo: [{ number: "95111608" }] }],
    }],
  });
  assert.equal(decision?.decision, "REPLY");
  assert.equal(decision?.confidence, 0.99);
  assert.match(decision?.replyText || "", /#4379/);
  assert.match(decision?.replyText || "", /95111608/);
  assert.match(decision?.replyText || "", /5–12 ימי עסקים/);
  assert.equal(decision?.unverifiedClaims.length, 0);
});

test("cancelled, refunded or delivered orders do not use the automatic status renderer", () => {
  const policy = evaluateSupportPolicy("יש צפי לקבלת המשלוח??");
  const base = { name: "#4379", cancelledAt: null, displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", fulfillments: [] };
  assert.equal(deterministicLowRiskDecision({ policy, orderContext: [{ ...base, cancelledAt: "2026-09-08" }] }), null);
  assert.equal(deterministicLowRiskDecision({ policy, orderContext: [{ ...base, displayFinancialStatus: "REFUNDED" }] }), null);
  assert.equal(deterministicLowRiskDecision({ policy, orderContext: [{ ...base, fulfillments: [{ displayStatus: "DELIVERED", deliveredAt: "2026-09-08", trackingInfo: [] }] }] }), null);
});

test("order extraction requires an explicit hash and never mistakes a date for an order", () => {
  assert.equal(extractSupportOrderNumber("Re: הזמנה #4379 אושרה", "יש צפי לקבלת המשלוח?"), "4379");
  assert.equal(extractSupportOrderNumber("משלוח", "בתאריך 1 בספטמבר 2026 שאלתי על המשלוח"), null);
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

test("supplier and sourcing conversations are filtered even when they mention shipping", () => {
  const result = triageMailboxMessage({
    direction: "INBOUND",
    fromAddress: "support@zendrop.com",
    subject: "Re: Product Sourcing Request — Bundle Fulfillment Quote",
    textBody: "Our supplier can provide the shipping cost, private label MOQ and fulfillment details.",
  });
  assert.equal(result.classification, "IGNORE");
  assert.ok(result.reasons.includes("SUPPLIER_OR_OPERATIONS_SIGNAL"));
});

test("English operational mail cannot auto-send even if a shipping phrase matches", () => {
  const policy = evaluateSupportPolicy("What is the shipping cost?");
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.99, hasVerifiedOrder: false, hasUnverifiedClaims: false, language: "ENGLISH" }), false);
});

test("unknown low-risk topics stay in review even for a verified customer", () => {
  const policy = evaluateSupportPolicy("יש לי שאלה כללית על המוצר");
  assert.equal(policy.topic, "OTHER");
  assert.equal(mayAutoSend({ automationMode: "AUTOSEND_LOW_RISK", policy, confidence: 0.99, hasVerifiedOrder: true, hasUnverifiedClaims: false, language: "HEBREW" }), false);
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
  assert.match(js, /SMTP accepted · Sent-folder copy verified/);
  assert.match(js, /Retry sending/);
  assert.match(html, /Email delivery health/);
  assert.match(html, /Teach the AI/);
  assert.match(html, /Service quality/);
  assert.match(html, /Automatic sends/);
  assert.match(html, /Owner-approved/);
  assert.match(html, /data-status="DELIVERY_FAILED"/);
  assert.match(js, /show-delivery-failures/);
  assert.match(html, /Historic replies are suggestions only/);
  assert.match(js, /Approve as an example/);
  assert.match(js, /medianFirstResponseMinutes/);
  const route = fs.readFileSync(path.join(appRoot, "src/routes/support-desk.ts"), "utf8");
  const service = fs.readFileSync(path.join(appRoot, "src/services/support-desk.ts"), "utf8");
  assert.match(route, /customerSupportConversationWhere/);
  assert.match(route, /messages:\s*\{\s*some:\s*\{\s*direction:\s*"INBOUND"/);
  assert.match(route, /\/support\/voice-examples/);
  assert.match(route, /\/support\/analytics/);
  assert.match(route, /COMPLETE_FOR_RANGE/);
  assert.match(route, /SEND_AUTHORIZED/);
  assert.match(route, /OWNER_ADMIN/);
  assert.match(route, /AGENT_API/);
  assert.match(service, /qualityStatus:\s*"APPROVED"/);
  assert.match(service, /'PENDING_REVIEW'/);
  assert.match(service, /reclassifyHistoricSupportTopics/);
  assert.match(service, /SEND_AUTHORIZED/);
  assert.match(service, /AUTOMATION_POLICY/);
  assert.match(service, /"status" = 'WAITING_CUSTOMER', "lastAgentMessageAt"/);
  assert.match(html, /data-status="CLOSED"/);
  assert.doesNotMatch(html + js, /utm_|externalMessageId|policyFlagsJson/);
});

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSupportPolicy, mayAutoSend, mayAutoAcknowledge } from "../src/lib/support-policy.js";
import { triageMailboxMessage } from "../src/lib/support-triage.js";
import { extractSupportOrderNumber } from "../src/lib/support-email.js";
import { deterministicLowRiskDecision, ownerReviewHoldingDraft, escalationAcknowledgementReply } from "../src/lib/support-replies.js";

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

test("regulatory questions receive a safe owner-review holding draft without product claims", () => {
  const policy = evaluateSupportPolicy("אפשר לקבל רשימת רכיבים ואישור משרד הבריאות?");
  const draft = ownerReviewHoldingDraft(policy);
  assert.match(draft, /מידע מדויק/);
  assert.match(draft, /לאחר בדיקה/);
  assert.doesNotMatch(draft, /מאושר|approved/i);
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

test("shipping replies use the editable approved facts and never silently restore disabled defaults", () => {
  const policy = evaluateSupportPolicy("היי, כמה זמן המשלוח וכמה הוא עולה?");
  const edited = deterministicLowRiskDecision({
    policy,
    orderContext: null,
    approvedStoreFacts: [
      "Delivery is available throughout Israel and normally takes 7-14 business days.",
      "Shipping is free for orders above ILS 249.",
    ],
  });
  assert.match(edited?.replyText || "", /7–14 ימי עסקים/);
  assert.match(edited?.replyText || "", /249 ₪/);
  assert.doesNotMatch(edited?.replyText || "", /5–12|199 ₪/);
  assert.equal(deterministicLowRiskDecision({ policy, orderContext: null, approvedStoreFacts: [] }), null);
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

test("operations-provider mail never enters the customer-support queue", () => {
  const result = triageMailboxMessage({
    direction: "INBOUND",
    fromAddress: "risk-management@namecheap.com",
    subject: "Re: email address review",
    textBody: "Please reply with the shipping address connected to this email account.",
  });
  assert.equal(result.classification, "IGNORE");
  assert.ok(result.reasons.includes("OPERATIONS_SERVICE_PROVIDER_SENDER"));
});

test("chargeback vendors remain operations mail even when their copy contains customer-support words", () => {
  const result = triageMailboxMessage({
    direction: "INBOUND",
    fromAddress: "jack@chargeback.io",
    subject: "Re: New form submission: Customer Support Enquiry",
    textBody: "We can auto refund alerts and review disputed transactions for your Shopify store.",
  });
  assert.equal(result.classification, "IGNORE");
  assert.ok(result.reasons.includes("OPERATIONS_SERVICE_PROVIDER_SENDER"));
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
  assert.match(html, /Unclassified legacy/);
  assert.match(html, /data-status="DELIVERY_FAILED"/);
  assert.match(js, /show-delivery-failures/);
  assert.match(js, /show-escalated/);
  assert.match(html, /sensitive reply needs your approval/);
  assert.match(html, /Historic replies are suggestions only/);
  assert.match(html, /training review queue/);
  assert.match(js, /Approve as an example/);
  assert.match(js, /Save verified fact/);
  assert.match(js, /This reply cannot send automatically/);
  assert.match(js, /A later reply is already in the customer thread/);
  assert.match(js, /funnel:support-mutation-replayed/);
  assert.match(js, /medianFirstResponseMinutes/);
  const api = fs.readFileSync(path.join(appRoot, "public/admin/js/api.js"), "utf8");
  assert.match(api, /SUPPORT_AUTH_RETRY_KEY/);
  assert.match(api, /X-Shopify-Retry-Invalid-Session-Request/);
  assert.match(api, /method === "GET" \|\| !String\(path\)\.startsWith\("\/api\/support\/"\)/);
  const route = fs.readFileSync(path.join(appRoot, "src/routes/support-desk.ts"), "utf8");
  const service = fs.readFileSync(path.join(appRoot, "src/services/support-desk.ts"), "utf8");
  assert.match(route, /customerSupportConversationWhere/);
  assert.match(route, /audienceType:\s*\{\s*not:\s*"NON_CUSTOMER"/);
  assert.match(route, /messages:\s*\{\s*some:\s*\{\s*direction:\s*"INBOUND"/);
  assert.match(route, /\/support\/voice-examples/);
  assert.match(route, /\/support\/analytics/);
  assert.match(route, /COMPLETE_FOR_RANGE/);
  assert.match(route, /SEND_AUTHORIZED/);
  assert.match(route, /OWNER_ADMIN/);
  assert.match(route, /support\/knowledge\/:id/);
  assert.match(route, /AGENT_API/);
  assert.match(route, /\/delivery\/bounce/);
  assert.match(route, /OUTBOUND_BOUNCED/);
  assert.match(service, /referencedConversation/);
  assert.match(service, /m\."externalMessageId" = \?/);
  assert.match(service, /Superseded by a later reply imported from the mailbox Sent folder/);
  assert.match(route, /status:\s*"BOUNCED"/);
  assert.match(service, /qualityStatus:\s*"APPROVED"/);
  assert.match(service, /'PENDING_REVIEW'/);
  assert.match(service, /reclassifyHistoricSupportTopics/);
  assert.match(service, /triage\.classification === "IGNORE"/);
  assert.match(service, /audienceType:\s*"NON_CUSTOMER"/);
  assert.match(service, /SEND_AUTHORIZED/);
  assert.match(service, /AUTOMATION_POLICY/);
  assert.match(service, /"status" = 'WAITING_CUSTOMER', "lastAgentMessageAt"/);
  assert.match(html, /data-status="CLOSED"/);
  assert.doesNotMatch(html + js, /utm_|externalMessageId|policyFlagsJson/);
});

test("the way customers actually ask where their parcel is reaches ORDER_STATUS", () => {
  // These are verbatim from the mailbox. Every one of them used to score as
  // topic OTHER, which mayAutoSend refuses, so a plain tracking question sat
  // in review for days with the carrier's own events already on the draft.
  for (const text of [
    "ביצעתי הזמנה ב-6.9 עם שליח עד הבית וטרם קיבלתי את ההזמנה אשמח לדעת מה קורה עם ההזמנה שלי תודה.",
    "רציתי לברר מתי ההזמנה שלי תגיע , קיבלתי הודעה על משלוח בדרך וטרם הגיע",
    "אשמח לדעת מתי אוכל לקבל את ההזמנה שלי? תודה",
    "היי מתי צפויה ההזמנה להגיע?",
    "מה הסטטוס של ההזמנה שלי",
  ]) {
    const result = evaluateSupportPolicy(text);
    assert.equal(result.topic, "ORDER_STATUS", `wrong topic for: ${text}`);
    assert.equal(result.riskLevel, "LOW", `wrong risk for: ${text}`);
    assert.equal(result.mustEscalate, false);
  }
});

test("widening the tracking rule did not swallow the messages that must escalate", () => {
  // Every higher-risk rule sits earlier in the list and wins hits[0], so a
  // message that mentions the order AND a refund, cancellation, address change
  // or a delivery dispute must still come back as that topic, not ORDER_STATUS.
  const cases: Array<[string, string]> = [
    ["לא קיבלתי את ההזמנה ואני רוצה החזר כספי", "REFUND"],
    ["טרם קיבלתי את החבילה, בבקשה לבטל את ההזמנה", "CANCELLATION"],
    ["מתי ההזמנה תגיע? הכתובת שלי לא נכונה", "ADDRESS_CHANGE"],
    ["מסומן כנמסר אבל לא קיבלתי את החבילה", "DELIVERY_DISPUTE"],
  ];
  for (const [text, topic] of cases) {
    const result = evaluateSupportPolicy(text);
    assert.equal(result.topic, topic, `wrong topic for: ${text}`);
    assert.notEqual(result.riskLevel, "LOW", `risk dropped to LOW for: ${text}`);
  }
});

test("a bare 'I have not received it' is still held as a delivery dispute", () => {
  // This is deliberate and it is the owner's call, not the code's: the text
  // alone cannot tell "it has not arrived yet" from "your tracking says
  // delivered and it is not here". The second must never be auto-answered, so
  // both wait. Narrowing this to an explicit delivered-claim would auto-answer
  // roughly one more message a day and risk telling a customer her parcel was
  // delivered while she is telling us it was not.
  const result = evaluateSupportPolicy("עדיין לא קיבלתי את החבילה");
  assert.equal(result.topic, "DELIVERY_DISPUTE");
  assert.equal(result.riskLevel, "MEDIUM");
  assert.equal(mayAutoSend({
    automationMode: "AUTOSEND_LOW_RISK",
    policy: result,
    confidence: 0.99,
    hasVerifiedOrder: true,
    hasUnverifiedClaims: false,
    language: "HEBREW",
  }), false);
});

const ackBase = {
  enabled: true,
  automationMode: "AUTOSEND_LOW_RISK",
  triageReasons: ["SUPPORT_INTENT", "HEBREW_CUSTOMER_SIGNAL"],
  hasVerifiedOrder: true,
  alreadyAcknowledged: false,
  messageAgeMinutes: 30,
  latestMessageIsInbound: true,
  language: "HEBREW",
};

test("a real customer routed to a human is told so instead of hearing nothing", () => {
  for (const text of [
    "יש לי אלרגיה, מה הרכיבים במוצר?",
    "אני רוצה החזר כספי על ההזמנה",
    "מסומן כנמסר אבל לא קיבלתי את החבילה",
  ]) {
    const policy = evaluateSupportPolicy(text);
    assert.equal(mayAutoSend({ ...ackBase, policy, confidence: 0.99, hasUnverifiedClaims: false }), false, `should not auto-answer: ${text}`);
    assert.equal(mayAutoAcknowledge({ ...ackBase, policy }), true, `should acknowledge: ${text}`);
  }
});

test("the mailbox's non-customers are never acknowledged", () => {
  const policy = evaluateSupportPolicy("שלום, יש לנו הצעה עבורכם");
  // Phishing and legal demands: replying confirms a human reads this address.
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy: { ...policy, topic: "FRAUD" } }), false);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy: { ...policy, topic: "LEGAL" } }), false);
  // She asked for no more email; an acknowledgement is one more email.
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy: { ...policy, topic: "MARKETING_OPT_OUT" } }), false);
  // Newsletters and vendor threads carry the machine-mail marker.
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, hasVerifiedOrder: false, triageReasons: ["SUPPORT_INTENT", "HEBREW_CUSTOMER_SIGNAL", "BUSINESS_OR_SYSTEM_MAIL_SIGNAL"] }), false);
  // A supplier pitch has neither an order nor the Hebrew customer signal.
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, hasVerifiedOrder: false, triageReasons: ["PRE_SALE_INTENT"] }), false);
  // The shipment monitor writes threads that have no customer message at all.
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, hasVerifiedOrder: false, triageReasons: ["SHIPMENT_MONITOR"] }), false);
});

test("an acknowledgement is sent once, only for this week, and never twice", () => {
  const policy = evaluateSupportPolicy("אני רוצה החזר כספי");
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, alreadyAcknowledged: true }), false);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, messageAgeMinutes: 8 * 24 * 60 }), false);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, messageAgeMinutes: 6 * 24 * 60 }), true);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, latestMessageIsInbound: false }), false);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, enabled: false }), false);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, automationMode: "OFF" }), false);
});

test("the acknowledgement promises nothing, claims nothing and carries no dash", () => {
  const text = escalationAcknowledgementReply();
  assert.match(text, /הועברה לצוות/);
  assert.doesNotMatch(text, /[—–]/);
  // No timeframe, no outcome, no product or order claim.
  assert.doesNotMatch(text, /\d+\s*(?:ימים|שעות|ימי עסקים)/);
  assert.doesNotMatch(text, /החזר|זיכוי|מאושר|נמסר|יגיע/);
});

test("an intellectual property demand is legal, not a support question", () => {
  // This arrived worded as an ordinary Hebrew message and scored as a customer
  // question, which would have sent it an automated acknowledgement.
  const policy = evaluateSupportPolicy("התראת הפרת זכויות יוצרים וסימני מסחר — דרישה להסרה מיידית");
  assert.equal(policy.topic, "LEGAL");
  assert.equal(policy.mustEscalate, true);
  assert.equal(mayAutoAcknowledge({ ...ackBase, policy, hasVerifiedOrder: false }), false);
});

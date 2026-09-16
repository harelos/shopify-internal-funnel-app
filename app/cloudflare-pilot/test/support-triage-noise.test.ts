import assert from "node:assert/strict";
import test from "node:test";
import { triageMailboxMessage } from "../src/lib/support-triage.js";

const inbound = (fromAddress: string, subject: string, textBody = "") =>
  triageMailboxMessage({ direction: "INBOUND", fromAddress, subject, textBody });

test("vendor and platform mail stays out of the customer queue", () => {
  // Every one of these was classified CUSTOMER_SUPPORT in a single week,
  // because vendor mail is full of the words order, delivery and refund.
  const noise: Array<[string, string]> = [
    ["mailer@shopify.com", "Payout for Sep 8, 2026 ($72.61 USD)"],
    ["security@namecheap.com", "[NC-KCN-1207] Namecheap Chat Follow-Up: Regarding the issue"],
    ["support@chargeback.io", "Re: New form submission: Customer Support Enquiry"],
    ["kiajacks@visa.com", "Thanks for contacting Visa Acceptance Solutions"],
    ["help@convertkit.com", "Your week with Kit"],
  ];
  for (const [from, subject] of noise) {
    const decision = inbound(from, subject, "your order shipment delivery refund");
    assert.equal(decision.classification, "IGNORE", `${from} reached the queue`);
  }
});

test("a shopper forwarded by the platform is still a shopper", () => {
  const decision = inbound(
    "mailer@shopify.com",
    "הודעת לקוח חדשה בתאריך 14 בספטמבר 2026 בשעה 19:02",
    "היי, מתי ההזמנה שלי מגיעה?",
  );
  assert.notEqual(decision.classification, "IGNORE");
  assert.ok(decision.reasons.includes("PLATFORM_FORWARDED_CUSTOMER_MESSAGE"));
});

test("an Israeli customer writing directly is never filtered out", () => {
  const decision = inbound("rinat@gmail.com", "שאלה על ההזמנה", "היי, ההזמנה שלי עדיין לא הגיעה. מה קורה?");
  assert.equal(decision.classification, "CUSTOMER_SUPPORT");
  assert.equal(decision.language, "HEBREW");
});

test("a pre-sale question is separated from a support problem", () => {
  const decision = inbound("dana@gmail.com", "שאלה", "כמה עולה המשלוח ואיזה גוון מתאים לי?");
  assert.equal(decision.classification, "SALES_QUESTION");
});

test("the platform rule cannot be bypassed by a lookalike domain", () => {
  // notshopify.com must not inherit the platform exemption.
  const decision = inbound("mailer@notshopify.com.evil.io", "הודעת לקוח חדשה", "היי");
  assert.notEqual(decision.reasons[0], "PLATFORM_ADMINISTRATIVE_MAIL");
});

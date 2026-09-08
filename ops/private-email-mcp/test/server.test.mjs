import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanMessageText, parseDeliveryFailure, parseShopifyContactForm, triageMessage } from "../src/support-sync.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "../src/server.mjs"), "utf8");
const syncSource = fs.readFileSync(path.join(here, "../src/support-sync.mjs"), "utf8");

test("MCP exposes guarded customer-support agent tools", () => {
  for (const tool of ["support_sync", "support_agent_status", "support_list", "support_get", "support_draft", "support_approve"]) {
    assert.match(source, new RegExp(`['\"]${tool}['\"]`));
  }
  assert.match(source, /confirmSend:\s*z\.literal\(true\)/);
  assert.match(source, /This never sends email/);
});

test("support sync filters mail and never starts a loop when imported by MCP", () => {
  assert.match(syncSource, /triageClass:\s*"IGNORE"/);
  assert.match(syncSource, /pathToFileURL\(process\.argv\[1\]\)/);
  assert.match(syncSource, /SUPPORT_MAIL_SEND_ENABLED/);
  assert.match(syncSource, /appendSentMessage\(rawMessage, sentAt\)/);
  assert.match(syncSource, /deterministicMessageId/);
  assert.match(syncSource, /providerMessageId:\s*result\.messageId/);
  assert.match(syncSource, /OUTBOUND_DELIVERY_VERIFIED|pending-verification|verify-sent-copy/);
  assert.match(syncSource, /sentFolderCopy:\s*true/);
  assert.match(syncSource, /inboundAcceptedThreads/);
  assert.match(syncSource, /message\.direction === "INBOUND"/);
  assert.match(syncSource, /duplicateWatcherPrevented/);
  assert.match(syncSource, /acquireWatchLock/);
});

test("support sync removes quoted reply history before AI analysis", () => {
  const body = `יש צפי לקבלת המשלוח??\n\nבתאריך יום ג׳, 1 בספט׳ 2026, 07:20, מאת support <support@tigerbrandsglobal.com>:\nהזמנה #4379 אושרה`;
  assert.equal(cleanMessageText(body), "יש צפי לקבלת המשלוח??");
});

test("Shopify contact-form relays resolve to the shopper rather than mailer@shopify.com", () => {
  const parsed = parseShopifyContactForm({
    fromAddress: "mailer@shopify.com",
    subject: "הודעת לקוח חדשה בתאריך 4 בספטמבר 2026",
    textBody: "קוד מדינה:\nIL\n\nשם:\nעדינה לבייב\n\nאימייל:\nadina198570@gmail.com\n\nמספר הזמנה:\n\nתוכן:\nהיי, יש לי שאלה על הגוון",
  });
  assert.deepEqual(parsed, { email: "adina198570@gmail.com", name: "עדינה לבייב", customerMessage: "היי, יש לי שאלה על הגוון" });
});

test("Shopify payout notices never enter the customer-support queue", () => {
  const result = triageMessage({
    subject: "Payout for Sep 8, 2026 ($72.61 USD)",
    textBody: "$72.61 USD will be deposited to your bank account in 1–2 business days. Refunds $0.00 USD. View payout.",
  });
  assert.equal(result.triageClass, "IGNORE");
  assert.ok(result.triageReasons.includes("BUSINESS_OR_SYSTEM_MAIL_SIGNAL"));
});

test("operations-provider senders are excluded before keyword matching", () => {
  const result = triageMessage({
    fromAddress: "risk-management@namecheap.com",
    subject: "Re: email address review",
    textBody: "Please confirm the shipping address and delivery email address.",
  });
  assert.equal(result.triageClass, "IGNORE");
  assert.ok(result.triageReasons.includes("OPERATIONS_SERVICE_PROVIDER_SENDER"));
});

test("a permanent DSN is matched only through the exact support Message-ID", () => {
  const result = parseDeliveryFailure({
    subject: "Delivery Status Notification (Failure)",
    bounceMessageId: "<bounce-1@example.net>",
    sentAt: "2026-09-08T17:00:00.000Z",
    rawSource: [
      "Content-Type: multipart/report; report-type=delivery-status",
      "Original-Message-ID: <support-draft-123e4567-e89b-12d3-a456-426614174000@tigerbrandsglobal.com>",
      "Final-Recipient: rfc822; shopper@example.com",
      "Action: failed",
      "Status: 5.1.1",
      "Diagnostic-Code: smtp; 550 mailbox unavailable",
    ].join("\r\n"),
  });
  assert.equal(result?.originalMessageId, "<support-draft-123e4567-e89b-12d3-a456-426614174000@tigerbrandsglobal.com>");
  assert.equal(result?.status, "5.1.1");
  assert.equal(result?.action, "failed");
});

test("temporary delay notices and unrelated failures are not marked as bounces", () => {
  assert.equal(parseDeliveryFailure({
    subject: "Delivery Status Notification (Delay)",
    rawSource: "Original-Message-ID: <support-draft-123e4567-e89b-12d3-a456-426614174000@tigerbrandsglobal.com>\r\nAction: delayed\r\nStatus: 4.2.0",
  }), null);
  assert.equal(parseDeliveryFailure({
    subject: "Delivery Status Notification (Failure)",
    rawSource: "Action: failed\r\nStatus: 5.1.1",
  }), null);
});

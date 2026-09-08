import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cleanMessageText, parseShopifyContactForm } from "../src/support-sync.mjs";

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

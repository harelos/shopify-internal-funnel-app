import assert from "node:assert/strict";
import test from "node:test";

import { getSupportConfig, assertSupportImapReadEnabled } from "../src/support/config.js";
import { parseSupportRawMessage } from "../src/support/imap-source.js";

test("IMAP read requires an explicit second staging gate", () => {
  const config = getSupportConfig({
    SUPPORT_STAGING_ENABLED: "true",
    SUPPORT_SYNC_SOURCE: "imap",
    SUPPORT_IMAP_READ_ENABLED: "false",
    SUPPORT_IMAP_USERNAME: "support@example.com",
    SUPPORT_IMAP_PASSWORD: "secret",
  } as NodeJS.ProcessEnv);

  assert.throws(() => assertSupportImapReadEnabled(config), /IMAP read is disabled/i);
});

test("Namecheap IMAP is rejected when secure mode is disabled", () => {
  const config = getSupportConfig({
    SUPPORT_STAGING_ENABLED: "true",
    SUPPORT_SYNC_SOURCE: "imap",
    SUPPORT_IMAP_READ_ENABLED: "true",
    SUPPORT_IMAP_HOST: "mail.privateemail.com",
    SUPPORT_IMAP_SECURE: "false",
    SUPPORT_IMAP_USERNAME: "support@example.com",
    SUPPORT_IMAP_PASSWORD: "secret",
  } as NodeJS.ProcessEnv);

  assert.throws(() => assertSupportImapReadEnabled(config), /must use secure IMAPS/i);
});

test("raw MIME parser preserves Hebrew text and thread headers", async () => {
  const raw = Buffer.from([
    "From: Dana <dana@example.com>",
    "To: Support <support@example.com>",
    "Subject: =?UTF-8?B?15DXmNeUINeU157Xqdec15XXlyDXqdec15k=?=",
    "Message-ID: <msg-2@example.com>",
    "In-Reply-To: <msg-1@example.com>",
    "References: <msg-0@example.com> <msg-1@example.com>",
    "Date: Mon, 24 Aug 2026 10:00:00 +0300",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "שלום, איפה המשלוח שלי?",
  ].join("\r\n"), "utf8");

  const parsed = await parseSupportRawMessage(raw, {
    uid: 42,
    uidValidity: "77",
    mailbox: "INBOX",
  });

  assert.equal(parsed.messageId, "<msg-2@example.com>");
  assert.equal(parsed.inReplyTo, "<msg-1@example.com>");
  assert.deepEqual(parsed.references, ["<msg-0@example.com>", "<msg-1@example.com>"]);
  assert.equal(parsed.from, "dana@example.com");
  assert.deepEqual(parsed.to, ["support@example.com"]);
  assert.match(parsed.text, /איפה המשלוח שלי/);
});

test("raw MIME parser creates a stable fallback ID when Message-ID is missing", async () => {
  const raw = Buffer.from([
    "From: customer@example.com",
    "To: support@example.com",
    "Subject: No message id",
    "",
    "hello",
  ].join("\r\n"), "utf8");

  const parsed = await parseSupportRawMessage(raw, {
    uid: 123,
    uidValidity: "456",
    mailbox: "INBOX",
  });

  assert.equal(parsed.messageId, "imap:INBOX:456:123");
});

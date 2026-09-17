import { ImapFlow } from "imapflow";

const rawMessageId = String(process.argv[2] || "").trim();
const messageId = rawMessageId && !rawMessageId.startsWith("<") ? `<${rawMessageId}>` : rawMessageId;

if (!/^<[^<>\s]+>$/.test(messageId)) {
  console.error(JSON.stringify({ ok: false, error: "A complete RFC 5322 Message-ID is required." }));
  process.exit(1);
}

const mailboxAddress = String(
  process.env.SUPPORT_MAILBOX_ADDRESS || process.env.NAMECHEAP_PRIVATE_EMAIL_USER || "",
).trim();
const password = String(process.env.NAMECHEAP_PRIVATE_EMAIL_PASSWORD || "");

if (!mailboxAddress || !password) {
  console.error(JSON.stringify({ ok: false, error: "Mailbox credentials are not configured." }));
  process.exit(1);
}

const client = new ImapFlow({
  host: process.env.NAMECHEAP_IMAP_HOST || "mail.privateemail.com",
  port: Number(process.env.NAMECHEAP_IMAP_PORT || 993),
  secure: true,
  auth: { user: mailboxAddress, pass: password },
  logger: false,
});

try {
  await client.connect();
  const folders = await client.list();
  const sentFolder = folders.find(folder => folder.specialUse === "\\Sent")?.path
    || folders.find(folder => /sent/i.test(folder.path))?.path;

  if (!sentFolder) throw new Error("The Namecheap Sent folder could not be resolved.");

  const lock = await client.getMailboxLock(sentFolder);
  try {
    const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
    console.log(JSON.stringify({ ok: true, sentFolderCopyFound: uids.length > 0, matchCount: uids.length }));
  } finally {
    lock.release();
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  process.exitCode = 1;
} finally {
  if (client.usable) await client.logout().catch(() => {});
}

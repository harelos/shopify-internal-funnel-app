import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "../.data/support-mail-state.json");
const mailboxAddress = (process.env.SUPPORT_MAILBOX_ADDRESS || process.env.NAMECHEAP_PRIVATE_EMAIL_USER || "").trim().toLowerCase();
const password = process.env.NAMECHEAP_PRIVATE_EMAIL_PASSWORD || "";
const appUrl = (process.env.SUPPORT_APP_URL || "").replace(/\/$/, "");
const connectorToken = process.env.SUPPORT_CONNECTOR_TOKEN || "";
const imapHost = process.env.NAMECHEAP_IMAP_HOST || "mail.privateemail.com";
const smtpHost = process.env.NAMECHEAP_SMTP_HOST || "mail.privateemail.com";
const intervalMs = Math.max(60000, Number(process.env.SUPPORT_SYNC_INTERVAL_MS || 120000));
let stopRequested = false;

const HEBREW = /[\u0590-\u05ff]/;
const SUPPORT_INTENT = /(?:הזמנ|חבילה|מעקב|משלוח|שליח|הגיע|החזר|זיכוי|ביטול|כתובת|בעיה|שימוש|צבע|גוון|שורש|מחיר|כמה עולה|כמה המשלוח|תוך כמה זמן|אחריות|order|tracking|shipment|delivery|refund|cancel|address|price|shipping|warranty)/i;
const SALES_INTENT = /(?:כמה (?:עולה|המשלוח|זמן המשלוח)|מחיר|איך מזמינים|איפה קונים|איזה גוון|מתאים לי|יש במלאי|תוך כמה זמן|מבצע|אחריות|how much|shipping cost|delivery time|which shade|in stock)/i;
const BUSINESS_NOISE = /(?:invoice|domain renewal|hosting|security alert|login attempt|password reset|partnership|collaboration|seo service|guest post|backlink|webinar|newsletter|digest|weekly report|monthly report|billing notice|sourcing|supplier|wholesale|private label|fulfillment quote|landed cost|shopify collective|mocra|\bsds\b|\bcoa\b|procurement|warehouse pre-stock|bundle fulfillment|shipping revolution|zendrop|cjdropshipping|hypersku)/i;

function triageMessage(message) {
  const text = `${message.subject}\n${message.textBody}`;
  const reasons = [];
  const hebrew = HEBREW.test(text);
  const support = SUPPORT_INTENT.test(text);
  const sales = SALES_INTENT.test(text);
  const noise = BUSINESS_NOISE.test(text);
  if (support) reasons.push("SUPPORT_INTENT");
  if (sales) reasons.push("PRE_SALE_INTENT");
  if (hebrew) reasons.push("HEBREW_CUSTOMER_SIGNAL");
  if (noise) reasons.push("BUSINESS_OR_SYSTEM_MAIL_SIGNAL");
  if (noise && (!hebrew || (!support && !sales))) return { triageClass: "IGNORE", triageScore: 0.96, triageReasons: reasons };
  if (sales) return { triageClass: "SALES_QUESTION", triageScore: 0.96, triageReasons: reasons };
  if (support) return { triageClass: "CUSTOMER_SUPPORT", triageScore: hebrew ? 0.96 : 0.9, triageReasons: reasons };
  if (hebrew) return { triageClass: "REVIEW", triageScore: 0.78, triageReasons: reasons.length ? reasons : ["THREAD_NEEDS_CONTEXT"] };
  return { triageClass: "IGNORE", triageScore: 0.9, triageReasons: ["NO_CUSTOMER_SUPPORT_SIGNAL"] };
}

function requireConfig() {
  const missing = [];
  if (!mailboxAddress) missing.push("NAMECHEAP_PRIVATE_EMAIL_USER");
  if (!password) missing.push("NAMECHEAP_PRIVATE_EMAIL_PASSWORD");
  if (!appUrl) missing.push("SUPPORT_APP_URL");
  if (!connectorToken) missing.push("SUPPORT_CONNECTOR_TOKEN");
  if (missing.length) throw new Error(`Missing support bridge configuration: ${missing.join(", ")}`);
}

function addresses(value) {
  return (value?.value || []).map(item => String(item.address || "").trim().toLowerCase()).filter(Boolean);
}

function references(parsed) {
  const raw = parsed.references;
  if (Array.isArray(raw)) return raw.map(String);
  return raw ? [String(raw)] : [];
}

function automated(parsed) {
  const from = addresses(parsed.from)[0] || "";
  const autoSubmitted = String(parsed.headers?.get("auto-submitted") || "").toLowerCase();
  return /mailer-daemon|postmaster|no-?reply|notifications?@/i.test(from)
    || (autoSubmitted && autoSubmitted !== "no")
    || Boolean(parsed.headers?.get("list-unsubscribe"));
}

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, "utf8")); }
  catch { return { lastSuccessfulSyncAt: null }; }
}

async function writeState(value) {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(value, null, 2), "utf8");
}

export async function supportBridgeFetch(route, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const retryable = method === "GET" || route.endsWith("/heartbeat") || route.endsWith("/ingest");
  const maxAttempts = retryable ? 5 : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}${route}`, {
        ...options,
        headers: { Authorization: `Bearer ${connectorToken}`, "Content-Type": "application/json", ...(options.headers || {}) },
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const error = new Error(payload.error || `Support bridge ${route} returned HTTP ${response.status}.`);
      error.retryable = response.status >= 500;
      if (!retryable || !error.retryable || attempt === maxAttempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (!retryable || error?.retryable === false || attempt === maxAttempts) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2000, 200 * (2 ** (attempt - 1)))));
  }
  throw lastError || new Error(`Support bridge ${route} failed.`);
}

export function cleanMessageText(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n").trim();
  const replyBoundary = /\n(?:בתאריך\s.+?מאת\s|On\s.+?wrote:\s*$|Replying to\s|[-_]{2,}\s*Original Message\s*[-_]{2,}|From:\s.+\nTo:\s)/im;
  const boundary = normalized.search(replyBoundary);
  const newestMessage = boundary >= 0 ? normalized.slice(0, boundary) : normalized;
  return newestMessage
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function attachmentManifest(attachments = []) {
  return Promise.all(attachments.map(async attachment => ({
    filename: attachment.filename || null,
    contentType: attachment.contentType || null,
    size: Number(attachment.size || attachment.content?.length || 0),
    contentHash: attachment.content ? crypto.createHash("sha256").update(attachment.content).digest("hex") : null,
  })));
}

async function collectMessages(client, folder, direction, since) {
  const lock = await client.getMailboxLock(folder);
  try {
    const uids = await client.search({ since }, { uid: true });
    const selected = uids.slice(-Math.max(100, Number(process.env.SUPPORT_SYNC_MESSAGE_LIMIT || 5000)));
    const rows = [];
    if (!selected.length) return rows;
    for await (const message of client.fetch(selected, { source: true, internalDate: true }, { uid: true })) {
      const parsed = await simpleParser(message.source);
      if (automated(parsed)) continue;
      const from = addresses(parsed.from);
      const to = addresses(parsed.to);
      const customerEmail = direction === "INBOUND" ? from[0] : to.find(address => address !== mailboxAddress);
      if (!customerEmail || customerEmail === mailboxAddress) continue;
      const textBody = cleanMessageText(parsed.text);
      if (!textBody) continue;
      const messageId = parsed.messageId || `<${folder}-${message.uid}@local-import>`;
      const refs = references(parsed);
      rows.push({
        mailboxAddress,
        customerEmail,
        customerName: direction === "INBOUND" ? parsed.from?.value?.[0]?.name || null : parsed.to?.value?.find(item => item.address?.toLowerCase() === customerEmail)?.name || null,
        externalMessageId: messageId,
        threadKey: refs[0] || parsed.inReplyTo || (direction === "INBOUND" ? messageId : null),
        direction,
        fromAddress: from[0] || mailboxAddress,
        toAddresses: to,
        subject: parsed.subject || "Customer support",
        textBody,
        sentAt: (parsed.date || message.internalDate || new Date()).toISOString(),
        inReplyTo: parsed.inReplyTo || null,
        references: refs,
        attachments: await attachmentManifest(parsed.attachments),
        source: `NAMECHEAP_IMAP:${folder}`,
      });
    }
    return rows;
  } finally {
    lock.release();
  }
}

export async function syncMailbox() {
  requireConfig();
  const state = await readState();
  const initialDays = Math.max(30, Number(process.env.SUPPORT_INITIAL_IMPORT_DAYS || 730));
  const overlapDays = Math.max(2, Number(process.env.SUPPORT_SYNC_OVERLAP_DAYS || 7));
  const since = state.lastSuccessfulSyncAt
    ? new Date(new Date(state.lastSuccessfulSyncAt).getTime() - overlapDays * 86400000)
    : new Date(Date.now() - initialDays * 86400000);
  const client = new ImapFlow({ host: imapHost, port: Number(process.env.NAMECHEAP_IMAP_PORT || 993), secure: true, auth: { user: mailboxAddress, pass: password }, logger: false });
  await client.connect();
  try {
    const folders = await client.list();
    const inbox = folders.find(folder => folder.specialUse === "\\Inbox")?.path || "INBOX";
    const sent = folders.find(folder => folder.specialUse === "\\Sent")?.path || folders.find(folder => /sent/i.test(folder.path))?.path;
    if (!sent) throw new Error("The Namecheap Sent folder could not be resolved.");
    const candidates = [
      ...(await collectMessages(client, inbox, "INBOUND", since)),
      ...(await collectMessages(client, sent, "OUTBOUND", since)),
    ].sort((left, right) => new Date(left.sentAt) - new Date(right.sentAt));
    const classified = candidates.map(message => ({ ...message, ...triageMessage(message) }));
    const acceptedThreads = new Set(classified.filter(message => message.triageClass !== "IGNORE").map(message => message.threadKey));
    const messages = classified.filter(message => message.triageClass !== "IGNORE" || acceptedThreads.has(message.threadKey));
    const ignored = classified.length - messages.length;
    let imported = 0;
    let duplicates = 0;
    const threadGroups = new Map();
    for (const message of messages) {
      const group = threadGroups.get(message.threadKey) || [];
      group.push(message);
      threadGroups.set(message.threadKey, group);
    }
    const groups = [...threadGroups.values()];
    let groupIndex = 0;
    const workers = Array.from({ length: Math.min(2, groups.length) }, async () => {
      while (groupIndex < groups.length) {
        const currentIndex = groupIndex;
        groupIndex += 1;
        // Preserve message order inside a conversation so owner replies can be
        // learned from the preceding customer message, while independent
        // conversations import concurrently during the initial backfill.
        for (const message of groups[currentIndex]) {
          const result = await supportBridgeFetch("/support-bridge/ingest", { method: "POST", body: JSON.stringify(message) });
          if (result.result?.duplicate) duplicates += 1;
          else imported += 1;
        }
      }
    });
    await Promise.all(workers);
    await writeState({ lastSuccessfulSyncAt: new Date().toISOString(), scanned: candidates.length, imported, duplicates, ignored });
    return { scanned: candidates.length, accepted: messages.length, ignored, imported, duplicates, inbox, sent };
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }
}

async function alreadySentMessage(messageId) {
  const client = new ImapFlow({ host: imapHost, port: Number(process.env.NAMECHEAP_IMAP_PORT || 993), secure: true, auth: { user: mailboxAddress, pass: password }, logger: false });
  await client.connect();
  try {
    const folders = await client.list();
    const sent = folders.find(folder => folder.specialUse === "\\Sent")?.path || folders.find(folder => /sent/i.test(folder.path))?.path;
    if (!sent) return false;
    const lock = await client.getMailboxLock(sent);
    try {
      const uids = await client.search({ header: { "message-id": messageId } }, { uid: true });
      return uids.length > 0;
    } finally {
      lock.release();
    }
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }
}

async function appendSentMessage(rawMessage, sentAt) {
  const client = new ImapFlow({ host: imapHost, port: Number(process.env.NAMECHEAP_IMAP_PORT || 993), secure: true, auth: { user: mailboxAddress, pass: password }, logger: false });
  await client.connect();
  try {
    const folders = await client.list();
    const sent = folders.find(folder => folder.specialUse === "\\Sent")?.path || folders.find(folder => /sent/i.test(folder.path))?.path;
    if (!sent) throw new Error("The Namecheap Sent folder could not be resolved.");
    const appended = await client.append(sent, rawMessage, ["\\Seen"], sentAt);
    if (!appended) throw new Error("Namecheap accepted the SMTP message but did not confirm the Sent-folder copy.");
  } finally {
    if (client.usable) await client.logout().catch(() => {});
  }
}

export async function sendOutbox() {
  if (process.env.SUPPORT_MAIL_SEND_ENABLED !== "true") return { disabled: true, sent: 0 };
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.NAMECHEAP_SMTP_PORT || 465),
    secure: true,
    auth: { user: mailboxAddress, pass: password },
  });
  const messageBuilder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  let sent = 0;
  for (let index = 0; index < 20; index += 1) {
    const payload = await supportBridgeFetch("/support-bridge/outbox/claim", { method: "POST", body: "{}" });
    const draft = payload.draft;
    if (!draft) break;
    try {
      if (await alreadySentMessage(draft.deterministicMessageId)) {
        await supportBridgeFetch(`/support-bridge/outbox/${encodeURIComponent(draft.id)}/sent`, {
          method: "POST",
          body: JSON.stringify({ externalMessageId: draft.deterministicMessageId, sentAt: new Date().toISOString() }),
        });
        sent += 1;
        continue;
      }
      const sentAt = new Date();
      const compiled = await messageBuilder.sendMail({
        from: draft.from,
        to: draft.to,
        subject: draft.subject,
        text: draft.replyText,
        messageId: draft.deterministicMessageId,
        inReplyTo: draft.inReplyTo || undefined,
        references: draft.inReplyTo ? [draft.inReplyTo] : undefined,
        date: sentAt,
      });
      const rawMessage = compiled.message;
      if (!Buffer.isBuffer(rawMessage)) throw new Error("Could not build the RFC 5322 support message.");
      const result = await transporter.sendMail({
        envelope: { from: draft.from, to: draft.to },
        raw: rawMessage,
      });
      // SMTP servers do not guarantee that programmatic sends appear in the
      // webmail Sent folder. Append the exact transmitted message before
      // acknowledging delivery so both the owner and the retry guard can see it.
      await appendSentMessage(rawMessage, sentAt);
      await supportBridgeFetch(`/support-bridge/outbox/${encodeURIComponent(draft.id)}/sent`, {
        method: "POST",
        body: JSON.stringify({
          externalMessageId: draft.deterministicMessageId,
          providerMessageId: result.messageId || null,
          sentAt: sentAt.toISOString(),
        }),
      });
      sent += 1;
    } catch (error) {
      await supportBridgeFetch(`/support-bridge/outbox/${encodeURIComponent(draft.id)}/failed`, {
        method: "POST",
        body: JSON.stringify({ error: String(error?.message || error) }),
      }).catch(() => {});
    }
  }
  return { disabled: false, sent };
}

export async function runOnce() {
  await supportBridgeFetch("/support-bridge/heartbeat", { method: "POST", body: JSON.stringify({ mailboxAddress, status: "RUNNING", intervalMs }) });
  try {
    const sync = await syncMailbox();
    const outbox = await sendOutbox();
    const result = `Scanned ${sync.scanned}; accepted ${sync.accepted}; ignored ${sync.ignored}; sent ${outbox.sent || 0}`;
    await supportBridgeFetch("/support-bridge/heartbeat", { method: "POST", body: JSON.stringify({ mailboxAddress, status: "IDLE", scanned: sync.scanned, ignored: sync.ignored, result, intervalMs }) });
    console.log(JSON.stringify({ ok: true, sync, outbox, at: new Date().toISOString() }));
    return { ok: true, sync, outbox, result };
  } catch (error) {
    await supportBridgeFetch("/support-bridge/heartbeat", { method: "POST", body: JSON.stringify({ mailboxAddress, status: "ERROR", error: String(error?.message || error), result: "Mailbox agent failed", intervalMs }) }).catch(() => {});
    throw error;
  }
}

async function main() {
  await runOnce();
  if (!process.argv.includes("--watch")) return;
  while (!stopRequested) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    if (stopRequested) break;
    await runOnce().catch(error => console.error(JSON.stringify({ ok: false, error: error.message, at: new Date().toISOString() })));
  }
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => { stopRequested = true; });
}

const executedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}

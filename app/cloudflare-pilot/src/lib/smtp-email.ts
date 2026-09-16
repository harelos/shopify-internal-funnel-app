import { workerEnvValue } from "./shopify-config.js";
import { buildNovaHairSummaryEmailBody, type NovaHairSummaryEmail } from "./novahair-summary-email.js";

type CloudflareSocket = ReturnType<(typeof import("cloudflare:sockets"))["connect"]>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodedHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function bodyBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
}

interface SmtpHeaderOptions {
  fromName?: string;
  messageId?: string;
  inReplyTo?: string | null;
  references?: string | null;
}

async function smtpSession(socket: CloudflareSocket, recipient: string, subjectText: string, bodyText: string, sender: string, password: string, headers: SmtpHeaderOptions = {}): Promise<void> {
  await socket.opened;
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  let buffered = "";

  async function response(expected: number[]): Promise<void> {
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline !== -1) {
        const line = buffered.slice(0, newline + 1).trimEnd();
        buffered = buffered.slice(newline + 1);
        const match = line.match(/^(\d{3})([ -])/);
        if (match?.[2] === " ") {
          const codeNumber = Number(match[1]);
          if (!expected.includes(codeNumber)) throw new Error(`smtp_${codeNumber}`);
          return;
        }
        continue;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error("smtp_connection_closed");
      buffered += decoder.decode(chunk.value, { stream: true });
      if (buffered.length > 32_768) throw new Error("smtp_response_too_large");
    }
  }

  async function command(value: string, expected: number[]): Promise<void> {
    await writer.write(encoder.encode(`${value}\r\n`));
    await response(expected);
  }

  try {
    await response([220]);
    await command("EHLO tigerbrandsglobal.com", [250]);
    await command("AUTH LOGIN", [334]);
    await command(Buffer.from(sender, "utf8").toString("base64"), [334]);
    await command(Buffer.from(password, "utf8").toString("base64"), [235]);
    await command(`MAIL FROM:<${sender}>`, [250]);
    await command(`RCPT TO:<${recipient}>`, [250, 251]);
    await command("DATA", [354]);
    const subject = encodedHeader(subjectText);
    const messageId = headers.messageId || `<${crypto.randomUUID()}@tigerbrandsglobal.com>`;
    const headerLines = [
      `From: ${encodedHeader(headers.fromName || "NovaHair")} <${sender}>`,
      `To: <${recipient}>`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
    ];
    // Threading headers make the reply land inside the customer's original
    // thread instead of as a new, orphaned message.
    if (headers.inReplyTo) headerLines.push(`In-Reply-To: ${headers.inReplyTo}`);
    if (headers.references) headerLines.push(`References: ${headers.references}`);
    const message = [
      ...headerLines,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      bodyBase64(bodyText),
      ".",
    ].join("\r\n");
    await writer.write(encoder.encode(`${message}\r\n`));
    await response([250]);
    await command("QUIT", [221]);
  } finally {
    reader.releaseLock();
    writer.releaseLock();
    await socket.close().catch(() => undefined);
  }
}

export async function sendNovaHairOtp(recipient: string, code: string): Promise<boolean> {
  const sender = workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER").toLowerCase();
  const password = workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_PASSWORD");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) || !password || !/^\d{6}$/.test(code)) return false;

  let socket: CloudflareSocket | null = null;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("smtp_timeout")), 12_000);
  });
  try {
    const { connect } = await import("cloudflare:sockets");
    socket = connect({ hostname: "mail.privateemail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
    await Promise.race([smtpSession(
      socket,
      recipient,
      "קוד האימות שלך ל־NovaHair",
      `קוד האימות שלך הוא ${code}. הקוד תקף ל־10 דקות.`,
      sender,
      password,
    ), timeout]);
    return true;
  } catch (error) {
    console.error("[NOVA AI SMTP FAILED]", String(error instanceof Error ? error.message : error).slice(0, 160));
    if (socket) await socket.close().catch(() => undefined);
    return false;
  }
}

export async function sendNovaHairConciergeSummary(recipient: string, input: NovaHairSummaryEmail): Promise<boolean> {
  const sender = workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER").toLowerCase();
  const password = workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_PASSWORD");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !password) return false;

  let socket: CloudflareSocket | null = null;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("smtp_timeout")), 12_000);
  });
  try {
    const { connect } = await import("cloudflare:sockets");
    socket = connect({ hostname: "mail.privateemail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
    await Promise.race([smtpSession(
      socket,
      recipient,
      "הסיכום שלך מנעמה ב־NovaHair",
      buildNovaHairSummaryEmailBody(input),
      sender,
      password,
    ), timeout]);
    return true;
  } catch (error) {
    console.error("[NOVA AI SUMMARY EMAIL FAILED]", String(error instanceof Error ? error.message : error).slice(0, 160));
    if (socket) await socket.close().catch(() => undefined);
    return false;
  }
}

export interface SupportReplyEmailInput {
  to: string;
  subject: string;
  body: string;
  messageId?: string;
  inReplyTo?: string | null;
  references?: string | null;
}

/**
 * Sends one support reply as the real mailbox, over the same Cloudflare socket
 * path the concierge emails use.
 *
 * Railway blocks outbound SMTP, so the reply never left the building. The
 * Worker authenticates as support@ against the domain's own mail host, so SPF
 * and DKIM are already correct and deliverability is a normal first-party send
 * — no third-party provider or new DNS required. Returns the outcome so the
 * caller can mark the draft SENT or leave it for retry.
 */
export async function sendSupportReplyEmail(input: SupportReplyEmailInput): Promise<{ ok: boolean; error?: string }> {
  const sender = workerEnvValue("SUPPORT_MAILBOX_ADDRESS").toLowerCase()
    || workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_USER").toLowerCase();
  const password = workerEnvValue("NAMECHEAP_PRIVATE_EMAIL_PASSWORD");
  const recipient = String(input.to || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender) || !password) return { ok: false, error: "mailbox_not_configured" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { ok: false, error: "invalid_recipient" };
  if (!input.body || !input.body.trim()) return { ok: false, error: "empty_body" };

  let socket: CloudflareSocket | null = null;
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("smtp_timeout")), 15_000);
  });
  try {
    const { connect } = await import("cloudflare:sockets");
    socket = connect({ hostname: "mail.privateemail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
    await Promise.race([
      smtpSession(socket, recipient, input.subject || "Tiger Brands Global", input.body, sender, password, {
        fromName: "Tiger Brands Global",
        messageId: input.messageId,
        inReplyTo: input.inReplyTo,
        references: input.references || input.inReplyTo || null,
      }),
      timeout,
    ]);
    return { ok: true };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 160);
    console.error("[SUPPORT SMTP FAILED]", message);
    if (socket) await socket.close().catch(() => undefined);
    return { ok: false, error: message };
  }
}

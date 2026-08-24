import { ImapFlow } from "imapflow";
import PostalMime from "postal-mime";

import { assertSupportImapReadEnabled, type SupportConfig } from "./config.js";
import type { SupportMessageInput } from "./types.js";

export type SupportMailboxProbe = {
  source: "IMAP";
  mailbox: string;
  messageCount: number;
  readOnly: true;
};

type PostalAddressLike = {
  address?: string;
  group?: PostalAddressLike[];
};

function cleanAddress(value: string | undefined | null): string | null {
  const address = (value || "").trim().toLowerCase();
  return address && address.includes("@") ? address : null;
}

function flattenAddresses(values: unknown): string[] {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const output: string[] = [];

  const visit = (value: PostalAddressLike): void => {
    const address = cleanAddress(value?.address);
    if (address) output.push(address);
    for (const grouped of value?.group || []) visit(grouped);
  };

  for (const item of list) visit((item || {}) as PostalAddressLike);
  return [...new Set(output)];
}

function normalizeReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => normalizeReferences(item)))];
  }
  if (typeof value !== "string") return [];

  const bracketed = value.match(/<[^>]+>/g);
  if (bracketed?.length) return [...new Set(bracketed.map((item) => item.trim()))];
  return [...new Set(value.split(/\s+/).map((item) => item.trim()).filter(Boolean))];
}

function safeDate(value: unknown, fallback?: Date): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return fallback && Number.isFinite(fallback.getTime()) ? fallback : new Date(0);
}

function stripHtml(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function bounded(value: string | undefined | null, limit: number): string {
  if (!value) return "";
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n[truncated by support staging ingest]`;
}

export async function parseSupportRawMessage(
  source: Buffer | Uint8Array,
  fallback: {
    uid: number;
    uidValidity: string;
    mailbox: string;
    fallbackDate?: Date;
    fallbackSubject?: string;
    fallbackFrom?: string;
    fallbackTo?: string[];
  },
): Promise<SupportMessageInput> {
  const parsed = await PostalMime.parse(source);
  const from = flattenAddresses(parsed.from)[0] || cleanAddress(fallback.fallbackFrom) || "unknown@example.invalid";
  const to = [...new Set([
    ...flattenAddresses(parsed.to),
    ...flattenAddresses(parsed.cc),
    ...(fallback.fallbackTo || []).map((value) => cleanAddress(value)).filter((value): value is string => Boolean(value)),
  ])];

  const messageId = (parsed.messageId || "").trim()
    || `imap:${fallback.mailbox}:${fallback.uidValidity}:${fallback.uid}`;
  const references = normalizeReferences(parsed.references);
  const inReplyTo = (parsed.inReplyTo || "").trim() || null;
  const html = bounded(parsed.html || "", 250_000);
  const text = bounded(parsed.text || stripHtml(html), 200_000);

  return {
    messageId,
    inReplyTo,
    references,
    from,
    to,
    subject: (parsed.subject || fallback.fallbackSubject || "(no subject)").trim(),
    sentAt: safeDate(parsed.date, fallback.fallbackDate),
    text,
    html: html || null,
  };
}

function envelopeAddresses(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => cleanAddress((item as { address?: string })?.address))
    .filter((value): value is string => Boolean(value));
}

export class ImapSupportMailboxSource {
  readonly name = "IMAP" as const;

  constructor(private readonly config: SupportConfig) {}

  private createClient(): ImapFlow {
    assertSupportImapReadEnabled(this.config);
    return new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: this.config.imapSecure,
      auth: {
        user: this.config.imapUsername,
        pass: this.config.imapPassword,
      },
      logger: false,
    });
  }

  async probe(): Promise<SupportMailboxProbe> {
    const client = this.createClient();
    await client.connect();
    try {
      const lock = await client.getMailboxLock(this.config.imapMailbox, { readOnly: true });
      try {
        const mailbox = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
        return {
          source: "IMAP",
          mailbox: this.config.imapMailbox,
          messageCount: mailbox?.exists || 0,
          readOnly: true,
        };
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { client.close(); }
    }
  }

  async readRecent(limit: number): Promise<SupportMessageInput[]> {
    const client = this.createClient();
    await client.connect();

    try {
      const lock = await client.getMailboxLock(this.config.imapMailbox, { readOnly: true });
      try {
        const mailbox = client.mailbox && typeof client.mailbox === "object" ? client.mailbox : null;
        const exists = mailbox?.exists || 0;
        if (exists <= 0) return [];

        const count = Math.max(1, Math.min(limit, exists));
        const startSequence = Math.max(1, exists - count + 1);
        const metadata = await client.fetchAll(`${startSequence}:*`, {
          uid: true,
          size: true,
          envelope: true,
          internalDate: true,
        });

        const uidValidity = String(mailbox?.uidValidity || "unknown");
        const output: SupportMessageInput[] = [];

        for (const item of [...metadata].reverse()) {
          const uid = Number(item.uid || 0);
          if (!uid) continue;
          if (item.size && item.size > this.config.maxSourceBytes) continue;

          const full = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
          if (!full?.source) continue;

          const raw = Buffer.isBuffer(full.source) ? full.source : Buffer.from(full.source);
          if (raw.byteLength > this.config.maxSourceBytes) continue;

          const envelope = (full.envelope || item.envelope || {}) as {
            subject?: string;
            date?: Date;
            from?: Array<{ address?: string }>;
            to?: Array<{ address?: string }>;
          };

          output.push(await parseSupportRawMessage(raw, {
            uid,
            uidValidity,
            mailbox: this.config.imapMailbox,
            fallbackDate: full.internalDate || item.internalDate || envelope.date,
            fallbackSubject: envelope.subject,
            fallbackFrom: envelopeAddresses(envelope.from)[0],
            fallbackTo: envelopeAddresses(envelope.to),
          }));
        }

        return output.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()).slice(0, limit);
      } finally {
        lock.release();
      }
    } finally {
      try { await client.logout(); } catch { client.close(); }
    }
  }
}

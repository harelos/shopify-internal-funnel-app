import prisma from "../lib/db.js";
import { assertSupportStagingEnabled, getSupportConfig } from "./config.js";
import { supportMailboxSource } from "./mailbox-source.js";
import { buildSupportThreads } from "./threading.js";
import type { SupportMessageInput, SupportThreadInput } from "./types.js";

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function directionFor(message: SupportMessageInput, mailboxAddress: string): "INBOUND" | "OUTBOUND" {
  return normalizeAddress(message.from) === normalizeAddress(mailboxAddress) ? "OUTBOUND" : "INBOUND";
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function persistThread(thread: SupportThreadInput, mailboxAddress: string, source: string): Promise<void> {
  const latest = thread.messages[thread.messages.length - 1];
  if (!latest) return;

  const stored = await prisma.supportThread.upsert({
    where: { externalKey: thread.threadKey },
    update: {
      subject: thread.subject,
      participantsJson: JSON.stringify(thread.participants),
      category: thread.classification.category,
      confidence: thread.classification.confidence,
      urgency: thread.classification.urgency,
      summary: thread.classification.summary,
      requiresHuman: thread.classification.requiresHuman,
      source,
      lastMessageAt: latest.sentAt,
    },
    create: {
      externalKey: thread.threadKey,
      subject: thread.subject,
      participantsJson: JSON.stringify(thread.participants),
      category: thread.classification.category,
      confidence: thread.classification.confidence,
      urgency: thread.classification.urgency,
      summary: thread.classification.summary,
      requiresHuman: thread.classification.requiresHuman,
      source,
      lastMessageAt: latest.sentAt,
    },
  });

  for (const message of thread.messages) {
    await prisma.supportMessage.upsert({
      where: { messageId: message.messageId },
      update: {
        threadId: stored.id,
        inReplyTo: message.inReplyTo || null,
        referencesJson: JSON.stringify(message.references || []),
        fromAddress: message.from,
        toAddressesJson: JSON.stringify(message.to),
        subject: message.subject,
        direction: directionFor(message, mailboxAddress),
        sentAt: message.sentAt,
        textBody: message.text,
        htmlBody: message.html || null,
      },
      create: {
        threadId: stored.id,
        messageId: message.messageId,
        inReplyTo: message.inReplyTo || null,
        referencesJson: JSON.stringify(message.references || []),
        fromAddress: message.from,
        toAddressesJson: JSON.stringify(message.to),
        subject: message.subject,
        direction: directionFor(message, mailboxAddress),
        sentAt: message.sentAt,
        textBody: message.text,
        htmlBody: message.html || null,
      },
    });
  }
}

export async function syncSupportStaging(): Promise<{ source: string; messages: number; threads: number }> {
  const config = getSupportConfig();
  assertSupportStagingEnabled(config);

  const source = supportMailboxSource(config);
  const messages = await source.readRecent(config.syncLimit);
  const threads = buildSupportThreads(messages);

  for (const thread of threads) {
    await persistThread(thread, config.mailboxAddress, source.name);
  }

  return { source: source.name, messages: messages.length, threads: threads.length };
}

export async function listSupportThreads(limit = 100) {
  const safeLimit = Math.max(1, Math.min(limit, 250));
  const rows = await prisma.supportThread.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: safeLimit,
    include: {
      _count: { select: { messages: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    externalKey: row.externalKey,
    subject: row.subject,
    participants: parseJsonArray(row.participantsJson),
    category: row.category,
    confidence: row.confidence,
    urgency: row.urgency,
    summary: row.summary,
    requiresHuman: row.requiresHuman,
    status: row.status,
    source: row.source,
    lastMessageAt: row.lastMessageAt,
    messageCount: row._count.messages,
    latestMessage: row.messages[0]
      ? {
          from: row.messages[0].fromAddress,
          direction: row.messages[0].direction,
          text: row.messages[0].textBody,
          sentAt: row.messages[0].sentAt,
        }
      : null,
  }));
}

export async function getSupportThread(id: string) {
  const row = await prisma.supportThread.findUnique({
    where: { id },
    include: { messages: { orderBy: { sentAt: "asc" } } },
  });
  if (!row) return null;

  return {
    id: row.id,
    externalKey: row.externalKey,
    subject: row.subject,
    participants: parseJsonArray(row.participantsJson),
    category: row.category,
    confidence: row.confidence,
    urgency: row.urgency,
    summary: row.summary,
    requiresHuman: row.requiresHuman,
    status: row.status,
    source: row.source,
    lastMessageAt: row.lastMessageAt,
    messages: row.messages.map((message) => ({
      id: message.id,
      messageId: message.messageId,
      inReplyTo: message.inReplyTo,
      references: parseJsonArray(message.referencesJson),
      from: message.fromAddress,
      to: parseJsonArray(message.toAddressesJson),
      subject: message.subject,
      direction: message.direction,
      sentAt: message.sentAt,
      text: message.textBody,
      html: message.htmlBody,
    })),
  };
}

export async function supportOverview() {
  const [totalThreads, needsHuman, categories] = await Promise.all([
    prisma.supportThread.count(),
    prisma.supportThread.count({ where: { requiresHuman: true } }),
    prisma.supportThread.groupBy({
      by: ["category"],
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
    }),
  ]);

  return {
    totalThreads,
    needsHuman,
    categories: categories.map((row) => ({ category: row.category, count: row._count.category })),
  };
}

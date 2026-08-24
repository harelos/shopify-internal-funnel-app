import crypto from "node:crypto";
import type { SupportMessageInput, SupportThread } from "./types.js";

const RE_PREFIX = /^(re|fw|fwd):\s*/i;

export function normalizeSubject(subject: string): string {
  let value = subject.trim();
  while (RE_PREFIX.test(value)) value = value.replace(RE_PREFIX, "").trim();
  return value.toLowerCase().replace(/\s+/g, " ");
}

function domainlessAddress(value: string): string {
  return value.trim().toLowerCase();
}

function fallbackThreadKey(message: SupportMessageInput): string {
  const participants = [message.from, ...message.to]
    .map(domainlessAddress)
    .filter(Boolean)
    .sort();
  const seed = `${normalizeSubject(message.subject)}|${participants.join("|")}`;
  return `subject:${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

export function buildThreads(messages: SupportMessageInput[]): SupportThread[] {
  const byMessageId = new Map(messages.map((message) => [message.messageId, message]));
  const groups = new Map<string, SupportMessageInput[]>();

  for (const message of messages) {
    const referenced = [message.inReplyTo, ...(message.references || [])]
      .filter((id): id is string => Boolean(id))
      .find((id) => byMessageId.has(id));

    const key = referenced ? `ref:${referenced}` : fallbackThreadKey(message);
    const group = groups.get(key) || [];
    group.push(message);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([threadKey, grouped]) => {
    const sorted = [...grouped].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const participants = new Set<string>();
    for (const message of sorted) {
      participants.add(domainlessAddress(message.from));
      message.to.forEach((address) => participants.add(domainlessAddress(address)));
    }
    return {
      threadKey,
      subject: sorted.at(-1)?.subject || "(no subject)",
      participants: [...participants].filter(Boolean),
      messages: sorted,
    };
  });
}

import crypto from "node:crypto";
import { classifySupportMessage } from "./classifier.js";
import type { SupportMessageInput, SupportThreadInput } from "./types.js";

const RE_PREFIX = /^(re|fw|fwd):\s*/i;

export function normalizeSupportSubject(subject: string): string {
  let value = subject.trim();
  while (RE_PREFIX.test(value)) value = value.replace(RE_PREFIX, "").trim();
  return value.toLowerCase().replace(/\s+/g, " ");
}

function normalizeAddress(value: string): string {
  return value.trim().toLowerCase();
}

function fallbackSignature(message: SupportMessageInput): string {
  const participants = [message.from, ...message.to]
    .map(normalizeAddress)
    .filter(Boolean)
    .sort();
  return `${normalizeSupportSubject(message.subject)}|${participants.join("|")}`;
}

function stableThreadKey(messages: SupportMessageInput[]): string {
  const knownIds = messages.map((message) => message.messageId).filter(Boolean).sort();
  const seed = knownIds.length > 0
    ? knownIds.join("|")
    : messages.map(fallbackSignature).sort().join("|");
  return `support:${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32)}`;
}

export function buildSupportThreads(messages: SupportMessageInput[]): SupportThreadInput[] {
  const deduped = [...new Map(messages.map((message) => [message.messageId, message])).values()];
  const indexById = new Map(deduped.map((message, index) => [message.messageId, index]));
  const parent = deduped.map((_, index) => index);

  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };

  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  deduped.forEach((message, index) => {
    const links = [message.inReplyTo, ...(message.references || [])].filter((value): value is string => Boolean(value));
    for (const linkedId of links) {
      const linkedIndex = indexById.get(linkedId);
      if (linkedIndex != null) union(index, linkedIndex);
    }
  });

  // When a bounded sync omits the original referenced message, fall back to
  // normalized subject + participants so a recent reply chain still appears as one thread.
  const firstByFallback = new Map<string, number>();
  deduped.forEach((message, index) => {
    const signature = fallbackSignature(message);
    const prior = firstByFallback.get(signature);
    if (prior == null) firstByFallback.set(signature, index);
    else union(index, prior);
  });

  const groups = new Map<number, SupportMessageInput[]>();
  deduped.forEach((message, index) => {
    const root = find(index);
    const group = groups.get(root) || [];
    group.push(message);
    groups.set(root, group);
  });

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
      const latest = sorted[sorted.length - 1];
      const participants = new Set<string>();
      for (const message of sorted) {
        participants.add(normalizeAddress(message.from));
        message.to.forEach((address) => participants.add(normalizeAddress(address)));
      }

      return {
        threadKey: stableThreadKey(sorted),
        subject: latest?.subject || "(no subject)",
        participants: [...participants].filter(Boolean).sort(),
        messages: sorted,
        classification: classifySupportMessage(latest),
      };
    })
    .sort((a, b) => {
      const aTime = a.messages[a.messages.length - 1]?.sentAt.getTime() || 0;
      const bTime = b.messages[b.messages.length - 1]?.sentAt.getTime() || 0;
      return bTime - aTime;
    });
}

import { assertSupportReadOnlyReady, getSupportConfig } from "./config.js";
import { classifyLocally } from "./classifier.js";
import { buildThreads } from "./threading.js";
import type { SupportMailboxReader } from "./imap-contract.js";

export async function previewSupportSync(reader: SupportMailboxReader) {
  const config = getSupportConfig();
  assertSupportReadOnlyReady(config);

  const messages = await reader.readRecent(config.syncLimit);
  const threads = buildThreads(messages);

  return threads.map((thread) => {
    const latest = thread.messages.at(-1)!;
    return {
      threadKey: thread.threadKey,
      subject: thread.subject,
      participants: thread.participants,
      messageCount: thread.messages.length,
      lastMessageAt: latest.sentAt,
      classification: classifyLocally(latest),
    };
  });
}

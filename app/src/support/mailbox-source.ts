import { supportFixtureMessages } from "./fixture-source.js";
import { ImapSupportMailboxSource, type SupportMailboxProbe } from "./imap-source.js";
import type { SupportConfig } from "./config.js";
import type { SupportMessageInput } from "./types.js";

export interface SupportMailboxSource {
  readonly name: string;
  readRecent(limit: number): Promise<SupportMessageInput[]>;
  probe(): Promise<SupportMailboxProbe | { source: "FIXTURE"; mailbox: "fixture"; messageCount: number; readOnly: true }>;
}

class FixtureMailboxSource implements SupportMailboxSource {
  readonly name = "FIXTURE";

  constructor(private readonly mailboxAddress: string) {}

  async readRecent(limit: number): Promise<SupportMessageInput[]> {
    return supportFixtureMessages(this.mailboxAddress)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }

  async probe() {
    return {
      source: "FIXTURE" as const,
      mailbox: "fixture" as const,
      messageCount: supportFixtureMessages(this.mailboxAddress).length,
      readOnly: true as const,
    };
  }
}

export function supportMailboxSource(config: SupportConfig): SupportMailboxSource {
  if (config.syncSource === "imap") return new ImapSupportMailboxSource(config);
  return new FixtureMailboxSource(config.mailboxAddress);
}

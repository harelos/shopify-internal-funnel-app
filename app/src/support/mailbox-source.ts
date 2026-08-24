import { supportFixtureMessages } from "./fixture-source.js";
import type { SupportConfig } from "./config.js";
import type { SupportMessageInput } from "./types.js";

export interface SupportMailboxSource {
  readonly name: string;
  readRecent(limit: number): Promise<SupportMessageInput[]>;
}

class FixtureMailboxSource implements SupportMailboxSource {
  readonly name = "FIXTURE";

  constructor(private readonly mailboxAddress: string) {}

  async readRecent(limit: number): Promise<SupportMessageInput[]> {
    return supportFixtureMessages(this.mailboxAddress)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }
}

class UnwiredImapMailboxSource implements SupportMailboxSource {
  readonly name = "IMAP";

  async readRecent(_limit: number): Promise<SupportMessageInput[]> {
    throw new Error(
      "Namecheap IMAP is intentionally unwired in this staging slice. Add the audited read-only IMAPS adapter before setting SUPPORT_SYNC_SOURCE=imap.",
    );
  }
}

export function supportMailboxSource(config: SupportConfig): SupportMailboxSource {
  if (config.syncSource === "imap") return new UnwiredImapMailboxSource();
  return new FixtureMailboxSource(config.mailboxAddress);
}

import type { SupportMailboxReader } from "./imap-contract.js";
import type { SupportMessageInput } from "./types.js";

export class FixtureMailboxReader implements SupportMailboxReader {
  constructor(private readonly messages: SupportMessageInput[]) {}

  async readRecent(limit: number): Promise<SupportMessageInput[]> {
    return [...this.messages]
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit);
  }
}

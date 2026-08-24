import type { SupportMessageInput } from "./types.js";

/**
 * Phase 1 deliberately depends on this tiny abstraction instead of exposing the
 * rest of the application to an IMAP library. The concrete Namecheap IMAPS
 * adapter can be swapped or tested without changing support-domain logic.
 */
export interface SupportMailboxReader {
  readRecent(limit: number): Promise<SupportMessageInput[]>;
}

/**
 * Stub used until the repository's package/runtime integration is inspected and
 * the IMAP dependency is wired. It makes accidental live mailbox access
 * impossible by default.
 */
export class DisabledMailboxReader implements SupportMailboxReader {
  async readRecent(_limit: number): Promise<SupportMessageInput[]> {
    throw new Error("Live support mailbox reader is not configured in this build.");
  }
}

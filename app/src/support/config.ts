export type SupportSyncSource = "fixture" | "imap";

export type SupportConfig = {
  stagingEnabled: boolean;
  syncSource: SupportSyncSource;
  mailboxAddress: string;
  syncLimit: number;
  imapReadEnabled: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  imapMailbox: string;
  maxSourceBytes: number;
  sendEnabled: false;
  shopifyMutationEnabled: false;
};

function asBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function asInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getSupportConfig(env: NodeJS.ProcessEnv = process.env): SupportConfig {
  const source = (env.SUPPORT_SYNC_SOURCE || "fixture").toLowerCase();
  const username = (env.SUPPORT_IMAP_USERNAME || "").trim();
  const mailboxAddress = (env.SUPPORT_MAILBOX_ADDRESS || username || "support@example.test").trim().toLowerCase();

  return {
    stagingEnabled: asBool(env.SUPPORT_STAGING_ENABLED, false),
    syncSource: source === "imap" ? "imap" : "fixture",
    mailboxAddress,
    syncLimit: Math.max(1, Math.min(asInt(env.SUPPORT_SYNC_LIMIT, 250), 1000)),
    imapReadEnabled: asBool(env.SUPPORT_IMAP_READ_ENABLED, false),
    imapHost: (env.SUPPORT_IMAP_HOST || "mail.privateemail.com").trim(),
    imapPort: Math.max(1, Math.min(asInt(env.SUPPORT_IMAP_PORT, 993), 65535)),
    imapSecure: asBool(env.SUPPORT_IMAP_SECURE, true),
    imapUsername: username,
    imapPassword: env.SUPPORT_IMAP_PASSWORD || "",
    imapMailbox: (env.SUPPORT_IMAP_MAILBOX || "INBOX").trim() || "INBOX",
    maxSourceBytes: Math.max(64 * 1024, Math.min(asInt(env.SUPPORT_IMAP_MAX_SOURCE_BYTES, 2 * 1024 * 1024), 10 * 1024 * 1024)),
    sendEnabled: false,
    shopifyMutationEnabled: false,
  };
}

export function assertSupportStagingEnabled(config = getSupportConfig()): void {
  if (!config.stagingEnabled) {
    throw new Error("Support staging is disabled. Set SUPPORT_STAGING_ENABLED=true explicitly.");
  }
}

export function assertSupportImapReadEnabled(config = getSupportConfig()): void {
  assertSupportStagingEnabled(config);
  if (config.syncSource !== "imap") {
    throw new Error("Support IMAP read requested while SUPPORT_SYNC_SOURCE is not set to imap.");
  }
  if (!config.imapReadEnabled) {
    throw new Error("Support IMAP read is disabled. Set SUPPORT_IMAP_READ_ENABLED=true explicitly in staging.");
  }
  if (!config.imapUsername || !config.imapPassword) {
    throw new Error("Support IMAP credentials are incomplete. Configure SUPPORT_IMAP_USERNAME and SUPPORT_IMAP_PASSWORD in the staging secret manager.");
  }
  if (config.imapHost === "mail.privateemail.com" && !config.imapSecure) {
    throw new Error("Namecheap Private Email must use secure IMAPS in this app.");
  }
}

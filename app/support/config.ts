export type SupportConfig = {
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUsername: string;
  imapPassword: string;
  mailbox: string;
  syncLimit: number;
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
  return {
    enabled: asBool(env.SUPPORT_STAGING_ENABLED, false),
    imapHost: env.SUPPORT_IMAP_HOST || "mail.privateemail.com",
    imapPort: asInt(env.SUPPORT_IMAP_PORT, 993),
    imapSecure: asBool(env.SUPPORT_IMAP_SECURE, true),
    imapUsername: env.SUPPORT_IMAP_USERNAME || "",
    imapPassword: env.SUPPORT_IMAP_PASSWORD || "",
    mailbox: env.SUPPORT_IMAP_MAILBOX || "INBOX",
    syncLimit: Math.max(1, Math.min(asInt(env.SUPPORT_SYNC_LIMIT, 250), 1000)),
  };
}

export function assertSupportReadOnlyReady(config: SupportConfig): void {
  if (!config.enabled) {
    throw new Error("Support staging is disabled. Set SUPPORT_STAGING_ENABLED=true explicitly.");
  }
  if (!config.imapUsername || !config.imapPassword) {
    throw new Error("Support IMAP credentials are missing.");
  }
  if (config.imapPort <= 0 || config.imapPort > 65535) {
    throw new Error("SUPPORT_IMAP_PORT is invalid.");
  }
}

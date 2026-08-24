export type SupportSyncSource = "fixture" | "imap";

export type SupportConfig = {
  stagingEnabled: boolean;
  syncSource: SupportSyncSource;
  mailboxAddress: string;
  syncLimit: number;
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
  return {
    stagingEnabled: asBool(env.SUPPORT_STAGING_ENABLED, false),
    syncSource: source === "imap" ? "imap" : "fixture",
    mailboxAddress: (env.SUPPORT_MAILBOX_ADDRESS || "support@example.test").trim().toLowerCase(),
    syncLimit: Math.max(1, Math.min(asInt(env.SUPPORT_SYNC_LIMIT, 250), 1000)),
    sendEnabled: false,
    shopifyMutationEnabled: false,
  };
}

export function assertSupportStagingEnabled(config = getSupportConfig()): void {
  if (!config.stagingEnabled) {
    throw new Error("Support staging is disabled. Set SUPPORT_STAGING_ENABLED=true explicitly.");
  }
}

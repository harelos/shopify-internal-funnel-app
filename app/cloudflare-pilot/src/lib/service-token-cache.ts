import { env as cloudflareEnv } from "cloudflare:workers";

type D1Like = {
  prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first(): Promise<any> } };
};

function db(): D1Like | null {
  const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
  return envObj?.DB ?? null;
}

/**
 * Stores a third-party access token across Worker invocations.
 *
 * An isolate keeps an in-memory token only until it is recycled, so a provider
 * that rate-limits authentication will lock the account out when a frequent
 * cron re-authenticates on every run.
 */
export async function readCachedToken(id: string, safetyWindowMs = 60_000): Promise<string | null> {
  const store = db();
  if (!store) return null;
  try {
    const row = await store.prepare(`SELECT "token", "expiresAt" FROM "ServiceTokenCache" WHERE "id" = ? LIMIT 1`).bind(id).first();
    if (!row?.token) return null;
    const expiresAt = Date.parse(String(row.expiresAt));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + safetyWindowMs) return null;
    return String(row.token);
  } catch {
    return null;
  }
}

export async function writeCachedToken(id: string, token: string, expiresAt: number): Promise<void> {
  const store = db();
  if (!store || !token) return;
  try {
    await store.prepare(`
      INSERT INTO "ServiceTokenCache" ("id", "token", "expiresAt", "updatedAt")
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("id") DO UPDATE SET "token" = excluded."token", "expiresAt" = excluded."expiresAt", "updatedAt" = CURRENT_TIMESTAMP
    `).bind(id, token, new Date(expiresAt).toISOString()).run();
  } catch {
    // A token that cannot be cached still works for this invocation.
  }
}

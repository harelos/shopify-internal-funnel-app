import { env as cloudflareEnv } from "cloudflare:workers";

type SupportWorkerEnv = { DB?: D1Database };

export function supportD1(): D1Database {
  const runtimeEnv = (cloudflareEnv as SupportWorkerEnv | undefined) ?? (globalThis as typeof globalThis & {
    __SHOPIFY_WORKER_ENV__?: SupportWorkerEnv;
  }).__SHOPIFY_WORKER_ENV__;
  if (!runtimeEnv?.DB) throw new Error("Cloudflare D1 binding DB is unavailable in the current request context.");
  return runtimeEnv.DB;
}

export function supportId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function supportNow(): string {
  return new Date().toISOString();
}

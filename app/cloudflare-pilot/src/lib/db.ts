import { env as cloudflareEnv } from "cloudflare:workers";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

type WorkerRuntimeEnv = { DB?: D1Database };

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (client) return client;

  const workerEnv = (cloudflareEnv as WorkerRuntimeEnv | undefined) ?? (globalThis as typeof globalThis & {
    __SHOPIFY_WORKER_ENV__?: WorkerRuntimeEnv;
  }).__SHOPIFY_WORKER_ENV__;

  if (!workerEnv?.DB) {
    throw new Error("Cloudflare D1 binding DB is unavailable in the current request context.");
  }

  client = new PrismaClient({ adapter: new PrismaD1(workerEnv.DB) });
  return client;
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const value = getClient()[property as keyof PrismaClient];
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});

export default prisma;

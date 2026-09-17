import { env as cloudflareEnv } from "cloudflare:workers";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

type WorkerRuntimeEnv = { DB?: D1Database };

function getClient(): PrismaClient {
  const workerEnv = (cloudflareEnv as WorkerRuntimeEnv | undefined) ?? (globalThis as typeof globalThis & {
    __SHOPIFY_WORKER_ENV__?: WorkerRuntimeEnv;
  }).__SHOPIFY_WORKER_ENV__;

  if (!workerEnv?.DB) {
    throw new Error("Cloudflare D1 binding DB is unavailable in the current request context.");
  }

  // Prisma's D1 adapter carries Cloudflare request context. Reusing a client
  // across requests can resolve promises in an expired request context.
  return new PrismaClient({ adapter: new PrismaD1(workerEnv.DB) });
}

const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const requestClient = getClient();
    const value = requestClient[property as keyof PrismaClient];
    return typeof value === "function" ? value.bind(requestClient) : value;
  },
});

export default prisma;

import { env as cloudflareEnv } from "cloudflare:workers";
import {
  CART_OFFER_CONFIG_ID,
  DEFAULT_CART_OFFER_CONFIG,
  type CartOfferConfig,
  validateCartOfferConfig,
} from "./cart-offer-config.js";

type RuntimeEnv = { DB?: D1Database };

export interface StoredCartOfferConfig {
  draft: CartOfferConfig;
  published: CartOfferConfig;
  draftRevision: number;
  publishedRevision: number;
  updatedAt: string | null;
  publishedAt: string | null;
  source: "database" | "defaults";
}

interface CartOfferRow {
  draftJson: string;
  publishedJson: string;
  draftRevision: number;
  publishedRevision: number;
  updatedAt: string;
  publishedAt: string;
}

function database(): D1Database {
  const runtime = (cloudflareEnv as RuntimeEnv | undefined) ?? (globalThis as typeof globalThis & {
    __SHOPIFY_WORKER_ENV__?: RuntimeEnv;
  }).__SHOPIFY_WORKER_ENV__;
  if (!runtime?.DB) throw new Error("Cloudflare D1 binding DB is unavailable.");
  return runtime.DB;
}

function parseConfig(raw: string): CartOfferConfig {
  const validated = validateCartOfferConfig(JSON.parse(raw));
  if (!validated.ok) throw new Error(validated.errors.join("; "));
  return validated.value;
}

export async function loadCartOfferConfig(): Promise<StoredCartOfferConfig> {
  const row = await database().prepare(`
    SELECT "draftJson", "publishedJson", "draftRevision", "publishedRevision", "updatedAt", "publishedAt"
    FROM "CartOfferConfig" WHERE "id" = ?
  `).bind(CART_OFFER_CONFIG_ID).first<CartOfferRow>();

  if (!row) {
    return {
      draft: structuredClone(DEFAULT_CART_OFFER_CONFIG),
      published: structuredClone(DEFAULT_CART_OFFER_CONFIG),
      draftRevision: 0,
      publishedRevision: 0,
      updatedAt: null,
      publishedAt: null,
      source: "defaults",
    };
  }

  try {
    return {
      draft: parseConfig(row.draftJson),
      published: parseConfig(row.publishedJson),
      draftRevision: Number(row.draftRevision) || 0,
      publishedRevision: Number(row.publishedRevision) || 0,
      updatedAt: row.updatedAt || null,
      publishedAt: row.publishedAt || null,
      source: "database",
    };
  } catch (error) {
    console.error("[CART OFFER CONFIG INVALID]", error);
    return {
      draft: structuredClone(DEFAULT_CART_OFFER_CONFIG),
      published: structuredClone(DEFAULT_CART_OFFER_CONFIG),
      draftRevision: 0,
      publishedRevision: 0,
      updatedAt: null,
      publishedAt: null,
      source: "defaults",
    };
  }
}

export async function saveCartOfferDraft(config: CartOfferConfig): Promise<StoredCartOfferConfig> {
  const current = await loadCartOfferConfig();
  await database().prepare(`
    INSERT INTO "CartOfferConfig" ("id", "draftJson", "publishedJson", "draftRevision", "publishedRevision", "updatedAt", "publishedAt")
    VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT("id") DO UPDATE SET
      "draftJson" = excluded."draftJson",
      "draftRevision" = "CartOfferConfig"."draftRevision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
  `).bind(
    CART_OFFER_CONFIG_ID,
    JSON.stringify(config),
    JSON.stringify(current.published),
    current.publishedRevision,
  ).run();
  return loadCartOfferConfig();
}

export async function publishCartOfferConfig(config: CartOfferConfig): Promise<StoredCartOfferConfig> {
  const current = await loadCartOfferConfig();
  await database().prepare(`
    INSERT INTO "CartOfferConfig" ("id", "draftJson", "publishedJson", "draftRevision", "publishedRevision", "updatedAt", "publishedAt")
    VALUES (?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT("id") DO UPDATE SET
      "draftJson" = excluded."draftJson",
      "publishedJson" = excluded."publishedJson",
      "draftRevision" = "CartOfferConfig"."draftRevision" + 1,
      "publishedRevision" = "CartOfferConfig"."publishedRevision" + 1,
      "updatedAt" = CURRENT_TIMESTAMP,
      "publishedAt" = CURRENT_TIMESTAMP
  `).bind(
    CART_OFFER_CONFIG_ID,
    JSON.stringify(config),
    JSON.stringify(config),
  ).run();
  const stored = await loadCartOfferConfig();
  return { ...stored, publishedRevision: Math.max(stored.publishedRevision, current.publishedRevision + 1) };
}

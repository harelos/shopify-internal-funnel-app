import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

async function miniflareConstructor() {
  try {
    const module = await import("miniflare");
    return {
      Miniflare: module.Miniflare,
      convertV4MiniflareOptions: module.convertV4MiniflareOptions,
    };
  } catch {
    const fallback = "C:/Users/Lenovo/Desktop/Shopify-Internal-Funnel-App/app/cloudflare-pilot/node_modules/miniflare/dist/src/index.js";
    const module = await import(pathToFileURL(fallback).href);
    return {
      Miniflare: module.Miniflare,
      convertV4MiniflareOptions: module.convertV4MiniflareOptions,
    };
  }
}

export async function testDatabase() {
  const { Miniflare, convertV4MiniflareOptions } = await miniflareConstructor();
  const instance = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch(){ return new Response('ok') } }",
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB"],
  }));
  const db = await instance.getD1Database("DB");
  const migrationDirectory = join(root, "migrations");
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of migrations) {
    const migration = await readFile(join(migrationDirectory, name), "utf8");
    const executableMigration = migration
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trim();
    const statements = executableMigration
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
  return { db, dispose: () => instance.dispose() };
}

export const TEST_EMAIL = "merchant-test@example.com";

export function testEnv(db: unknown, overrides: Record<string, unknown> = {}) {
  return {
    DB: db,
    APP_URL: "https://shopify-funnel-control.example.workers.dev",
    SHOP_DOMAIN: "jacobfelipe.myshopify.com",
    SHOPIFY_STOREFRONT_DOMAIN: "tigerbrandsglobal.com",
    SHOPIFY_API_VERSION: "2026-07",
    SHOPIFY_ACCESS_TOKEN: "test_shopify_token",
    SHOPIFY_WEBHOOK_SECRET: "test_shopify_webhook_secret",
    RESEND_API_KEY: "test_resend_key",
    RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from("01234567890123456789012345678901").toString("base64")}`,
    RESEND_FROM: "NovaHair <hello@email.tigerbrandsglobal.com>",
    RESEND_REPLY_TO: "support@tigerbrandsglobal.com",
    LIFECYCLE_MODE: "test",
    LIFECYCLE_ENABLED: "true",
    LIFECYCLE_TEST_EMAIL: TEST_EMAIL,
    LIFECYCLE_ALERT_EMAIL: TEST_EMAIL,
    LIFECYCLE_ACTIVATED_AT: "2026-09-08T00:00:00.000Z",
    LIFECYCLE_ADMIN_TOKEN: "test_admin_token",
    LIFECYCLE_DATA_KEY: "test-data-key-that-is-never-used-in-production",
    LIFECYCLE_HASH_KEY: "test-hash-key-that-is-never-used-in-production",
    LIFECYCLE_SYNC_INTERVAL_MINUTES: "10",
    LIFECYCLE_SYNC_OVERLAP_MINUTES: "30",
    ...overrides,
  };
}

export function checkoutFixture(id: string, options: Record<string, unknown> = {}) {
  const createdAt = String(options.createdAt ?? "2026-09-08T00:00:00.000Z");
  return {
    id,
    createdAt,
    updatedAt: String(options.updatedAt ?? createdAt),
    completedAt: options.completedAt === undefined ? null : options.completedAt,
    abandonedCheckoutUrl: String(options.abandonedCheckoutUrl ?? `https://jacobfelipe.myshopify.com/checkouts/cn/${encodeURIComponent(id)}/recover?key=sensitive-token&locale=he`),
    customer: {
      id: "gid://shopify/Customer/9001",
      firstName: "הראל",
      defaultEmailAddress: {
        emailAddress: String(options.email ?? TEST_EMAIL),
        marketingState: String(options.consent ?? "SUBSCRIBED"),
        marketingOptInLevel: "CONFIRMED_OPT_IN",
        marketingUpdatedAt: createdAt,
        validFormat: true,
      },
    },
    lineItems: {
      nodes: [{
        id: `gid://shopify/AbandonedCheckoutLineItem/${id}`,
        title: "NOVAHAIR — ערכת צביעה ביתית לשיער",
        variantTitle: "2 בקבוקים / חום כהה",
        sku: "NOVASALE-2-0-2-0-0-0",
        quantity: 2,
        image: { url: "https://cdn.shopify.com/product.png", altText: "NovaHair" },
      }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    totalPriceSet: { presentmentMoney: { amount: "189.00", currencyCode: "ILS" } },
  };
}

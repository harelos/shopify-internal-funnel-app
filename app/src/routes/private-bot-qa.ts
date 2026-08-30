import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { currentBotShopDomain, loadCurrentBotConfiguration } from "../lib/bot-config-store.js";
import { providerStatus } from "../lib/bot-provider.js";
import { publicShopifyStatus } from "../lib/shopify-config.js";
import { runBotTurn } from "../lib/bot-runtime.js";
import { executeBotTool } from "../lib/bot-tool-executor.js";
import type { BotProductSummary } from "../lib/bot-shopify-tools.js";

const router = Router({ mergeParams: true });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(__dirname, "../../private-qa/bot.html");
const customerPagePath = path.resolve(__dirname, "../../private-qa/customer.html");

// Fallbacks are intentionally non-secret except for one-way SHA-256 hashes.
// The plaintext QA password is never stored in Git. Render env vars can replace
// these values later without code changes.
const FALLBACK_SLUG = "7ca772619756";
const FALLBACK_USER_HASH = "9bba5c53a0545e0c80184b946153c9f58387e3bd1d4ee35740f29ac2e718b019";
const FALLBACK_PASSWORD_HASH = "079e8bb125b101343bcb737d211b6f22a47132f9fcde80dca1659bde751cd8a4";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function digestHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigestHex(value: string, expectedHex: string): boolean {
  let expected: Buffer;
  try { expected = Buffer.from(expectedHex, "hex"); } catch { return false; }
  const supplied = digest(value);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function configuredSlug(): string {
  return String(process.env.BOT_QA_PAGE_SLUG || FALLBACK_SLUG).trim();
}

function expectedUserHash(): string {
  const configured = String(process.env.BOT_QA_PAGE_USER || "").trim();
  return configured ? digestHex(configured) : FALLBACK_USER_HASH;
}

function expectedPasswordHash(): string {
  const configured = String(process.env.BOT_QA_PAGE_PASSWORD || "");
  return configured ? digestHex(configured) : FALLBACK_PASSWORD_HASH;
}

function parseBasicAuth(value: string): { username: string; password: string } | null {
  if (!value.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function productFacts(products: BotProductSummary[]): string {
  if (!products.length) return "Lookup completed: no matching Shopify product was found.";
  return products.slice(0, 3).map(product => {
    const variants = product.variants.slice(0, 20).map(variant => {
      const options = variant.selectedOptions.map(option => `${option.name}=${option.value}`).join(", ");
      return `- ${variant.title || "Default"}${options ? ` (${options})` : ""}: price=${variant.price ?? "unknown"}, compare_at=${variant.compareAtPrice ?? "none"}, available=${variant.availableForSale === null ? "unknown" : variant.availableForSale}`;
    }).join("\n");
    return [
      `Product: ${product.title}`,
      `id: ${product.id}`,
      `handle: ${product.handle}`,
      `status: ${product.status ?? "unknown"}`,
      `url: ${product.onlineStoreUrl ?? "none"}`,
      `type: ${product.productType ?? "none"}`,
      `vendor: ${product.vendor ?? "none"}`,
      `description: ${product.description || "none"}`,
      `variants:\n${variants || "- none"}`,
    ].join("\n");
  }).join("\n\n");
}

async function enrichedPageContext(body: any) {
  const pageContext = { ...(body?.pageContext || {}) };
  const productId = String(pageContext.productId || "").trim();
  const productHandle = String(pageContext.productHandle || body?.productHandle || "").trim();
  const query = String(body?.productQuery || pageContext.productTitle || "").trim();
  if (!productId && !productHandle && !query) return pageContext;

  try {
    const result = await executeBotTool(
      "product.read",
      { productId: productId || null, handle: productHandle || null, query: query || null },
      { role: "SALES", conversationId: "private-qa-product-context", discount: { action: "NO_OFFER", reason: "PRIVATE_QA_READ_ONLY" } },
    ) as { products?: BotProductSummary[] } | BotProductSummary[];
    const products = Array.isArray(result) ? result : (result.products || []);
    pageContext.authoritativeProductFacts = productFacts(products);
    if (products[0]) {
      pageContext.productId = products[0].id;
      pageContext.productHandle = products[0].handle;
      pageContext.productTitle = products[0].title;
    }
  } catch (error: any) {
    pageContext.authoritativeProductFacts = `Authoritative Shopify lookup unavailable for this turn. Do not guess restricted product facts. Source error: ${String(error?.message || "unknown").slice(0, 240)}`;
  }
  return pageContext;
}

router.use((req, res, next) => {
  if (String(req.params.slug || "") !== configuredSlug()) return res.status(404).send("Not found.");
  const auth = parseBasicAuth(String(req.get("authorization") || ""));
  if (!auth || !equalDigestHex(auth.username, expectedUserHash()) || !equalDigestHex(auth.password, expectedPasswordHash())) {
    res.setHeader("WWW-Authenticate", 'Basic realm="TIGER Bot QA", charset="UTF-8"');
    return res.status(401).send("Authentication required.");
  }
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

function sendProtectedHtml(res: any, filePath: string, unavailableMessage: string) {
  if (!fs.existsSync(filePath)) return res.status(503).send(unavailableMessage);
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return res.type("html").send(fs.readFileSync(filePath, "utf8"));
}

router.get("/", (_req, res) => sendProtectedHtml(res, pagePath, "Private QA page unavailable."));
router.get("/customer", (_req, res) => sendProtectedHtml(res, customerPagePath, "Customer simulation page unavailable."));

router.get("/status", async (_req, res) => {
  try {
    const config = await loadCurrentBotConfiguration();
    const providers = providerStatus();
    const shopify = publicShopifyStatus();
    const selectedModels = config.models.map(item => ({
      provider: String(item.provider || "").toLowerCase(),
      model: item.model,
      trafficPct: item.trafficPct,
      configured: item.provider === "mock" ? true : Boolean((providers as any)[String(item.provider || "").toLowerCase()]),
    }));
    const hasRealModel = selectedModels.some(item => item.provider !== "mock" && item.configured);
    res.json({
      ok: true,
      mode: hasRealModel ? "REAL_MODEL_PRIVATE_QA" : "MOCK_MODEL_PRIVATE_QA",
      storefrontEnabled: false,
      writeActionsEnabled: false,
      selectedModels,
      providers,
      shopify: {
        liveConnect: shopify.mode === "live",
        adminReadReady: Boolean(shopify.mode === "live" && shopify.shopDomain && (shopify.hasAccessToken || shopify.tokenExchangeReady)),
        shopDomainConfigured: Boolean(shopify.shopDomain),
        apiVersion: shopify.apiVersion,
        missing: shopify.missing,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load private QA status." });
  }
});

router.get("/product", async (req, res) => {
  try {
    const result = await executeBotTool(
      "product.read",
      {
        productId: req.query.productId ? String(req.query.productId) : null,
        handle: req.query.handle ? String(req.query.handle) : null,
        query: req.query.q ? String(req.query.q) : null,
      },
      { role: "SALES", conversationId: "private-qa-product-read", discount: { action: "NO_OFFER", reason: "PRIVATE_QA_READ_ONLY" } },
    );
    res.json({ ok: true, result, mode: "PRIVATE_QA_READ_ONLY", storefrontEnabled: false, writeActionsEnabled: false });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Product read failed.", code: error?.code || undefined });
  }
});

router.post("/message", async (req, res) => {
  try {
    const config = await loadCurrentBotConfiguration();
    const pageContext = await enrichedPageContext(req.body);
    const result = await runBotTurn({
      shopDomain: currentBotShopDomain(),
      config,
      visitorKey: String(req.body?.visitorKey || "private-qa"),
      conversationId: req.body?.conversationId ? String(req.body.conversationId) : null,
      message: String(req.body?.message || ""),
      pageContext,
      profile: req.body?.profile || {},
      leadContext: req.body?.leadContext || undefined,
      explicitSignals: req.body?.signals || undefined,
      sessionToken: undefined,
    });
    res.json({ ...result, mode: "PRIVATE_QA_READ_ONLY", storefrontEnabled: false, writeActionsEnabled: false, authoritativeProductLookup: Boolean(pageContext.authoritativeProductFacts) });
  } catch (error: any) {
    const code = String(error?.code || "");
    const status = code === "PROVIDER_NOT_CONFIGURED" ? 503 : code === "RATE_LIMITED" ? 429 : code === "PROVIDER_HTTP_ERROR" || code === "PROVIDER_NETWORK_ERROR" ? 502 : 400;
    res.status(status).json({ error: error?.message || "Private QA bot failed.", code: code || undefined });
  }
});

export default router;
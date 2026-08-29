import { Router } from "express";
import { currentBotShopDomain, loadCurrentBotConfiguration } from "../lib/bot-config-store.js";
import { providerStatus } from "../lib/bot-provider.js";
import { publicShopifyStatus } from "../lib/shopify-config.js";
import { runBotTurn } from "../lib/bot-runtime.js";
import { executeBotTool } from "../lib/bot-tool-executor.js";
import { verifyPublicQaToken } from "../lib/public-bot-qa.js";
import type { BotProductSummary } from "../lib/bot-shopify-tools.js";

const router = Router();

function qaToken(req: any): string {
  return String(req.get?.("x-bot-qa-token") || req.query?.token || "").trim();
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
      { role: "SALES", conversationId: "public-qa-product-context", discount: { action: "NO_OFFER", reason: "PUBLIC_QA_READ_ONLY" } },
    ) as BotProductSummary[];
    pageContext.authoritativeProductFacts = productFacts(result);
    if (result[0]) {
      pageContext.productId = result[0].id;
      pageContext.productHandle = result[0].handle;
      pageContext.productTitle = result[0].title;
    }
  } catch (error: any) {
    pageContext.authoritativeProductFacts = `Authoritative Shopify lookup unavailable for this turn. Do not guess restricted product facts. Source error: ${String(error?.message || "unknown").slice(0, 240)}`;
  }
  return pageContext;
}

router.use((req, res, next) => {
  if (!verifyPublicQaToken(qaToken(req))) return res.status(404).json({ error: "Not found." });
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
});

router.get("/status", async (_req, res) => {
  try {
    const config = await loadCurrentBotConfiguration();
    const providers = providerStatus();
    const shopify = publicShopifyStatus();
    res.json({
      ok: true,
      mode: "PUBLIC_QA_READ_ONLY",
      storefrontEnabled: false,
      writeActionsEnabled: false,
      selectedModels: config.models.map(item => ({ provider: String(item.provider || "").toLowerCase(), model: item.model, trafficPct: item.trafficPct })),
      shopify: {
        liveConnect: shopify.mode === "live",
        adminReadReady: Boolean(shopify.mode === "live" && shopify.shopDomain && (shopify.hasAccessToken || shopify.tokenExchangeReady)),
        shopDomainConfigured: Boolean(shopify.shopDomain),
        apiVersion: shopify.apiVersion,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load public QA status." });
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
      {
        role: "SALES",
        conversationId: "public-qa-product-read",
        discount: { action: "NO_OFFER", reason: "PUBLIC_QA_READ_ONLY" },
      },
    );
    res.json({ ok: true, result, storefrontEnabled: false, writeActionsEnabled: false, mode: "PUBLIC_QA_READ_ONLY" });
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
      visitorKey: String(req.body?.visitorKey || "public-qa"),
      conversationId: req.body?.conversationId ? String(req.body.conversationId) : null,
      message: String(req.body?.message || ""),
      pageContext,
      profile: req.body?.profile || {},
      leadContext: req.body?.leadContext || undefined,
      explicitSignals: req.body?.signals || undefined,
      sessionToken: undefined,
    });
    res.json({ ...result, storefrontEnabled: false, writeActionsEnabled: false, mode: "PUBLIC_QA_READ_ONLY", authoritativeProductLookup: Boolean(pageContext.authoritativeProductFacts) });
  } catch (error: any) {
    const code = String(error?.code || "");
    const status = code === "PROVIDER_NOT_CONFIGURED" ? 503 : code === "RATE_LIMITED" ? 429 : code === "PROVIDER_HTTP_ERROR" || code === "PROVIDER_NETWORK_ERROR" ? 502 : 400;
    res.status(status).json({ error: error?.message || "Public QA bot failed.", code: code || undefined });
  }
});

export default router;

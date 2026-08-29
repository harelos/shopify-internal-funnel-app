import { Router } from "express";
import { currentBotShopDomain, loadCurrentBotConfiguration } from "../lib/bot-config-store.js";
import { providerStatus } from "../lib/bot-provider.js";
import { publicShopifyStatus } from "../lib/shopify-config.js";
import { runBotTurn } from "../lib/bot-runtime.js";
import { executeBotTool } from "../lib/bot-tool-executor.js";
import { verifyPublicQaToken } from "../lib/public-bot-qa.js";

const router = Router();

function qaToken(req: any): string {
  return String(req.get?.("x-bot-qa-token") || req.query?.token || "").trim();
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
    const result = await runBotTurn({
      shopDomain: currentBotShopDomain(),
      config,
      visitorKey: String(req.body?.visitorKey || "public-qa"),
      conversationId: req.body?.conversationId ? String(req.body.conversationId) : null,
      message: String(req.body?.message || ""),
      pageContext: req.body?.pageContext || {},
      profile: req.body?.profile || {},
      leadContext: req.body?.leadContext || undefined,
      explicitSignals: req.body?.signals || undefined,
      sessionToken: undefined,
    });
    res.json({ ...result, storefrontEnabled: false, writeActionsEnabled: false, mode: "PUBLIC_QA_READ_ONLY" });
  } catch (error: any) {
    const code = String(error?.code || "");
    const status = code === "PROVIDER_NOT_CONFIGURED" ? 503 : code === "RATE_LIMITED" ? 429 : code === "PROVIDER_HTTP_ERROR" || code === "PROVIDER_NETWORK_ERROR" ? 502 : 400;
    res.status(status).json({ error: error?.message || "Public QA bot failed.", code: code || undefined });
  }
});

export default router;

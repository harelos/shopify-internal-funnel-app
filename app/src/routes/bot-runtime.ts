import { Router } from "express";
import { currentBotShopDomain, loadCurrentBotConfiguration } from "../lib/bot-config-store.js";
import { providerStatus } from "../lib/bot-provider.js";
import { publicShopifyStatus } from "../lib/shopify-config.js";
import { BotGuardrailError } from "../lib/bot-guardrails.js";
import { loadConversationCrmFacts } from "../lib/bot-crm.js";
import { recordBotCommerceOutcome } from "../lib/bot-commerce.js";
import { buildBotAnalytics } from "../lib/bot-analytics.js";
import { BotToolExecutionError, executeBotTool } from "../lib/bot-tool-executor.js";
import type { BotAgentRole, DiscountDecision } from "../lib/bot-sales-brain.js";
import type { BotToolName } from "../lib/bot-orchestrator.js";
import {
  deleteKnowledgePack,
  listKnowledgePacks,
  loadConversationMessages,
  upsertKnowledgePack,
} from "../lib/bot-runtime-store.js";
import { runBotTurn } from "../lib/bot-runtime.js";

const router = Router();

function bearerToken(req: any): string | undefined {
  const authorization = String(req.get?.("authorization") || "");
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() || undefined : undefined;
}

router.get("/bot/providers/status", (_req, res) => {
  res.json({ providers: providerStatus(), storefrontEnabled: false });
});

router.get("/bot/staging/status", async (_req, res) => {
  try {
    const config = await loadCurrentBotConfiguration();
    const providers = providerStatus();
    const selectedModels = config.models.map(item => ({
      provider: String(item.provider || "").toLowerCase(),
      model: item.model,
      trafficPct: item.trafficPct,
      configured: item.provider === "mock" ? true : Boolean((providers as any)[String(item.provider || "").toLowerCase()]),
    }));
    const hasRealModel = selectedModels.some(item => item.provider !== "mock" && item.configured);
    const shopify = publicShopifyStatus();
    res.json({
      ok: true,
      storefrontEnabled: false,
      mode: hasRealModel ? "REAL_MODEL_STAGING" : "MOCK_MODEL_STAGING",
      selectedModels,
      providers,
      shopify: {
        liveConnect: shopify.mode === "live",
        adminReadReady: Boolean(shopify.mode === "live" && shopify.shopDomain && (shopify.hasAccessToken || shopify.tokenExchangeReady)),
        shopDomainConfigured: Boolean(shopify.shopDomain),
        apiVersion: shopify.apiVersion,
        hasAccessToken: shopify.hasAccessToken,
        tokenExchangeReady: shopify.tokenExchangeReady,
        missing: shopify.missing,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load bot staging status." });
  }
});

router.get("/bot/knowledge", async (_req, res) => {
  try {
    const packs = await listKnowledgePacks(currentBotShopDomain());
    res.json({ packs, count: packs.length, storefrontEnabled: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load bot knowledge." });
  }
});

router.put("/bot/knowledge/:key", async (req, res) => {
  try {
    const pack = await upsertKnowledgePack(currentBotShopDomain(), {
      key: String(req.params.key || ""),
      title: String(req.body?.title || ""),
      scope: String(req.body?.scope || "GLOBAL"),
      scopeId: req.body?.scopeId == null ? null : String(req.body.scopeId),
      text: String(req.body?.text || ""),
      priority: Number(req.body?.priority || 0),
    });
    res.json({ ok: true, pack, storefrontEnabled: false });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Failed to save bot knowledge." });
  }
});

router.delete("/bot/knowledge/:key", async (req, res) => {
  try {
    await deleteKnowledgePack(currentBotShopDomain(), String(req.params.key || ""));
    res.json({ ok: true, storefrontEnabled: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to delete bot knowledge." });
  }
});

router.post("/bot/simulator/message", async (req, res) => {
  try {
    const config = await loadCurrentBotConfiguration();
    const result = await runBotTurn({
      shopDomain: currentBotShopDomain(),
      config,
      visitorKey: String(req.body?.visitorKey || "admin-simulator"),
      conversationId: req.body?.conversationId ? String(req.body.conversationId) : null,
      message: String(req.body?.message || ""),
      pageContext: req.body?.pageContext || {},
      profile: req.body?.profile || {},
      leadContext: req.body?.leadContext || undefined,
      explicitSignals: req.body?.signals || undefined,
      sessionToken: bearerToken(req),
    });
    res.json({ ...result, storefrontEnabled: false });
  } catch (error: any) {
    const code = String(error?.code || "");
    if (error instanceof BotGuardrailError) {
      if (error.retryAfterSeconds) res.setHeader("Retry-After", String(error.retryAfterSeconds));
      return res.status(code.startsWith("RATE_LIMIT") ? 429 : 403).json({ error: error.message, code, retryAfterSeconds: error.retryAfterSeconds });
    }
    const status = code === "PROVIDER_NOT_CONFIGURED" ? 503 : code === "RATE_LIMITED" ? 429 : code === "PROVIDER_HTTP_ERROR" || code === "PROVIDER_NETWORK_ERROR" ? 502 : 400;
    res.status(status).json({ error: error?.message || "Bot simulator failed.", code: code || undefined });
  }
});

router.post("/bot/simulator/tool", async (req, res) => {
  try {
    const sessionToken = bearerToken(req);
    const discount = (req.body?.discount && typeof req.body.discount === "object"
      ? req.body.discount
      : { action: "NO_OFFER", reason: "SIMULATOR_DEFAULT" }) as DiscountDecision;
    const result = await executeBotTool(
      String(req.body?.name || "") as BotToolName,
      req.body?.args || {},
      {
        role: String(req.body?.role || "SECURITY").toUpperCase() as BotAgentRole,
        conversationId: String(req.body?.conversationId || "admin-tool-simulator"),
        discount,
        sessionToken,
        verifiedCustomer: req.body?.verifiedCustomer || null,
      },
    );
    res.json({ ok: true, result, source: "BOT_TOOL_SIMULATOR_STAGING", storefrontEnabled: false });
  } catch (error: any) {
    if (error instanceof BotToolExecutionError) {
      const status = error.code === "TOOL_NOT_ALLOWED" ? 403 : error.code === "TOOL_NOT_IMPLEMENTED" ? 501 : 400;
      return res.status(status).json({ error: error.message, code: error.code, storefrontEnabled: false });
    }
    res.status(400).json({ error: error?.message || "Bot tool simulator failed.", storefrontEnabled: false });
  }
});

router.post("/bot/simulator/outcome", async (req, res) => {
  try {
    const outcome = await recordBotCommerceOutcome(currentBotShopDomain(), {
      conversationId: String(req.body?.conversationId || ""),
      type: String(req.body?.type || "").toUpperCase() as any,
      idempotencyKey: req.body?.idempotencyKey ? String(req.body.idempotencyKey) : undefined,
      revenueIls: req.body?.revenueIls,
      contributionProfitIls: req.body?.contributionProfitIls,
    });
    res.json({ ok: true, outcome, source: "BOT_SIMULATOR_STAGING", storefrontEnabled: false });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || "Failed to record bot simulator outcome." });
  }
});

router.get("/bot/conversations/:conversationId", async (req, res) => {
  try {
    const conversationId = String(req.params.conversationId || "");
    const [messages, crmFacts] = await Promise.all([
      loadConversationMessages(currentBotShopDomain(), conversationId),
      loadConversationCrmFacts(currentBotShopDomain(), conversationId),
    ]);
    res.json({ conversationId, messages, crmFacts, storefrontEnabled: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load conversation." });
  }
});

router.get("/bot/analytics", async (req, res) => {
  try {
    const range = String(req.query.range || "7d");
    const days = range === "30d" ? 30 : range === "90d" ? 90 : 7;
    const since = new Date(Date.now() - days * 86_400_000);
    const analytics = await buildBotAnalytics(currentBotShopDomain(), since);
    res.json({ range, since: since.toISOString(), ...analytics, source: "BOT_SIMULATOR_STAGING", storefrontEnabled: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load bot analytics." });
  }
});

export default router;

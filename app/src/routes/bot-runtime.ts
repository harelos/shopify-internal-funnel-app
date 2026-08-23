import { Router } from "express";
import { currentBotShopDomain, loadCurrentBotConfiguration } from "../lib/bot-config-store.js";
import { providerStatus } from "../lib/bot-provider.js";
import { BotGuardrailError } from "../lib/bot-guardrails.js";
import { loadConversationCrmFacts } from "../lib/bot-crm.js";
import { recordBotCommerceOutcome } from "../lib/bot-commerce.js";
import { buildBotAnalytics } from "../lib/bot-analytics.js";
import {
  deleteKnowledgePack,
  listKnowledgePacks,
  loadConversationMessages,
  upsertKnowledgePack,
} from "../lib/bot-runtime-store.js";
import { runBotTurn } from "../lib/bot-runtime.js";

const router = Router();

router.get("/bot/providers/status", (_req, res) => {
  res.json({ providers: providerStatus(), storefrontEnabled: false });
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

// Staging-only outcome recorder for validating model A/B/n analytics before any
// storefront runtime exists. Real commerce attribution must arrive from signed,
// server-side storefront/order events in a later release.
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

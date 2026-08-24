import { Router } from "express";
import { resolveKnowledgeContext } from "../support/agent/context-broker.js";
import { runSupportAgentSimulation } from "../support/agent/engine.js";
import { runDefaultSupportReplaySuite } from "../support/agent/evaluation.js";
import { detectSupportIntent } from "../support/agent/skills.js";
import type { SupportAgentFacts } from "../support/agent/contracts.js";
import {
  assertSupportKnowledgeEnabled,
  assertSupportStagingEnabled,
  getSupportConfig,
} from "../support/config.js";
import { getSupportCustomerContext } from "../support/customer-context.js";
import { loadKnowledgePack } from "../support/knowledge/store.js";
import { getSupportShopifyContext } from "../support/shopify-context.js";
import {
  getSupportThread,
  listSupportThreads,
  probeSupportMailbox,
  supportOverview,
  syncSupportStaging,
} from "../support/service.js";

const router = Router();

function bearerSessionToken(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const token = authorization.slice(7).trim();
  return token || undefined;
}

router.get("/support/status", async (_req, res) => {
  const config = getSupportConfig();
  res.json({
    stagingEnabled: config.stagingEnabled,
    syncSource: config.syncSource,
    mailboxAddressConfigured: Boolean(config.mailboxAddress && !config.mailboxAddress.endsWith("@example.test")),
    imapReadEnabled: config.imapReadEnabled,
    imapConfigured: Boolean(config.imapHost && config.imapUsername && config.imapPassword),
    imapMailbox: config.imapMailbox,
    shopifyLookupEnabled: config.shopifyLookupEnabled,
    shopifyOrderLimit: config.shopifyOrderLimit,
    shopifyCustomerLookupEnabled: config.shopifyCustomerLookupEnabled,
    knowledgeEnabled: config.knowledgeEnabled,
    knowledgePackConfigured: Boolean(config.knowledgePackPath),
    agentSimulationEnabled: config.stagingEnabled,
    sendEnabled: false,
    shopifyMutationEnabled: false,
    boundary: "READ_ONLY_STAGING",
  });
});

router.get("/support/knowledge/status", async (_req, res) => {
  try {
    const config = getSupportConfig();
    if (!config.knowledgeEnabled) {
      return res.json({ enabled: false, configured: Boolean(config.knowledgePackPath), approved: false });
    }
    assertSupportKnowledgeEnabled(config);
    const pack = await loadKnowledgePack(config.knowledgePackPath);
    res.json({
      enabled: true,
      configured: true,
      packId: pack.packId,
      version: pack.version,
      status: pack.status,
      approved: pack.status === "APPROVED",
      productCount: pack.products.length,
    });
  } catch (error: any) {
    res.status(409).json({ error: error?.message || "Support knowledge status failed" });
  }
});

router.get("/support/overview", async (_req, res) => {
  try {
    res.json(await supportOverview());
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load support overview" });
  }
});

router.get("/support/threads", async (req, res) => {
  try {
    const limit = Number.parseInt(String(req.query.limit || "100"), 10);
    res.json({ threads: await listSupportThreads(Number.isFinite(limit) ? limit : 100) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load support threads" });
  }
});

router.get("/support/threads/:id", async (req, res) => {
  try {
    const thread = await getSupportThread(req.params.id);
    if (!thread) return res.status(404).json({ error: "Support thread not found" });
    res.json(thread);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load support thread" });
  }
});

router.get("/support/threads/:id/shopify-context", async (req, res) => {
  try {
    const sessionToken = bearerSessionToken(req.get("authorization"));
    const context = await getSupportShopifyContext(req.params.id, sessionToken);
    res.json(context);
  } catch (error: any) {
    const message = error?.message || "Failed to load Shopify support context";
    if (/thread not found/i.test(message)) return res.status(404).json({ error: message });
    if (/disabled|not configured|required|live Shopify connection/i.test(message)) {
      return res.status(409).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

router.get("/support/threads/:id/shopify-customer-context", async (req, res) => {
  try {
    const sessionToken = bearerSessionToken(req.get("authorization"));
    const context = await getSupportCustomerContext(req.params.id, sessionToken);
    res.json(context);
  } catch (error: any) {
    const message = error?.message || "Failed to load Shopify customer support context";
    if (/thread not found/i.test(message)) return res.status(404).json({ error: message });
    if (/disabled|not configured|required|live Shopify connection|read_customers/i.test(message)) {
      return res.status(409).json({ error: message });
    }
    res.status(500).json({ error: message });
  }
});

router.get("/support/agent/replay", async (_req, res) => {
  try {
    assertSupportStagingEnabled();
    res.json(runDefaultSupportReplaySuite());
  } catch (error: any) {
    const message = error?.message || "Support replay failed";
    const status = /staging is disabled/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/support/agent/simulate", async (req, res) => {
  try {
    assertSupportStagingEnabled();
    const config = getSupportConfig();
    const subject = typeof req.body?.subject === "string" ? req.body.subject.slice(0, 500) : undefined;
    const message = typeof req.body?.message === "string" ? req.body.message.trim().slice(0, 20_000) : "";
    const locale = typeof req.body?.locale === "string" ? req.body.locale.slice(0, 20) : "he";
    const productKey = typeof req.body?.productKey === "string" ? req.body.productKey.trim().slice(0, 200) : undefined;
    const facts = (req.body?.facts && typeof req.body.facts === "object") ? req.body.facts as SupportAgentFacts : undefined;

    if (!message) return res.status(400).json({ error: "message is required" });

    const baseInput = { subject, message, locale, productKey, facts };
    if (!config.knowledgeEnabled) {
      return res.json({ ...runSupportAgentSimulation(baseInput), knowledgeEvidence: [], knowledgePack: null });
    }

    assertSupportKnowledgeEnabled(config);
    const pack = await loadKnowledgePack(config.knowledgePackPath);
    const intent = detectSupportIntent(subject, message).intent;
    const resolved = resolveKnowledgeContext(pack, baseInput, intent);
    const result = runSupportAgentSimulation({ ...baseInput, facts: resolved.facts });
    res.json({
      ...result,
      knowledgeEvidence: resolved.evidence,
      knowledgePack: { packId: pack.packId, version: pack.version, status: pack.status },
    });
  } catch (error: any) {
    const message = error?.message || "Support agent simulation failed";
    const status = /staging is disabled|knowledge is disabled|PACK_PATH/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/support/probe", async (_req, res) => {
  try {
    const result = await probeSupportMailbox();
    res.json({ ok: true, ...result });
  } catch (error: any) {
    const message = error?.message || "Support mailbox probe failed";
    const status = /disabled|not set|incomplete|not set to imap/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

router.post("/support/sync", async (_req, res) => {
  try {
    const result = await syncSupportStaging();
    res.json({ ok: true, ...result });
  } catch (error: any) {
    const message = error?.message || "Support sync failed";
    const status = /disabled|not enabled|incomplete|not set to imap/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

export default router;

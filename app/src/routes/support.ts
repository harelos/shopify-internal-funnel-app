import { Router } from "express";
import { getSupportConfig } from "../support/config.js";
import { getSupportThread, listSupportThreads, supportOverview, syncSupportStaging } from "../support/service.js";

const router = Router();

router.get("/support/status", async (_req, res) => {
  const config = getSupportConfig();
  res.json({
    stagingEnabled: config.stagingEnabled,
    syncSource: config.syncSource,
    mailboxAddressConfigured: Boolean(config.mailboxAddress && !config.mailboxAddress.endsWith("@example.test")),
    sendEnabled: false,
    shopifyMutationEnabled: false,
    boundary: "READ_ONLY_STAGING",
  });
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

router.post("/support/sync", async (_req, res) => {
  try {
    const result = await syncSupportStaging();
    res.json({ ok: true, ...result });
  } catch (error: any) {
    const message = error?.message || "Support sync failed";
    const status = /disabled|not enabled/i.test(message) ? 409 : 500;
    res.status(status).json({ error: message });
  }
});

export default router;

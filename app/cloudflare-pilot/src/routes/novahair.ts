import { Router } from "express";
import { getD1, getNovaHairState, snapshotProductState } from "../services/novahair-monitor.js";
import { env as cloudflareEnv } from "cloudflare:workers";

const router = Router();

router.get("/api/novahair-monitor/status", async (req, res) => {
  try {
    const db = getD1();
    const state = await getNovaHairState(db);
    const prodSnapshot = await snapshotProductState();

    const authHeader = req.get("authorization") || "";
    const envObj = (cloudflareEnv as any) ?? (globalThis as any).__SHOPIFY_WORKER_ENV__;
    const adminSecret = envObj?.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_WEBHOOK_SECRET || "";

    const isAuthorized = authHeader.replace(/^Bearer\s+/i, "") === adminSecret || req.query.key === adminSecret;

    if (!isAuthorized) {
      // Minimal safe public operational response (Zero tokens, zero customer data, zero credentials)
      return res.json({
        ok: true,
        status: "ok",
        runtime: "CLOUD",
        service: "ONLINE",
        owner_pc_required: "NO",
        release: state.releaseState,
        orders_verified: `${state.passedCount} / 3`,
        circuit_breaker: state.circuitBreakerTriggered ? "TRIGGERED" : "NOT_TRIGGERED",
        novahair_product: prodSnapshot.status || "ACTIVE",
        timestamp: new Date().toISOString()
      });
    }

    // Detailed authenticated operational diagnostics
    const fullResult = {
      RUNTIME: "CLOUD (Cloudflare Workers + D1 Database)",
      SERVICE: "ONLINE",
      OWNER_PC_REQUIRED: "NO",
      RELEASE: state.releaseState,
      ORDERS_VERIFIED: `${state.passedCount} / 3`,
      PASSED_COUNT: state.passedCount,
      FAILED_COUNT: state.failedCount,
      SHOPIFY_WEBHOOK: "ACTIVE",
      LAST_WEBHOOK: state.lastWebhookTimestamp || "Never",
      CJ_VERIFICATION: "ACTIVE (D1 Durable Queue + 1-Minute Cron)",
      LAST_CJ_SUCCESS: state.lastCjSyncTimestamp || "Never",
      CIRCUIT_BREAKER: state.circuitBreakerTriggered ? "TRIGGERED 🚨" : "NOT TRIGGERED 🟢",
      PURCHASE_KILL_SWITCH: state.purchaseKillSwitchActive ? "BLOCKED 🚨" : "ALLOWING 🟢",
      NOVAHAIR_PRODUCT: prodSnapshot.status || "ACTIVE",
      CART_TRANSFORM: state.transformActive ? "ACTIVE 🟢" : "INACTIVE 🛑",
      DEPLOYMENT_TIMESTAMP: state.deploymentTimestamp,
      MONITORED_ORDERS_COUNT: state.monitoredOrders.length,
      SEEN_ORDER_COUNT: state.seenOrderIds.length
    };

    return res.json({ ok: true, data: fullResult });
  } catch (err: any) {
    console.error("Error generating status:", err);
    return res.status(500).json({ ok: false, error: "Internal status error" });
  }
});

export default router;

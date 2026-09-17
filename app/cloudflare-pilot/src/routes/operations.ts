import { Router } from "express";
import { resolveGrowthCockpitRange } from "../lib/growth-cockpit-config.js";
import { supportD1 } from "../lib/support-d1.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { probeShopifyPixelHealth } from "../services/shopify-pixel-health.js";

const router = Router();
const shopify = new ShopifyAdminClient();

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown): string | null {
  const normalized = text(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function ageMinutes(value: string | null, now: Date): number | null {
  if (!value) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60_000));
}

function stateFromAge(value: string | null, now: Date, attentionAfterMinutes: number) {
  const age = ageMinutes(value, now);
  if (age == null) return "UNKNOWN";
  return age <= attentionAfterMinutes ? "CURRENT" : "ATTENTION";
}

function latestBySource(rows: Row[], source: string): Row | null {
  return rows.find(row => text(row.source) === source) || null;
}

router.get("/operations/health", async (req, res) => {
  const db = supportD1();
  const now = new Date();
  const todayIsrael = resolveGrowthCockpitRange({ preset: "today", timezone: "Asia/Jerusalem", now });
  const authorization = req.get("authorization") ?? "";
  const sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;

  const [mailbox, supportCounts, delivery, webhook, financial, experiment, exposure, orders, monitor, pixel, shipmentRun, shipmentCounts, guardian, guardianQueue] = await Promise.all([
    db.prepare(`SELECT "connectionStatus", "automationMode", "replyDelayMinutes", "lastSyncAt",
      "lastAgentRunAt", "nextAgentRunAt", "lastAgentResult", "lastScanCount", "ignoredMessageCount", "lastError"
      FROM "SupportMailbox" ORDER BY "updatedAt" DESC LIMIT 1`).first<Row>(),
    db.prepare(`SELECT "status", COUNT(*) AS "count" FROM "SupportConversation"
      WHERE "audienceType" != 'NON_CUSTOMER' GROUP BY "status"`).all<Row>(),
    db.prepare(`SELECT
      SUM(CASE WHEN "status" = 'FAILED' THEN 1 ELSE 0 END) AS "failed",
      SUM(CASE WHEN "status" = 'BOUNCED' THEN 1 ELSE 0 END) AS "bounced",
      SUM(CASE WHEN "status" IN ('QUEUED_TO_SEND', 'SENDING') THEN 1 ELSE 0 END) AS "queued"
      FROM "SupportDraft"`).first<Row>(),
    db.prepare(`SELECT "topic", "receivedAt" FROM "ShopifyWebhookDelivery"
      ORDER BY "receivedAt" DESC LIMIT 1`).first<Row>(),
    db.prepare(`SELECT "source", "category", "quality", "rowCount", "reconciledAt"
      FROM "FinancialLedgerCoverage" ORDER BY "reconciledAt" DESC LIMIT 20`).all<Row>(),
    db.prepare(`SELECT COUNT(*) AS "active" FROM "ElementExperiment" WHERE "status" = 'RUNNING'`).first<Row>(),
    db.prepare(`SELECT "occurredAt" FROM "ElementExposure" WHERE "isInternal" = 0
      ORDER BY "occurredAt" DESC LIMIT 1`).first<Row>(),
    db.prepare(`SELECT
      COUNT(*) AS "paid",
      SUM(CASE WHEN c."visitorId" IS NOT NULL AND c."visitorId" != '' THEN 1 ELSE 0 END) AS "linked",
      SUM(CASE WHEN c."visitorId" IS NULL OR c."visitorId" = '' THEN 1 ELSE 0 END) AS "unlinked",
      MAX(o."updatedAt") AS "lastUpdatedAt"
      FROM "OrderAttribution" o
      LEFT JOIN "CheckoutAttribution" c ON c."checkoutToken" = o."checkoutToken"
      WHERE o."isTest" = 0 AND o."netRevenueAmount" > 0 AND o."status" != 'REFUNDED_OR_CANCELLED'
        AND o."paidAt" >= ? AND o."paidAt" < ?`).bind(todayIsrael.from, todayIsrael.toExclusive).first<Row>(),
    db.prepare(`SELECT "releaseState", "passedCount", "failedCount", "circuitBreakerTriggered",
      "purchaseKillSwitchActive", "transformActive", "lastWebhookTimestamp", "lastCjSyncTimestamp", "updatedAt"
      FROM "NovaHairMonitorState" WHERE "id" = 'singleton' LIMIT 1`).first<Row>(),
    probeShopifyPixelHealth(shopify, sessionToken),
    db.prepare(`SELECT "receivedAt", "shopifyState", "cjState", "cjReadErrorCount", "duplicateCjOrderCount"
      FROM "ShipmentMonitorRun" ORDER BY "receivedAt" DESC LIMIT 1`).first<Row>(),
    db.prepare(`SELECT
      SUM(CASE WHEN "isActionable" = 1 AND "workflowState" != 'RESOLVED' THEN 1 ELSE 0 END) AS "actionable",
      SUM(CASE WHEN "isActionable" = 1 AND "workflowState" != 'RESOLVED' AND "severity" = 'CRITICAL' THEN 1 ELSE 0 END) AS "critical",
      SUM(CASE WHEN "isActionable" = 1 AND "workflowState" != 'RESOLVED' AND "contactTarget" LIKE '%CJ%' THEN 1 ELSE 0 END) AS "contactCj"
      FROM "ShipmentOrderState" WHERE "active" = 1`).first<Row>(),
    db.prepare(`SELECT "mode", "lastRunAt", "lastSuccessAt", "lastError", "liveReplies", "liveHides"
      FROM "CommentGuardianState" ORDER BY "updatedAt" DESC LIMIT 1`).first<Row>(),
    // Scoped to the last week so this clears itself; an incident that can never
    // go away is one people learn to scroll past.
    db.prepare(`SELECT COUNT(*) AS "waiting" FROM "CommentGuardianComment"
      WHERE "executedAction" IS NULL AND "recommendedAction" LIKE '%ESCALATE%'
        AND "firstSeenAt" >= datetime('now', '-7 days')`).first<Row>(),
  ]);

  const financialRows = financial.results || [];
  const shopifyCoverage = latestBySource(financialRows, "SHOPIFY_ADMIN_ORDERS");
  const cjCoverage = latestBySource(financialRows, "CJ_ORDER_COSTS");
  const metaCoverage = latestBySource(financialRows, "META_ADS_INSIGHTS");
  const supportStatusCounts = Object.fromEntries((supportCounts.results || []).map(row => [text(row.status) || "UNKNOWN", count(row.count)]));
  const agentLastRunAt = iso(mailbox?.lastAgentRunAt);
  const supportDeliveryAttention = count(delivery?.failed) + count(delivery?.bounced);
  const paidOrders = count(orders?.paid);
  const linkedOrders = count(orders?.linked);
  const incidents: Array<Record<string, unknown>> = [];

  // A sale CJ never received is invisible on the shipment board, because that
  // board is built from CJ's own order list. The cost reconciler knows: it has
  // to price those sales from the identical bundle instead of from a CJ order.
  const sinceDate = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const notAtCj = await db.prepare(`SELECT COUNT(*) AS "count" FROM "FinancialLedgerEntry"
    WHERE "source" = 'CJ_ORDER_COSTS' AND "occurredDate" >= ?
      AND json_extract("metadata", '$.costBasis') = 'CJ_BUNDLE_PRICE'`).bind(sinceDate).first<Row>().catch(() => null);
  const autoCreateFailures = await db.prepare(`SELECT COUNT(*) AS "count", MAX("result") AS "reason"
    FROM "NovaHairPendingOrder" WHERE "syncState" LIKE '%FAILED%'`).first<Row>().catch(() => null);
  // Held for an address a person can correct, which releases the order itself.
  const addressHolds = await db.prepare(`SELECT COUNT(*) AS "count", GROUP_CONCAT("orderNum") AS "orders"
    FROM "NovaHairPendingOrder" WHERE "syncState" = 'NEEDS_ADDRESS_FIX'`).first<Row>().catch(() => null);
  // Held for a product CJ has no variant for; nothing ships until a person decides.
  const mappingHolds = await db.prepare(`SELECT COUNT(*) AS "count", GROUP_CONCAT("orderNum") AS "orders", MAX("result") AS "reason"
    FROM "NovaHairPendingOrder" WHERE "syncState" = 'NEEDS_SUPPLIER_MAPPING'`).first<Row>().catch(() => null);
  const unsentCount = count(notAtCj?.count);
  if (unsentCount > 0) {
    incidents.push({
      severity: "CRITICAL",
      area: "Fulfilment",
      title: `${unsentCount} paid ${unsentCount === 1 ? "order has" : "orders have"} not been ordered from CJ`,
      action: "The customer paid and CJ holds no order, so nothing will ship. Create the CJ order by hand, or fix the cause below.",
    });
  }
  if (count(addressHolds?.count) > 0) {
    const orders = String(text(addressHolds?.orders) || "").split(",").filter(Boolean).slice(0, 12).map(n => `#${n}`).join(", ");
    incidents.push({
      severity: "CRITICAL",
      area: "Fulfilment",
      title: `${count(addressHolds?.count)} order(s) are held because CJ will not accept the address`,
      action: `Add the missing postcode in Shopify for ${orders || "these orders"}; each one is re-sent to CJ automatically within a minute of being corrected.`,
    });
  }
  if (count(mappingHolds?.count) > 0) {
    const orders = String(text(mappingHolds?.orders) || "").split(",").filter(Boolean).slice(0, 12).map(n => `#${n}`).join(", ");
    incidents.push({
      severity: "CRITICAL",
      area: "Fulfilment",
      title: `${count(mappingHolds?.count)} paid order(s) contain a product CJ cannot supply`,
      action: `${orders || "These orders"}: ${(text(mappingHolds?.reason) || "no CJ variant exists for a line on the order").slice(0, 160)} Decide: source it, refund it, or add the mapping in code; nothing ships until then.`,
    });
  }
  if (count(autoCreateFailures?.count) > 0) {
    const reason = text(autoCreateFailures?.reason) || "";
    const postcode = /postcode/i.test(reason);
    incidents.push({
      severity: "CRITICAL",
      area: "Fulfilment",
      title: `Automatic CJ ordering failed for ${count(autoCreateFailures?.count)} order(s)`,
      action: postcode
        ? "CJ rejects these addresses for a missing or non-numeric postcode. Add the postcode in Shopify and re-run, or place the CJ order by hand."
        : `CJ refused the order: ${reason.slice(0, 160)}`,
    });
  }

  if (!mailbox) {
    incidents.push({ severity: "CRITICAL", area: "Support", title: "Mailbox agent is not configured", action: "Open Support and verify the mailbox connection." });
  } else if (mailbox.lastError) {
    incidents.push({ severity: "CRITICAL", area: "Support", title: "Mailbox agent reported an error", action: "Open Support to review the latest agent error." });
  } else if (stateFromAge(agentLastRunAt, now, 3) === "ATTENTION") {
    incidents.push({ severity: "WARNING", area: "Support", title: "Mailbox agent has not checked recently", action: "Verify the Railway support worker before relying on automatic replies." });
  }
  if (supportDeliveryAttention > 0) {
    incidents.push({ severity: "CRITICAL", area: "Support", title: `${supportDeliveryAttention} support ${supportDeliveryAttention === 1 ? "reply needs" : "replies need"} delivery attention`, action: "Review the stored failure or bounce. The system will not resend automatically." });
  }
  if (!shopifyCoverage) {
    incidents.push({ severity: "WARNING", area: "Revenue", title: "Shopify financial coverage is unavailable", action: "Use Shopify directly for financial decisions until reconciliation returns." });
  } else if (stateFromAge(iso(shopifyCoverage.reconciledAt), now, 25) === "ATTENTION") {
    incidents.push({ severity: "WARNING", area: "Revenue", title: "Shopify financial reconciliation is stale", action: "Check the scheduled Worker before using the in-app revenue snapshot." });
  }
  if (!metaCoverage) {
    incidents.push({ severity: "WARNING", area: "Acquisition", title: "Meta cost coverage is unavailable", action: "Do not use blended ROAS from the app until the Meta connection is restored." });
  } else if (stateFromAge(iso(metaCoverage.reconciledAt), now, 25) === "ATTENTION") {
    incidents.push({ severity: "WARNING", area: "Acquisition", title: "Meta cost coverage is stale", action: "Use Meta Ads Manager for current spend until the scheduled sync is restored." });
  }
  if (!cjCoverage) {
    incidents.push({ severity: "CRITICAL", area: "Costs", title: "Product cost has never been reconciled", action: "Profit and margin cannot be computed. Check the CJ credential in Operations." });
  } else if (stateFromAge(iso(cjCoverage.reconciledAt), now, 48 * 60) === "ATTENTION") {
    incidents.push({ severity: "CRITICAL", area: "Costs", title: "Product cost reconciliation is stale", action: "Profit and margin are measured without current CJ cost. Verify the CJ credential." });
  }
  if (paidOrders > linkedOrders) {
    incidents.push({ severity: "INFO", area: "Attribution", title: `${paidOrders - linkedOrders} paid ${paidOrders - linkedOrders === 1 ? "order has" : "orders have"} no verified browser journey today`, action: "Revenue is counted, but the missing journey will remain unattributed rather than guessed." });
  }
  if (count(monitor?.circuitBreakerTriggered) > 0 || count(monitor?.purchaseKillSwitchActive) > 0 || count(monitor?.failedCount) > 0) {
    incidents.push({ severity: "CRITICAL", area: "Storefront", title: "NovaHair order monitor requires attention", action: "Review the monitor before changing the live purchase path." });
  }
  if (!pixel.ok) {
    incidents.push({ severity: "WARNING", area: "Attribution", title: "Shopify checkout pixel health could not be verified", action: "Open the Shopify customer-events settings before relying on checkout attribution." });
  } else if (!pixel.configured || !pixel.endpointMatches) {
    incidents.push({ severity: "CRITICAL", area: "Attribution", title: "Shopify checkout pixel is not connected to the verified ingest endpoint", action: "Review the app pixel configuration. No storefront setting is changed from Operations." });
  }
  const shipmentLastRunAt = iso(shipmentRun?.receivedAt);
  if (!shipmentRun) {
    incidents.push({ severity: "WARNING", area: "Fulfillment", title: "Shipment control has not received its first Shopify + CJ snapshot", action: "Open Shipment Control after the next worker checkpoint." });
  } else if (stateFromAge(shipmentLastRunAt, now, 8 * 60) === "ATTENTION") {
    incidents.push({ severity: "CRITICAL", area: "Fulfillment", title: "Shipment evidence is stale", action: "Verify the Railway fulfillment worker before relying on the shipment queue." });
  } else if (count(shipmentRun.cjReadErrorCount) > 0 || text(shipmentRun.cjState) !== "CURRENT") {
    incidents.push({ severity: "WARNING", area: "Fulfillment", title: "CJ returned partial shipment evidence", action: "Open Shipment Control and work only from orders with verified source agreement." });
  }
  // An unanswered comment under a live ad is read by everyone the ad reaches.
  const guardianError = String(guardian?.lastError ?? "").trim();
  if (guardianError) {
    incidents.push({ severity: "WARNING", area: "Ads", title: "Ad-comment guardian last run failed", action: `Meta reported: ${guardianError.slice(0, 120)}` });
  } else if (guardian && stateFromAge(iso(guardian.lastSuccessAt), now, 90) === "ATTENTION") {
    incidents.push({ severity: "WARNING", area: "Ads", title: "Ad comments have not been checked recently", action: "Comments under the live ads may be going unanswered. Check the Meta token." });
  }
  if (count(guardianQueue?.waiting) > 0) {
    incidents.push({ severity: "WARNING", area: "Ads", title: `${count(guardianQueue?.waiting)} ad ${count(guardianQueue?.waiting) === 1 ? "comment needs" : "comments need"} a person`, action: "Health, accusation and payment comments are never answered automatically. Answer them on the ad." });
  }
  if (count(shipmentCounts?.critical) > 0) {
    incidents.push({ severity: "CRITICAL", area: "Fulfillment", title: `${count(shipmentCounts?.critical)} critical ${count(shipmentCounts?.critical) === 1 ? "shipment needs" : "shipments need"} action`, action: "Open Shipment Control and start with the first order." });
  }

  const latestSignalAt = [
    agentLastRunAt,
    iso(shopifyCoverage?.reconciledAt),
    iso(metaCoverage?.reconciledAt),
    iso(webhook?.receivedAt),
    iso(exposure?.occurredAt),
    iso(orders?.lastUpdatedAt),
    shipmentLastRunAt,
  ].filter(Boolean).sort().at(-1) || null;

  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    generatedAt: now.toISOString(),
    timeZone: "Asia/Jerusalem",
    summary: {
      state: incidents.some(item => item.severity === "CRITICAL") ? "CRITICAL" : incidents.some(item => item.severity === "WARNING") ? "ATTENTION" : "HEALTHY",
      actionCount: incidents.filter(item => item.severity !== "INFO").length,
      latestSignalAt,
    },
    systems: {
      support: {
        state: !mailbox || mailbox.lastError || supportDeliveryAttention > 0 ? "ATTENTION" : stateFromAge(agentLastRunAt, now, 3),
        connection: text(mailbox?.connectionStatus) || "UNKNOWN",
        automationMode: text(mailbox?.automationMode) || "UNKNOWN",
        replyDelayMinutes: count(mailbox?.replyDelayMinutes),
        lastAgentRunAt: agentLastRunAt,
        nextAgentRunAt: iso(mailbox?.nextAgentRunAt),
        lastScanCount: count(mailbox?.lastScanCount),
        ignoredMessageCount: count(mailbox?.ignoredMessageCount),
        open: count(supportStatusCounts.OPEN),
        escalated: count(supportStatusCounts.ESCALATED),
        needsReview: count(supportStatusCounts.NEEDS_TRIAGE),
        queued: count(delivery?.queued),
        deliveryAttention: supportDeliveryAttention,
      },
      revenue: {
        state: stateFromAge(iso(shopifyCoverage?.reconciledAt), now, 25),
        paidOrdersToday: paidOrders,
        lastOrderUpdateAt: iso(orders?.lastUpdatedAt),
        lastReconciledAt: iso(shopifyCoverage?.reconciledAt),
        quality: text(shopifyCoverage?.quality) || "UNKNOWN",
      },
      attribution: {
        state: paidOrders === 0 || linkedOrders === paidOrders ? "CURRENT" : "PARTIAL",
        paidOrdersToday: paidOrders,
        verifiedJourneysToday: linkedOrders,
        unattributedOrdersToday: count(orders?.unlinked),
      },
      experiments: {
        state: count(experiment?.active) > 0 ? "RUNNING" : "IDLE",
        active: count(experiment?.active),
        lastExposureAt: iso(exposure?.occurredAt),
      },
      acquisition: {
        state: stateFromAge(iso(metaCoverage?.reconciledAt), now, 25),
        lastReconciledAt: iso(metaCoverage?.reconciledAt),
        quality: text(metaCoverage?.quality) || "UNKNOWN",
      },
      storefront: {
        state: count(monitor?.circuitBreakerTriggered) > 0 || count(monitor?.purchaseKillSwitchActive) > 0 || count(monitor?.failedCount) > 0 ? "ATTENTION" : "MONITORING",
        releaseState: text(monitor?.releaseState) || "UNKNOWN",
        passedChecks: count(monitor?.passedCount),
        failedChecks: count(monitor?.failedCount),
        circuitBreakerTriggered: count(monitor?.circuitBreakerTriggered) > 0,
        purchaseKillSwitchActive: count(monitor?.purchaseKillSwitchActive) > 0,
        lastWebhookAt: iso(monitor?.lastWebhookTimestamp) || iso(webhook?.receivedAt),
      },
      checkoutTracking: {
        state: pixel.state,
        configured: pixel.configured,
        endpointMatches: pixel.endpointMatches,
        pixelReadScopeGranted: pixel.pixelReadScopeGranted,
        reason: pixel.reason,
        lastVerifiedAt: pixel.ok ? now.toISOString() : null,
      },
      shipments: {
        state: !shipmentRun ? "UNKNOWN" : stateFromAge(shipmentLastRunAt, now, 8 * 60) === "ATTENTION" || text(shipmentRun.cjState) !== "CURRENT" ? "ATTENTION" : count(shipmentCounts?.critical) > 0 ? "CRITICAL" : "CURRENT",
        actionable: count(shipmentCounts?.actionable),
        critical: count(shipmentCounts?.critical),
        contactCj: count(shipmentCounts?.contactCj),
        lastReconciledAt: shipmentLastRunAt,
        duplicateCjOrderCount: count(shipmentRun?.duplicateCjOrderCount),
      },
    },
    incidents,
    sources: {
      revenue: "Shopify paid-order ledger and scheduled Shopify Admin reconciliation",
      support: "Namecheap mailbox agent and support evidence ledger",
      experiments: "First-party assignments, actual exposures and Shopify-paid outcomes",
      storefront: "NovaHair order monitor and Shopify webhook ledger",
      checkoutTracking: "Authenticated Shopify Web Pixel configuration probe",
      shipments: "Authenticated CJ order and tracking evidence reconciled with Shopify orders",
    },
  });
});

export default router;

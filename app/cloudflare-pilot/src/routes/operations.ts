import { Router } from "express";
import { resolveGrowthCockpitRange } from "../lib/growth-cockpit-config.js";
import { supportD1 } from "../lib/support-d1.js";
import { ShopifyAdminClient } from "../lib/shopify-admin.js";
import { publicShopifyPixelStatus } from "../lib/shopify-pixel-status.js";

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

router.get("/operations/health", async (_req, res) => {
  const db = supportD1();
  const now = new Date();
  const todayIsrael = resolveGrowthCockpitRange({ preset: "today", timezone: "Asia/Jerusalem", now });

  const [mailbox, supportCounts, delivery, webhook, financial, experiment, exposure, orders, monitor, pixel] = await Promise.all([
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
      SUM(CASE WHEN "checkoutToken" IS NOT NULL AND "checkoutToken" != '' THEN 1 ELSE 0 END) AS "linked",
      SUM(CASE WHEN "checkoutToken" IS NULL OR "checkoutToken" = '' THEN 1 ELSE 0 END) AS "unlinked",
      MAX("updatedAt") AS "lastUpdatedAt"
      FROM "OrderAttribution"
      WHERE "isTest" = 0 AND "netRevenueAmount" > 0 AND "status" != 'REFUNDED_OR_CANCELLED'
        AND "paidAt" >= ? AND "paidAt" < ?`).bind(todayIsrael.from, todayIsrael.toExclusive).first<Row>(),
    db.prepare(`SELECT "releaseState", "passedCount", "failedCount", "circuitBreakerTriggered",
      "purchaseKillSwitchActive", "transformActive", "lastWebhookTimestamp", "lastCjSyncTimestamp", "updatedAt"
      FROM "NovaHairMonitorState" WHERE "id" = 'singleton' LIMIT 1`).first<Row>(),
    shopify.webPixelConfiguration()
      .then(result => ({ ok: true as const, ...publicShopifyPixelStatus(result.webPixel) }))
      .catch(() => ({ ok: false as const, state: "UNKNOWN", configured: false, pixelIdPresent: false, endpointMatches: false, expectedEndpointHost: null })),
  ]);

  const financialRows = financial.results || [];
  const shopifyCoverage = latestBySource(financialRows, "SHOPIFY_ADMIN_ORDERS");
  const metaCoverage = latestBySource(financialRows, "META_ADS_INSIGHTS");
  const supportStatusCounts = Object.fromEntries((supportCounts.results || []).map(row => [text(row.status) || "UNKNOWN", count(row.count)]));
  const agentLastRunAt = iso(mailbox?.lastAgentRunAt);
  const supportDeliveryAttention = count(delivery?.failed) + count(delivery?.bounced);
  const paidOrders = count(orders?.paid);
  const linkedOrders = count(orders?.linked);
  const incidents: Array<Record<string, unknown>> = [];

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

  const latestSignalAt = [
    agentLastRunAt,
    iso(shopifyCoverage?.reconciledAt),
    iso(metaCoverage?.reconciledAt),
    iso(webhook?.receivedAt),
    iso(exposure?.occurredAt),
    iso(orders?.lastUpdatedAt),
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
        lastVerifiedAt: pixel.ok ? now.toISOString() : null,
      },
    },
    incidents,
    sources: {
      revenue: "Shopify paid-order ledger and scheduled Shopify Admin reconciliation",
      support: "Namecheap mailbox agent and support evidence ledger",
      experiments: "First-party assignments, actual exposures and Shopify-paid outcomes",
      storefront: "NovaHair order monitor and Shopify webhook ledger",
      checkoutTracking: "Authenticated Shopify Web Pixel configuration probe",
    },
  });
});

export default router;

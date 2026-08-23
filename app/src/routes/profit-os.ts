import { Router } from "express";
import prisma from "../lib/db.js";

const router = Router();

type DateRange = { gte?: Date; lte?: Date };

function parseDate(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function moneyOrNull(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(2));
}

router.get("/profit-os/overview", async (req, res) => {
  try {
    const dateRange: DateRange = {};
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, true);
    if (from) dateRange.gte = from;
    if (to) dateRange.lte = to;

    const where: any = { isTest: false };
    if (from || to) where.paidAt = dateRange;

    const orders = await prisma.orderAttribution.findMany({
      where,
      select: {
        shopifyOrderGid: true,
        currency: true,
        netRevenueAmount: true,
        status: true,
        paidAt: true,
      },
    });

    const activeOrders = orders.filter(order => order.status !== "REFUNDED_OR_CANCELLED");
    const currencies = [...new Set(activeOrders.map(order => String(order.currency).toUpperCase()))];
    const allIls = currencies.length === 0 || (currencies.length === 1 && currencies[0] === "ILS");
    const contributionRevenueIls = allIls
      ? activeOrders.reduce((sum, order) => sum + Number(order.netRevenueAmount || 0), 0)
      : null;

    // This endpoint intentionally refuses to invent CJ, Meta or payment-fee values.
    // Those sources become authoritative only after the deployed Cloudflare/D1 source
    // is synchronized back into Git and the Profit OS ingestion jobs are wired.
    res.json({
      contributionRevenueIls: moneyOrNull(contributionRevenueIls),
      orders: activeOrders.length,
      cjTotalVariableCostIls: null,
      paymentFeesIls: null,
      metaSpendIls: null,
      cm1: null,
      cm2: null,
      marginPct: null,
      breakEvenCpa: null,
      breakEvenRoas: null,
      poas: null,
      profitComplete: false,
      dataQuality: {
        shopifyOrders: orders.length ? "CONFIRMED" : "MISSING",
        shopifyCurrency: allIls ? "CONFIRMED" : "MISSING",
        cj: "MISSING",
        paymentFees: "MISSING",
        meta: "MISSING",
        fx: allIls ? "ACTUAL" : "MISSING",
      },
      blockers: [
        "Cloudflare/D1 production source is not synchronized into Git master.",
        "CJ cost ingestion is not wired on this branch.",
        "Payment-fee ingestion is not wired on this branch.",
        "Meta encrypted token/backfill ingestion is not wired on this branch.",
        ...(allIls ? [] : ["Non-ILS Shopify revenue requires authoritative FX normalization."]),
      ],
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load Profit OS overview" });
  }
});

router.get("/profit-os/data-health", async (_req, res) => {
  try {
    const orderCount = await prisma.orderAttribution.count({ where: { isTest: false } });
    res.json({
      shopify: { quality: orderCount > 0 ? "CONFIRMED" : "MISSING", rows: orderCount },
      cj: { quality: "MISSING", reason: "Cloudflare/D1 cost ledger not synced into this Git branch" },
      paymentFees: { quality: "MISSING", reason: "Authoritative transaction fee ingestion not wired" },
      meta: { quality: "MISSING", reason: "Encrypted token/backfill worker not wired" },
      fx: { quality: "MISSING", reason: "BOI historical FX fetch/backfill not wired" },
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to load Profit OS data health" });
  }
});

router.post("/profit-os/meta/token", (_req, res) => {
  // Never accept or persist Meta credentials in the legacy Express/SQLite path.
  // The secure implementation belongs in the authoritative Cloudflare Worker
  // where token validation + encryption-at-rest can be enforced.
  res.status(503).json({
    error: "Meta token storage is intentionally disabled until the Cloudflare secret-vault source is synchronized and reviewed.",
  });
});

export default router;

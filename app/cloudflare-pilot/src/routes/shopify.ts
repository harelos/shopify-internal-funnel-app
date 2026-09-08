import { Router } from "express";
import { ShopifyAdminClient, ShopifyConfigurationError } from "../lib/shopify-admin.js";
import { publicShopifyStatus } from "../lib/shopify-config.js";
import { publicShopifyPixelStatus } from "../lib/shopify-pixel-status.js";

const router = Router();
const adminClient = new ShopifyAdminClient();

// Configuration-only diagnostics. Never returns credential values.
router.get("/shopify/status", (_req, res) => {
  res.json(publicShopifyStatus());
});

// Read-only live probe. It does not run while SHOPIFY_LIVE_CONNECT=false.
router.get("/shopify/store", async (_req, res) => {
  try {
    const authorization = _req.get("authorization") ?? "";
    const sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
    const data = await adminClient.storeSummary(sessionToken);
    res.json({ ok: true, store: data.shop });
  } catch (error) {
    if (error instanceof ShopifyConfigurationError) {
      return res.status(503).json({ ok: false, error: error.message });
    }
    res.status(502).json({ ok: false, error: "Shopify store probe failed." });
  }
});

// Read-only production pixel probe. Returns health booleans only: the pixel
// settings document and Shopify identifier never leave the authenticated API.
router.get("/shopify/pixel-status", async (req, res) => {
  try {
    const authorization = req.get("authorization") ?? "";
    const sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
    const data = await adminClient.webPixelConfiguration(sessionToken);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, ...publicShopifyPixelStatus(data.webPixel) });
  } catch (error) {
    if (error instanceof ShopifyConfigurationError) {
      return res.status(503).json({ ok: false, state: "UNKNOWN", error: error.message });
    }
    return res.status(502).json({ ok: false, state: "UNKNOWN", error: "Shopify pixel probe failed." });
  }
});

// Read-only Shopify Analytics source. The query is deliberately allowlisted so
// the dashboard cannot turn this endpoint into an arbitrary report runner.
router.get("/shopify/analytics", async (req, res) => {
  const range = String(req.query.range ?? "30d");
  const duration = range === "7d" ? "-7d" : range === "90d" ? "-90d" : "-30d";
  const query = `FROM sales SHOW net_sales, orders TIMESERIES day SINCE startOfDay(${duration}) UNTIL endOfDay(-1d) ORDER BY day ASC`;

  try {
    const authorization = req.get("authorization") ?? "";
    const sessionToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
    const data = await adminClient.shopifyqlQuery(query, sessionToken);
    res.json({
      ok: true,
      source: "SHOPIFY_ANALYTICS",
      queryKey: "sales_daily_net_sales_orders",
      range,
      tableData: data.shopifyqlQuery.tableData ?? null,
      parseErrors: data.shopifyqlQuery.parseErrors ?? [],
      caveat: "ShopifyQL reports Shopify store totals. Funnel-specific attribution still comes from the app proxy and verified order webhooks.",
    });
  } catch (error) {
    if (error instanceof ShopifyConfigurationError) {
      return res.status(503).json({ ok: false, source: "SHOPIFY_ANALYTICS", error: error.message });
    }
    res.status(502).json({ ok: false, source: "SHOPIFY_ANALYTICS", error: "Shopify Analytics query failed." });
  }
});

export default router;

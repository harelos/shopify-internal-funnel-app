-- One row per funnel, day and source: the day-by-day table on the Funnels page.
--
-- Sources:
--   shopify_analytics  sessions / add-to-cart / checkout / purchase sessions as Shopify
--                      Analytics reports them (seeded from the store's own reports; the
--                      Worker cannot query ShopifyQL itself)
--   first_party        visitors the sales page itself reported to the app (CroAssignment),
--                      complete from 2026-09-18 for the NovaHair page
--   shopify_orders     paid orders and net revenue attributed to the funnel, refreshed
--                      from the Admin API and cached here per day
CREATE TABLE IF NOT EXISTS "FunnelDailyStat" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "funnelKey" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sessions" INTEGER,
  "addedToCart" INTEGER,
  "reachedCheckout" INTEGER,
  "purchases" INTEGER,
  "revenue" REAL,
  "currency" TEXT,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "FunnelDailyStat_key_day_source" ON "FunnelDailyStat" ("funnelKey", "day", "source");

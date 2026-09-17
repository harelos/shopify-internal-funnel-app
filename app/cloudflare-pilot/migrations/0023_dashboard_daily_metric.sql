-- One settled row per reporting day, in the reporting currency.
--
-- Every dashboard stat had to answer "better or worse than yesterday?" and the
-- ledger only held ad spend and supplier cost per day; revenue and orders lived
-- in range-keyed coverage rows, so no comparison could be made without
-- re-querying Shopify for every window on every page load.
CREATE TABLE IF NOT EXISTS "DashboardDailyMetric" (
  "localDate" TEXT NOT NULL PRIMARY KEY,
  "currency" TEXT NOT NULL,
  "netRevenue" REAL,
  "orders" INTEGER,
  "paymentFees" REAL,
  "adSpend" REAL,
  "productCost" REAL,
  "trackedVisitors" INTEGER,
  "ordersLinkedToVisitor" INTEGER,
  -- Whether every sale that day carries a CJ cost, so a comparison never
  -- treats a half-priced day as a cheaper one.
  "costPricedOrders" INTEGER,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "DashboardDailyMetric_updatedAt_idx" ON "DashboardDailyMetric" ("updatedAt");

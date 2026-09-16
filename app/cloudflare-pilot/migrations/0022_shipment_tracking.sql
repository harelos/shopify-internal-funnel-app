-- CJ's tracking feed carries the real parcel location ("Released from
-- customs", "Parcel prepared to be sent to pickup point"). Until now only the
-- coarse status ("En Route") survived into the store, so the dashboard called
-- parcels that had cleared Israeli customs critical and the support AI told a
-- customer at the pickup point that her parcel was "on the way".

-- Per-tracking-number cache of the normalised CJ status, shared by the support
-- AI, the storefront tracking page, the dashboard and the outreach cron, so a
-- parcel is fetched from CJ at most a few times an hour across all of them.
CREATE TABLE IF NOT EXISTS "ShipmentTrackingCache" (
  "trackingNumber" TEXT NOT NULL PRIMARY KEY,
  "cjMailNo" TEXT,
  "stage" TEXT NOT NULL,
  "delivered" INTEGER NOT NULL DEFAULT 0,
  "inIsrael" INTEGER NOT NULL DEFAULT 0,
  "exception" INTEGER NOT NULL DEFAULT 0,
  "latestRemark" TEXT,
  "latestAt" DATETIME,
  "statusJson" TEXT NOT NULL,
  "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The monitor's snapshot now carries the full tracking number and the parsed
-- stage; the dashboard needs both to show "in Israel – last mile" instead of a
-- day count.
ALTER TABLE "ShipmentOrderState" ADD COLUMN "trackingNumber" TEXT;
ALTER TABLE "ShipmentOrderState" ADD COLUMN "trackingStage" TEXT;
ALTER TABLE "ShipmentOrderState" ADD COLUMN "latestRemark" TEXT;

-- Proactive delivery outreach: one row per order per milestone, so a customer
-- is never sent the same reassurance twice and a gift code is issued once.
CREATE TABLE IF NOT EXISTS "ShipmentOutreach" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderName" TEXT NOT NULL,
  "milestone" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "stage" TEXT,
  "draftId" TEXT,
  "discountCode" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentOutreach_order_milestone" ON "ShipmentOutreach" ("orderName", "milestone");

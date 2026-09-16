-- Page-split experiments.
--
-- Each variation is a real, separate page. Traffic is split server-side at the
-- app proxy and attribution is read back from Shopify's own customer journey,
-- so no storefront snippet exists that a theme edit can silently remove.

CREATE TABLE IF NOT EXISTS "PageExperiment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hypothesis" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "startedAt" DATETIME,
  "stoppedAt" DATETIME,
  "promotedVariantId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PageExperiment_shopId_key_key" ON "PageExperiment"("shopId", "key");

CREATE TABLE IF NOT EXISTS "PageExperimentVariant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  -- The storefront path this variation lives at, e.g. /pages/novahair-sales-b
  "landingPath" TEXT NOT NULL,
  "weight" INTEGER NOT NULL DEFAULT 1,
  "isControl" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PageExperimentVariant_experimentId_key_key" ON "PageExperimentVariant"("experimentId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "PageExperimentVariant_experimentId_landingPath_key" ON "PageExperimentVariant"("experimentId", "landingPath");

-- One row per visitor the splitter assigned. This is the denominator, counted
-- server-side, so it cannot drift from what the storefront actually rendered.
CREATE TABLE IF NOT EXISTS "PageExperimentAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "visitorKey" TEXT NOT NULL,
  "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "isInternal" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "PageExperimentAssignment_experimentId_visitorKey_key" ON "PageExperimentAssignment"("experimentId", "visitorKey");
CREATE INDEX IF NOT EXISTS "PageExperimentAssignment_variantId_assignedAt_idx" ON "PageExperimentAssignment"("variantId", "assignedAt");

-- Orders matched to a variation by the landing page Shopify recorded for them.
CREATE TABLE IF NOT EXISTS "PageExperimentOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "shopifyOrderGid" TEXT NOT NULL,
  "orderName" TEXT NOT NULL DEFAULT '',
  "netAmount" REAL NOT NULL,
  "currency" TEXT NOT NULL,
  "landingPage" TEXT NOT NULL,
  "matchedOn" TEXT NOT NULL,
  "utmCampaign" TEXT,
  "utmContent" TEXT,
  "processedAt" DATETIME NOT NULL,
  "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PageExperimentOrder_experimentId_shopifyOrderGid_key" ON "PageExperimentOrder"("experimentId", "shopifyOrderGid");
CREATE INDEX IF NOT EXISTS "PageExperimentOrder_variantId_processedAt_idx" ON "PageExperimentOrder"("variantId", "processedAt");

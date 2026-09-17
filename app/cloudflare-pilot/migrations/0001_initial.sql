PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Shop" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "domain" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Funnel" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Funnel_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Step" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "funnelId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'LANDING',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Step_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Variant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stepId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "publishedVersionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Variant_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ContentVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "variantId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "rawHtml" TEXT NOT NULL,
  "normalizedHtml" TEXT NOT NULL,
  "portReport" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" DATETIME,
  CONSTRAINT "ContentVersion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Experiment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "stepId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "allocationVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Experiment_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExperimentAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "weightBasisPoints" INTEGER NOT NULL,
  CONSTRAINT "ExperimentAllocation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExperimentAllocation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Visitor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "anonymousKeyHash" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Visitor_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Assignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "visitorId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Assignment_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Assignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Assignment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "Event" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'SYNTHETIC',
  "occurredAt" DATETIME NOT NULL,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "visitorId" TEXT,
  "funnelId" TEXT,
  "stepId" TEXT,
  "variantId" TEXT,
  "checkoutToken" TEXT,
  "utmSource" TEXT,
  "utmMedium" TEXT,
  "utmCampaign" TEXT,
  "deviceClass" TEXT,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "isTest" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Event_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Event_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Event_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Event_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "Step" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Event_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "Variant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CheckoutAttribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "checkoutToken" TEXT NOT NULL,
  "visitorId" TEXT,
  "funnelId" TEXT,
  "lastStepId" TEXT,
  "lastVariantId" TEXT,
  "startedAt" DATETIME NOT NULL,
  "completedAt" DATETIME,
  "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
  CONSTRAINT "CheckoutAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CheckoutAttribution_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OrderAttribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "shopifyOrderGid" TEXT NOT NULL,
  "checkoutToken" TEXT,
  "funnelId" TEXT,
  "variantId" TEXT,
  "currency" TEXT NOT NULL,
  "grossAmount" REAL NOT NULL,
  "netRevenueAmount" REAL NOT NULL,
  "refundedAmount" REAL NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PAID',
  "confidence" TEXT NOT NULL,
  "isTest" BOOLEAN NOT NULL DEFAULT true,
  "paidAt" DATETIME NOT NULL,
  "cancelledAt" DATETIME,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "OrderAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderAttribution_checkoutToken_fkey" FOREIGN KEY ("checkoutToken") REFERENCES "CheckoutAttribution" ("checkoutToken") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "ShopifyWebhookDelivery" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopifyWebhookDelivery_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Shop_domain_key" ON "Shop"("domain");
CREATE INDEX IF NOT EXISTS "Funnel_shopId_status_idx" ON "Funnel"("shopId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "Funnel_shopId_slug_key" ON "Funnel"("shopId", "slug");
CREATE INDEX IF NOT EXISTS "Step_funnelId_idx" ON "Step"("funnelId");
CREATE UNIQUE INDEX IF NOT EXISTS "Step_funnelId_position_key" ON "Step"("funnelId", "position");
CREATE UNIQUE INDEX IF NOT EXISTS "Variant_publishedVersionId_key" ON "Variant"("publishedVersionId");
CREATE INDEX IF NOT EXISTS "Variant_stepId_idx" ON "Variant"("stepId");
CREATE UNIQUE INDEX IF NOT EXISTS "Variant_stepId_name_key" ON "Variant"("stepId", "name");
CREATE INDEX IF NOT EXISTS "ContentVersion_variantId_state_idx" ON "ContentVersion"("variantId", "state");
CREATE UNIQUE INDEX IF NOT EXISTS "ContentVersion_variantId_revision_key" ON "ContentVersion"("variantId", "revision");
CREATE UNIQUE INDEX IF NOT EXISTS "Experiment_stepId_key" ON "Experiment"("stepId");
CREATE INDEX IF NOT EXISTS "ExperimentAllocation_experimentId_idx" ON "ExperimentAllocation"("experimentId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExperimentAllocation_experimentId_variantId_key" ON "ExperimentAllocation"("experimentId", "variantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Visitor_shopId_anonymousKeyHash_key" ON "Visitor"("shopId", "anonymousKeyHash");
CREATE INDEX IF NOT EXISTS "Assignment_experimentId_variantId_idx" ON "Assignment"("experimentId", "variantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Assignment_visitorId_experimentId_key" ON "Assignment"("visitorId", "experimentId");
CREATE UNIQUE INDEX IF NOT EXISTS "Event_eventKey_key" ON "Event"("eventKey");
CREATE INDEX IF NOT EXISTS "Event_funnelId_stepId_variantId_occurredAt_idx" ON "Event"("funnelId", "stepId", "variantId", "occurredAt");
CREATE INDEX IF NOT EXISTS "Event_checkoutToken_idx" ON "Event"("checkoutToken");
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutAttribution_checkoutToken_key" ON "CheckoutAttribution"("checkoutToken");
CREATE INDEX IF NOT EXISTS "CheckoutAttribution_funnelId_idx" ON "CheckoutAttribution"("funnelId");
CREATE UNIQUE INDEX IF NOT EXISTS "OrderAttribution_shopifyOrderGid_key" ON "OrderAttribution"("shopifyOrderGid");
CREATE INDEX IF NOT EXISTS "OrderAttribution_funnelId_variantId_paidAt_idx" ON "OrderAttribution"("funnelId", "variantId", "paidAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ShopifyWebhookDelivery_webhookId_key" ON "ShopifyWebhookDelivery"("webhookId");
CREATE INDEX IF NOT EXISTS "ShopifyWebhookDelivery_shopId_topic_receivedAt_idx" ON "ShopifyWebhookDelivery"("shopId", "topic", "receivedAt");

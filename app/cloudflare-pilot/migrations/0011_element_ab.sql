CREATE TABLE "ElementTemplate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GALLERY',
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "schemaJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ElementTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ElementSlot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "pagePath" TEXT NOT NULL,
  "slotKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetSelector" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ElementSlot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ElementTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ElementVariant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slotId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isControl" BOOLEAN NOT NULL DEFAULT false,
  "publishedVersionId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ElementVariant_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ElementSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ElementVariantVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "variantId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'DRAFT',
  "payloadJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" DATETIME,
  CONSTRAINT "ElementVariantVersion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ElementExperiment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "slotId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "allocationVersion" INTEGER NOT NULL DEFAULT 1,
  "posthogFlagKey" TEXT,
  "startedAt" DATETIME,
  "endedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ElementExperiment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ElementSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ElementExperimentAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "weightBasisPoints" INTEGER NOT NULL,
  CONSTRAINT "ElementExperimentAllocation_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ElementExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementExperimentAllocation_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ElementAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "visitorId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "allocationVersion" INTEGER NOT NULL DEFAULT 1,
  "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ElementAssignment_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementAssignment_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ElementExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementAssignment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ElementExposure" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "eventId" TEXT NOT NULL,
  "shopId" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isInternal" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ElementExposure_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementExposure_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ElementSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementExposure_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementExposure_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ElementAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementExposure_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ElementExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ElementExposure_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CheckoutElementAttribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "checkoutToken" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutElementAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutElementAttribution_checkoutToken_fkey" FOREIGN KEY ("checkoutToken") REFERENCES "CheckoutAttribution" ("checkoutToken") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutElementAttribution_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutElementAttribution_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ElementAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutElementAttribution_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ElementExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutElementAttribution_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutElementAttribution_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ElementSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "OrderElementAttribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "orderAttributionId" TEXT NOT NULL,
  "checkoutAttributionId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "attributedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderElementAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderElementAttribution_orderAttributionId_fkey" FOREIGN KEY ("orderAttributionId") REFERENCES "OrderAttribution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderElementAttribution_checkoutAttributionId_fkey" FOREIGN KEY ("checkoutAttributionId") REFERENCES "CheckoutElementAttribution" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderElementAttribution_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ElementAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderElementAttribution_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ElementExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderElementAttribution_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrderElementAttribution_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ElementSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ElementTemplate_shopId_type_idx" ON "ElementTemplate"("shopId", "type");
CREATE UNIQUE INDEX "ElementTemplate_shopId_key_key" ON "ElementTemplate"("shopId", "key");
CREATE INDEX "ElementSlot_shopId_status_idx" ON "ElementSlot"("shopId", "status");
CREATE UNIQUE INDEX "ElementSlot_shopId_pagePath_slotKey_key" ON "ElementSlot"("shopId", "pagePath", "slotKey");
CREATE UNIQUE INDEX "ElementVariant_publishedVersionId_key" ON "ElementVariant"("publishedVersionId");
CREATE INDEX "ElementVariant_slotId_idx" ON "ElementVariant"("slotId");
CREATE UNIQUE INDEX "ElementVariant_slotId_key_key" ON "ElementVariant"("slotId", "key");
CREATE INDEX "ElementVariantVersion_variantId_state_idx" ON "ElementVariantVersion"("variantId", "state");
CREATE UNIQUE INDEX "ElementVariantVersion_variantId_revision_key" ON "ElementVariantVersion"("variantId", "revision");
CREATE UNIQUE INDEX "ElementExperiment_slotId_key" ON "ElementExperiment"("slotId");
CREATE UNIQUE INDEX "ElementExperiment_key_key" ON "ElementExperiment"("key");
CREATE INDEX "ElementExperimentAllocation_experimentId_idx" ON "ElementExperimentAllocation"("experimentId");
CREATE UNIQUE INDEX "ElementExperimentAllocation_experimentId_variantId_key" ON "ElementExperimentAllocation"("experimentId", "variantId");
CREATE INDEX "ElementAssignment_experimentId_variantId_idx" ON "ElementAssignment"("experimentId", "variantId");
CREATE UNIQUE INDEX "ElementAssignment_visitorId_experimentId_key" ON "ElementAssignment"("visitorId", "experimentId");
CREATE UNIQUE INDEX "ElementExposure_eventId_key" ON "ElementExposure"("eventId");
CREATE INDEX "ElementExposure_experimentId_variantId_occurredAt_idx" ON "ElementExposure"("experimentId", "variantId", "occurredAt");
CREATE INDEX "ElementExposure_visitorId_occurredAt_idx" ON "ElementExposure"("visitorId", "occurredAt");
CREATE INDEX "CheckoutElementAttribution_experimentId_variantId_capturedAt_idx" ON "CheckoutElementAttribution"("experimentId", "variantId", "capturedAt");
CREATE UNIQUE INDEX "CheckoutElementAttribution_checkoutToken_experimentId_key" ON "CheckoutElementAttribution"("checkoutToken", "experimentId");
CREATE INDEX "OrderElementAttribution_experimentId_variantId_attributedAt_idx" ON "OrderElementAttribution"("experimentId", "variantId", "attributedAt");
CREATE UNIQUE INDEX "OrderElementAttribution_orderAttributionId_experimentId_key" ON "OrderElementAttribution"("orderAttributionId", "experimentId");

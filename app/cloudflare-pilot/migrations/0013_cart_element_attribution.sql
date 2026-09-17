CREATE TABLE "CartElementAttribution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "cartToken" TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "assignmentId" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CartElementAttribution_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartElementAttribution_visitorId_fkey" FOREIGN KEY ("visitorId") REFERENCES "Visitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartElementAttribution_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ElementAssignment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartElementAttribution_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "ElementExperiment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartElementAttribution_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ElementVariant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CartElementAttribution_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "ElementSlot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CartElementAttribution_cartToken_experimentId_key" ON "CartElementAttribution"("cartToken", "experimentId");
CREATE INDEX "CartElementAttribution_experimentId_variantId_capturedAt_idx" ON "CartElementAttribution"("experimentId", "variantId", "capturedAt");
CREATE INDEX "CartElementAttribution_shopId_cartToken_idx" ON "CartElementAttribution"("shopId", "cartToken");

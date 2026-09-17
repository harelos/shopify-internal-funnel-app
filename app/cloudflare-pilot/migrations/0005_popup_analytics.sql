ALTER TABLE "OrderAttribution" ADD COLUMN "discountCodes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "OrderAttribution" ADD COLUMN "popupAttributed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupVisitorKey" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupSessionKey" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupVersion" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupCouponCode" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupPage" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupDevice" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupUtmSource" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupUtmMedium" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupUtmCampaign" TEXT;
ALTER TABLE "OrderAttribution" ADD COLUMN "popupAttributionMethod" TEXT;

CREATE INDEX "OrderAttribution_popupAttributed_popupVersion_paidAt_idx"
  ON "OrderAttribution"("popupAttributed", "popupVersion", "paidAt");
CREATE INDEX "OrderAttribution_popupCouponCode_paidAt_idx"
  ON "OrderAttribution"("popupCouponCode", "paidAt");
CREATE INDEX "Event_name_occurredAt_isTest_idx"
  ON "Event"("name", "occurredAt", "isTest");

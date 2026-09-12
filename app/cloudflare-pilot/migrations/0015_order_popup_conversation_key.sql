ALTER TABLE "OrderAttribution" ADD COLUMN "popupConversationKey" TEXT;

CREATE INDEX "OrderAttribution_popupConversationKey_paidAt_idx"
  ON "OrderAttribution"("popupConversationKey", "paidAt");

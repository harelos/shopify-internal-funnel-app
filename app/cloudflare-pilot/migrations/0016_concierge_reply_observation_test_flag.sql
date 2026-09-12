ALTER TABLE "ConciergeReplyObservation" ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ConciergeReplyObservation_isTest_createdAt_idx"
  ON "ConciergeReplyObservation"("isTest", "createdAt");

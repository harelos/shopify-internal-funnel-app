CREATE TABLE "ConciergeReplyObservation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sessionId" TEXT,
  "stepId" TEXT,
  "customerQuestion" TEXT NOT NULL,
  "aiReply" TEXT NOT NULL,
  "selectedModel" TEXT NOT NULL,
  "latencyMs" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "nextScreen" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConciergeReplyObservation_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ConciergeReplyObservation_shopId_conversationId_createdAt_idx"
  ON "ConciergeReplyObservation"("shopId", "conversationId", "createdAt");

CREATE INDEX "ConciergeReplyObservation_conversationId_idx"
  ON "ConciergeReplyObservation"("conversationId");

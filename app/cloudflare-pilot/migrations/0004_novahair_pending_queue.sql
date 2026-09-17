CREATE TABLE IF NOT EXISTS "NovaHairPendingOrder" (
  "orderId" TEXT NOT NULL PRIMARY KEY,
  "orderNum" TEXT NOT NULL,
  "rawId" TEXT NOT NULL,
  "syncState" TEXT NOT NULL DEFAULT 'WAITING_FOR_CJ_SYNC',
  "expectedData" TEXT NOT NULL,
  "orderPayload" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" DATETIME,
  "completedAt" DATETIME,
  "result" TEXT
);

CREATE INDEX IF NOT EXISTS "idx_nh_pending_state" ON "NovaHairPendingOrder" ("syncState");

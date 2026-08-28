CREATE TABLE IF NOT EXISTS "NovaHairMonitorState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "releaseState" TEXT NOT NULL DEFAULT 'PRODUCTION_ACTIVE_UNDER_MONITORING',
  "deploymentTimestamp" TEXT NOT NULL DEFAULT '2026-08-23T08:06:02Z',
  "passedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "circuitBreakerTriggered" BOOLEAN NOT NULL DEFAULT 0,
  "purchaseKillSwitchActive" BOOLEAN NOT NULL DEFAULT 0,
  "transformActive" BOOLEAN NOT NULL DEFAULT 1,
  "monitoredOrders" TEXT NOT NULL DEFAULT '[]',
  "seenOrderIds" TEXT NOT NULL DEFAULT '[]',
  "incidentData" TEXT,
  "lastWebhookTimestamp" TEXT,
  "lastCjSyncTimestamp" TEXT,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO "NovaHairMonitorState" ("id", "releaseState", "deploymentTimestamp", "passedCount", "failedCount", "circuitBreakerTriggered", "purchaseKillSwitchActive", "transformActive", "monitoredOrders", "seenOrderIds")
VALUES ('singleton', 'PRODUCTION_ACTIVE_UNDER_MONITORING', '2026-08-23T08:06:02Z', 0, 0, 0, 0, 1, '[]', '[]');

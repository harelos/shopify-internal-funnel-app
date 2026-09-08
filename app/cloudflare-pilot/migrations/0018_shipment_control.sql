CREATE TABLE "ShipmentMonitorRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generatedAt" DATETIME NOT NULL,
  "receivedAt" DATETIME NOT NULL,
  "timeZone" TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  "shopifyState" TEXT NOT NULL,
  "cjState" TEXT NOT NULL,
  "orderCount" INTEGER NOT NULL DEFAULT 0,
  "actionableCount" INTEGER NOT NULL DEFAULT 0,
  "criticalCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCjOrderCount" INTEGER NOT NULL DEFAULT 0,
  "cjReadErrorCount" INTEGER NOT NULL DEFAULT 0,
  "sourceHealthJson" TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX "ShipmentMonitorRun_receivedAt_idx"
  ON "ShipmentMonitorRun"("receivedAt" DESC);

CREATE TABLE "ShipmentOrderState" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderName" TEXT NOT NULL UNIQUE,
  "shopifyOrderGid" TEXT,
  "providerOrderReference" TEXT,
  "severity" TEXT NOT NULL DEFAULT 'MONITORING',
  "primarySignal" TEXT NOT NULL DEFAULT 'MONITORING',
  "statusLabel" TEXT NOT NULL,
  "doNow" TEXT NOT NULL,
  "contactTarget" TEXT NOT NULL DEFAULT 'Monitor',
  "signalsJson" TEXT NOT NULL DEFAULT '[]',
  "workflowState" TEXT NOT NULL DEFAULT 'NEW',
  "assignedTo" TEXT,
  "ownerNote" TEXT,
  "isActionable" INTEGER NOT NULL DEFAULT 0,
  "delivered" INTEGER NOT NULL DEFAULT 0,
  "active" INTEGER NOT NULL DEFAULT 1,
  "sourceAgreement" TEXT NOT NULL DEFAULT 'VERIFIED',
  "shopifyFinancialStatus" TEXT,
  "shopifyFulfillmentStatus" TEXT,
  "shopifyRiskRecommendation" TEXT,
  "saleTransactionCount" INTEGER NOT NULL DEFAULT 0,
  "afterSellLikely" INTEGER NOT NULL DEFAULT 0,
  "cjStatus" TEXT,
  "cjSubStatus" TEXT,
  "trackingStatus" TEXT,
  "trackingProvider" TEXT,
  "trackingLast4" TEXT,
  "orderBusinessDays" INTEGER NOT NULL DEFAULT 0,
  "labelBusinessDays" INTEGER NOT NULL DEFAULT 0,
  "inactiveDays" INTEGER NOT NULL DEFAULT 0,
  "orderCreatedAt" DATETIME,
  "trackingCreatedAt" DATETIME,
  "latestTrackingAt" DATETIME,
  "outWarehouseAt" DATETIME,
  "firstSeenAt" DATETIME NOT NULL,
  "lastSeenAt" DATETIME NOT NULL,
  "resolvedAt" DATETIME,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "ShipmentOrderState_priority_idx"
  ON "ShipmentOrderState"("active", "isActionable", "severity", "workflowState");
CREATE INDEX "ShipmentOrderState_lastSeenAt_idx"
  ON "ShipmentOrderState"("lastSeenAt" DESC);

CREATE TABLE "ShipmentActionLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shipmentOrderId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousState" TEXT,
  "nextState" TEXT,
  "note" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'OWNER',
  "createdAt" DATETIME NOT NULL,
  FOREIGN KEY ("shipmentOrderId") REFERENCES "ShipmentOrderState"("id") ON DELETE CASCADE
);

CREATE INDEX "ShipmentActionLog_order_created_idx"
  ON "ShipmentActionLog"("shipmentOrderId", "createdAt" DESC);


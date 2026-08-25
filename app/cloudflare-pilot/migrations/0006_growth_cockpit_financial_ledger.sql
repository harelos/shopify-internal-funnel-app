CREATE TABLE IF NOT EXISTS "FinancialLedgerEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "occurredDate" TEXT NOT NULL,
  "amount" REAL NOT NULL,
  "currency" TEXT NOT NULL,
  "quality" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialLedgerEntry_source_category_externalKey_key"
  ON "FinancialLedgerEntry"("source", "category", "externalKey");
CREATE INDEX IF NOT EXISTS "FinancialLedgerEntry_source_category_occurredDate_idx"
  ON "FinancialLedgerEntry"("source", "category", "occurredDate");

CREATE TABLE IF NOT EXISTS "FinancialLedgerCoverage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "source" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "rangeKey" TEXT NOT NULL,
  "localFrom" TEXT,
  "localTo" TEXT,
  "amount" REAL NOT NULL,
  "currency" TEXT NOT NULL,
  "quality" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "reconciledAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" TEXT NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialLedgerCoverage_source_category_rangeKey_key"
  ON "FinancialLedgerCoverage"("source", "category", "rangeKey");

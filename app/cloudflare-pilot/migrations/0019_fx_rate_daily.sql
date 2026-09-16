CREATE TABLE IF NOT EXISTS "FxRateDaily" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "baseCurrency" TEXT NOT NULL,
  "quoteCurrency" TEXT NOT NULL,
  "rateDate" TEXT NOT NULL,
  "rate" REAL NOT NULL,
  "source" TEXT NOT NULL,
  "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FxRateDaily_base_quote_rateDate_key"
  ON "FxRateDaily"("baseCurrency", "quoteCurrency", "rateDate");
CREATE INDEX IF NOT EXISTS "FxRateDaily_base_quote_rateDate_idx"
  ON "FxRateDaily"("baseCurrency", "quoteCurrency", "rateDate" DESC);

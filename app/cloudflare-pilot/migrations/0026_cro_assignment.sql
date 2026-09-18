-- Who is in the adaptive CRO test, counted first-party.
--
-- PostHog only answers after the shopper accepts cookies, so it never saw most
-- visitors: two paid orders on the first night carried no variant at all. The
-- page now decides the variant itself and reports it here, which makes this
-- table the denominator. One row per visitor per test, kept for good, so the
-- results table is not limited by the live feed's 48-hour pruning.
CREATE TABLE IF NOT EXISTS "CroAssignment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "experimentKey" TEXT NOT NULL,
  "variant" TEXT NOT NULL,
  "visitorKey" TEXT NOT NULL,
  "firstSeenAt" DATETIME NOT NULL,
  "lastSeenAt" DATETIME NOT NULL,
  "addedToCart" INTEGER NOT NULL DEFAULT 0,
  "reachedCheckout" INTEGER NOT NULL DEFAULT 0,
  "isInternal" INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "CroAssignment_experiment_visitor_key" ON "CroAssignment"("experimentKey", "visitorKey");
CREATE INDEX IF NOT EXISTS "CroAssignment_experiment_firstSeen_idx" ON "CroAssignment"("experimentKey", "firstSeenAt");

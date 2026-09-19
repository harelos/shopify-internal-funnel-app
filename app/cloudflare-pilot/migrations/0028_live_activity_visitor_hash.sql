-- Journeys join the sales page's live events to paid orders.
--
-- The checkout pixel carries the browser's visitor key, which the app stores
-- hashed on the Visitor row. Live events keep the raw key; storing the same
-- hash next to it lets a journey read "landed → shade → cart → checkout → paid"
-- for one person without ever comparing raw keys across tables.
ALTER TABLE "LiveActivity" ADD COLUMN "visitorHash" TEXT;
CREATE INDEX IF NOT EXISTS "LiveActivity_visitorHash_occurredAt" ON "LiveActivity" ("visitorHash", "occurredAt");

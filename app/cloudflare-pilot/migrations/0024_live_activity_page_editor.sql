-- Live funnel feed and the page editor's safety net.
--
-- LiveActivity holds what shoppers on the sales page did in the last two days,
-- reported by the page itself: PostHog is minutes behind, and "watch it live"
-- needs seconds. Rows are small, pruned on write, and never identify anyone.
CREATE TABLE IF NOT EXISTS "LiveActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "visitorKey" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL,
  "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT '',
  "page" TEXT NOT NULL DEFAULT '/',
  "detail" TEXT NOT NULL DEFAULT '{}',
  "device" TEXT NOT NULL DEFAULT 'unknown',
  "source" TEXT NOT NULL DEFAULT 'direct',
  "variant" TEXT,
  "isInternal" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "LiveActivity_receivedAt_idx" ON "LiveActivity"("receivedAt");
CREATE INDEX IF NOT EXISTS "LiveActivity_session_idx" ON "LiveActivity"("sessionKey", "occurredAt");

-- Every publish from the page editor keeps what it replaced, so a bad edit is
-- one click from undone. Bodies are ~300 KB; thirty per page are kept.
CREATE TABLE IF NOT EXISTS "PageEditorBackup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "handle" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "templateSuffix" TEXT,
  "body" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PageEditorBackup_handle_createdAt_idx" ON "PageEditorBackup"("handle", "createdAt");

-- A draft survives closing the tab and moving to another device.
CREATE TABLE IF NOT EXISTS "PageEditorDraft" (
  "handle" TEXT NOT NULL PRIMARY KEY,
  "body" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

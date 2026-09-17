-- CJ rate-limits authentication to roughly one call every five minutes, and a
-- Worker isolate keeps its in-memory token only until it is recycled. Persisting
-- the token lets a scheduled reconciliation run without re-authenticating on
-- every invocation and being locked out.
CREATE TABLE IF NOT EXISTS "ServiceTokenCache" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

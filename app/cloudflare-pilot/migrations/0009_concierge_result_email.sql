CREATE TABLE IF NOT EXISTS ConciergeResultEmail (
  eventKey TEXT PRIMARY KEY NOT NULL,
  customerKey TEXT NOT NULL,
  attemptId TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  sentAt INTEGER
);

CREATE INDEX IF NOT EXISTS ConciergeResultEmail_customerKey_createdAt_idx
  ON ConciergeResultEmail(customerKey, createdAt);

CREATE INDEX IF NOT EXISTS ConciergeResultEmail_status_createdAt_idx
  ON ConciergeResultEmail(status, createdAt);

CREATE TABLE IF NOT EXISTS ConciergeOtpChallenge (
  id TEXT PRIMARY KEY NOT NULL,
  emailHash TEXT NOT NULL,
  customerId TEXT,
  otpHash TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumedAt INTEGER,
  createdAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ConciergeOtpChallenge_emailHash_createdAt_idx
  ON ConciergeOtpChallenge(emailHash, createdAt);

CREATE INDEX IF NOT EXISTS ConciergeOtpChallenge_expiresAt_idx
  ON ConciergeOtpChallenge(expiresAt);

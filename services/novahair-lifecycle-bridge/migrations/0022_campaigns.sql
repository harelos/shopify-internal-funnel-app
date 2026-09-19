-- Phase 2 of the campaign system: named segments over the customers table,
-- campaigns that send to a frozen snapshot of one segment, and a per-recipient
-- ledger so a send is resumable, auditable and attributable.

-- A segment is a stored, validated filter. It is never raw SQL: the filter JSON
-- is parsed against an allowlist and compiled to bound parameters at query time.
CREATE TABLE IF NOT EXISTS segments (
  segment_id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  filter_json TEXT NOT NULL,
  last_count INTEGER,
  last_counted_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_segments_updated ON segments(updated_at DESC);

-- One campaign is one send to one segment.
--   DRAFT -> APPROVED -> SENDING -> SENT
--   DRAFT -> REJECTED
--   APPROVED/SENDING -> CANCELLED
-- Nothing leaves DRAFT without an explicit approval, so an agent can propose
-- freely and no proposal can reach a customer on its own.
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  segment_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  preheader TEXT,
  html TEXT NOT NULL,
  cta_url TEXT,
  kind TEXT NOT NULL DEFAULT 'marketing' CHECK (kind IN ('marketing', 'transactional')),
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'SENDING', 'SENT', 'REJECTED', 'CANCELLED')),
  send_after TEXT,
  max_recipients INTEGER,
  proposed_by TEXT NOT NULL,
  proposal_reason TEXT,
  approved_by TEXT,
  approved_at TEXT,
  rejected_reason TEXT,
  audience_built_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  recipients_total INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status, send_after);
CREATE INDEX IF NOT EXISTS idx_campaigns_created ON campaigns(created_at DESC);

-- The audience is frozen into this table at approval time, so the people who
-- receive the campaign are exactly the people who were reviewed, even if the
-- underlying segment shifts mid-send.
CREATE TABLE IF NOT EXISTS campaign_recipients (
  campaign_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  skip_reason TEXT,
  resend_email_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  queued_at TEXT NOT NULL,
  sent_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  unsubscribed_at TEXT,
  PRIMARY KEY (campaign_id, email_hash)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_due
  ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_hash
  ON campaign_recipients(email_hash, sent_at);

-- A stable opaque token per customer, so one unsubscribe link works from any
-- email we ever send them and no email address or hash appears in the URL.
ALTER TABLE customers ADD COLUMN unsubscribe_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_unsub_token
  ON customers(unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;

-- Unsubscribes must reach Shopify too, or the next Shopify-side sync would
-- happily resurrect the consent we just revoked. Queued here and drained by
-- cron, in the same shape as resend_contact_updates.
CREATE TABLE IF NOT EXISTS shopify_consent_updates (
  idempotency_key TEXT PRIMARY KEY,
  shopify_customer_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  marketing_state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRY', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 7,
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_consent_due
  ON shopify_consent_updates(status, next_attempt_at);

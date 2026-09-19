-- Per-recipient delivery failures, so a campaign's bounce and complaint rate
-- can be read directly instead of inferred by joining the suppression list.
-- Without these a bad send is only visible after the damage is done.
ALTER TABLE campaign_recipients ADD COLUMN bounced_at TEXT;
ALTER TABLE campaign_recipients ADD COLUMN complained_at TEXT;

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_failures
  ON campaign_recipients(campaign_id, bounced_at, complained_at);

-- Why a campaign stopped itself, so a halt is never silent.
ALTER TABLE campaigns ADD COLUMN halt_reason TEXT;

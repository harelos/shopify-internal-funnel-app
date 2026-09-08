ALTER TABLE lifecycle_attribution ADD COLUMN entity_type TEXT;
ALTER TABLE lifecycle_attribution ADD COLUMN entity_id TEXT;
ALTER TABLE lifecycle_attribution ADD COLUMN recipient_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_lifecycle_attribution_recipient_click
  ON lifecycle_attribution(recipient_hash, clicked_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_attribution_entity_click
  ON lifecycle_attribution(entity_type, entity_id, clicked_at);

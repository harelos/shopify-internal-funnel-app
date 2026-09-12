ALTER TABLE abandoned_checkouts ADD COLUMN checkout_token_hash TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN checkout_token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_token_hash
  ON abandoned_checkouts(checkout_token_hash);
CREATE INDEX IF NOT EXISTS idx_lifecycle_orders_token_hash
  ON lifecycle_orders(checkout_token_hash);

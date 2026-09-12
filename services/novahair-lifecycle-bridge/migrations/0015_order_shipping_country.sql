-- Restrict post-purchase/replenishment lifecycle flows to Israel-only destinations.
ALTER TABLE lifecycle_orders ADD COLUMN shipping_country_code TEXT;
CREATE INDEX IF NOT EXISTS idx_lifecycle_orders_shipping_country
  ON lifecycle_orders(shipping_country_code);

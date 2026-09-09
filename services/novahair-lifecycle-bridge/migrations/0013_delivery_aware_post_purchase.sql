-- Delivery-aware post-purchase scheduling. Tracking numbers are stored only as hashes.
ALTER TABLE lifecycle_orders ADD COLUMN tracking_status TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN tracking_company TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN tracking_number_hash TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN tracking_available_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN in_transit_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN ready_for_pickup_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN out_for_delivery_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN delivered_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN estimated_delivery_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN fulfillment_updated_at TEXT;
ALTER TABLE lifecycle_orders ADD COLUMN post_purchase_delivery_scheduled_at TEXT;

CREATE TABLE IF NOT EXISTS shopify_fulfillment_events (
  event_key TEXT PRIMARY KEY,
  shopify_fulfillment_id TEXT,
  shopify_order_id TEXT NOT NULL,
  status TEXT,
  happened_at TEXT NOT NULL,
  source TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_shopify_fulfillment_order_time
  ON shopify_fulfillment_events(shopify_order_id, happened_at);
CREATE INDEX IF NOT EXISTS idx_shopify_fulfillment_status_time
  ON shopify_fulfillment_events(status, happened_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_orders_delivery_watch
  ON lifecycle_orders(delivered_at, completed_at);

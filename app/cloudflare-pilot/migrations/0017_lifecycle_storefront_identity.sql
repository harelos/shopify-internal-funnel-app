CREATE TABLE IF NOT EXISTS lifecycle_identity_claims (
  claim_id TEXT PRIMARY KEY,
  shopify_customer_id TEXT,
  email TEXT,
  first_name TEXT,
  visitor_hash TEXT NOT NULL,
  consent_state TEXT NOT NULL CHECK (consent_state IN ('SUBSCRIBED', 'NOT_SUBSCRIBED', 'UNKNOWN')),
  source TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_identity_claims_pending
  ON lifecycle_identity_claims(processed_at, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_identity_claims_visitor
  ON lifecycle_identity_claims(visitor_hash, occurred_at);

CREATE TABLE IF NOT EXISTS storefront_lifecycle_events (
  event_id TEXT PRIMARY KEY,
  visitor_hash TEXT NOT NULL,
  shopify_customer_id TEXT,
  event_name TEXT NOT NULL CHECK (event_name IN (
    'product_viewed', 'product_added_to_cart', 'product_removed_from_cart',
    'cart_viewed', 'checkout_started', 'checkout_completed'
  )),
  occurred_at TEXT NOT NULL,
  product_handle TEXT,
  product_name TEXT,
  product_image TEXT,
  variant_id TEXT,
  variant_name TEXT,
  quantity INTEGER,
  cart_id TEXT,
  checkout_id TEXT,
  payload_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  processed_at TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storefront_lifecycle_events_pending
  ON storefront_lifecycle_events(processed_at, next_attempt_at, occurred_at);
CREATE INDEX IF NOT EXISTS idx_storefront_lifecycle_events_visitor
  ON storefront_lifecycle_events(visitor_hash, occurred_at);

CREATE TABLE IF NOT EXISTS storefront_lifecycle_state (
  visitor_hash TEXT PRIMARY KEY,
  identity_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN ('BROWSE', 'CART', 'CHECKOUT', 'PURCHASE')),
  last_event_at TEXT NOT NULL,
  last_product_handle TEXT,
  last_product_name TEXT,
  last_product_image TEXT,
  last_variant_id TEXT,
  last_variant_name TEXT,
  last_cart_id TEXT,
  last_checkout_id TEXT,
  browse_generation INTEGER NOT NULL DEFAULT 0,
  cart_generation INTEGER NOT NULL DEFAULT 0,
  browse_triggered_at TEXT,
  cart_triggered_at TEXT,
  checkout_at TEXT,
  purchase_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storefront_lifecycle_state_identity
  ON storefront_lifecycle_state(identity_id, stage, last_event_at);

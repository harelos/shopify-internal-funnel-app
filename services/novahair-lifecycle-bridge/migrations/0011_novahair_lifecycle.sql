-- NovaHair lifecycle infrastructure.
-- Sensitive recovery URLs are encrypted before insertion into checkout_url.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS abandoned_checkouts (
  shopify_checkout_id TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  customer_id TEXT,
  email TEXT,
  email_hash TEXT,
  first_name TEXT,
  checkout_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  automation_triggered_at TEXT,
  recovery_event_sent_at TEXT,
  purchase_event_sent_at TEXT,
  consent_state TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'ABANDONED', 'RECOVERED', 'PURCHASED', 'INELIGIBLE', 'SUPPRESSED', 'EXHAUSTED')),
  next_email_number INTEGER NOT NULL DEFAULT 1,
  next_due_at TEXT,
  payload_hash TEXT NOT NULL,
  product_name TEXT,
  product_image TEXT,
  variant TEXT,
  shade TEXT,
  bundle TEXT,
  quantity INTEGER,
  total REAL,
  currency TEXT,
  last_error_code TEXT,
  created_record_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_record_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_state_due
  ON abandoned_checkouts(state, next_due_at);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_updated
  ON abandoned_checkouts(updated_at);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_email_state
  ON abandoned_checkouts(email_hash, state);
CREATE INDEX IF NOT EXISTS idx_abandoned_checkouts_completed
  ON abandoned_checkouts(completed_at);

CREATE TABLE IF NOT EXISTS shopify_event_receipts (
  event_id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  shop_domain TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_shopify_event_receipts_topic_received
  ON shopify_event_receipts(topic, received_at);

CREATE TABLE IF NOT EXISTS resend_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  contact_hash TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRY', 'UNCERTAIN', 'DEAD', 'CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 7,
  next_attempt_at TEXT NOT NULL,
  resend_event_name TEXT,
  last_http_status INTEGER,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_resend_events_dispatch
  ON resend_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_resend_events_entity
  ON resend_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_resend_events_name_sent
  ON resend_events(event_name, sent_at);

CREATE TABLE IF NOT EXISTS email_delivery_events (
  webhook_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resend_email_id TEXT,
  template_id TEXT,
  automation_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  recipient_hash TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
  processed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_events_email
  ON email_delivery_events(resend_email_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_events_type_time
  ON email_delivery_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_events_entity
  ON email_delivery_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_email_delivery_events_status
  ON email_delivery_events(status, received_at);

CREATE TABLE IF NOT EXISTS automation_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  flow TEXT NOT NULL,
  email_number INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  recipient_hash TEXT,
  template_alias TEXT NOT NULL,
  template_id TEXT,
  automation_id TEXT,
  resend_email_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('SCHEDULED', 'TRIGGERED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'FAILED', 'SUPPRESSED', 'CANCELLED')),
  scheduled_at TEXT,
  triggered_at TEXT,
  sent_at TEXT,
  clicked_at TEXT,
  recovered_at TEXT,
  order_id TEXT,
  utm_campaign TEXT NOT NULL,
  utm_content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_tracking_flow_status
  ON automation_tracking(flow, status);
CREATE INDEX IF NOT EXISTS idx_automation_tracking_entity
  ON automation_tracking(entity_type, entity_id, email_number);
CREATE INDEX IF NOT EXISTS idx_automation_tracking_resend_email
  ON automation_tracking(resend_email_id);
CREATE INDEX IF NOT EXISTS idx_automation_tracking_recipient
  ON automation_tracking(recipient_hash, status, triggered_at);

CREATE TABLE IF NOT EXISTS suppressions (
  email_hash TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  reason TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resend_email_id TEXT,
  shopify_customer_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_suppressions_active
  ON suppressions(active, occurred_at);

CREATE TABLE IF NOT EXISTS lifecycle_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component TEXT NOT NULL,
  error_code TEXT NOT NULL,
  safe_message TEXT NOT NULL,
  context_hash TEXT,
  retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
  occurred_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_errors_open
  ON lifecycle_errors(resolved_at, occurred_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_errors_component
  ON lifecycle_errors(component, occurred_at);

CREATE TABLE IF NOT EXISTS health_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OK',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_lifecycle_events (
  idempotency_key TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  flow TEXT NOT NULL,
  email_number INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'LEASED', 'DISPATCHED', 'CANCELLED', 'RETRY', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 7,
  lease_until TEXT,
  next_attempt_at TEXT NOT NULL,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_lifecycle_due
  ON scheduled_lifecycle_events(status, next_attempt_at, due_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_lifecycle_entity
  ON scheduled_lifecycle_events(entity_type, entity_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_lifecycle_flow
  ON scheduled_lifecycle_events(flow, email_number, due_at);

CREATE TABLE IF NOT EXISTS lifecycle_identity_links (
  identity_id TEXT PRIMARY KEY,
  shopify_customer_id TEXT,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL UNIQUE,
  first_name TEXT,
  visitor_hash TEXT,
  consent_state TEXT NOT NULL,
  consent_updated_at TEXT,
  identity_source TEXT NOT NULL,
  verified_at TEXT,
  lifecycle_stage TEXT NOT NULL DEFAULT 'WELCOME',
  last_product_handle TEXT,
  last_cart_id TEXT,
  last_checkout_id TEXT,
  last_order_id TEXT,
  last_order_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_identity_customer
  ON lifecycle_identity_links(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_identity_visitor
  ON lifecycle_identity_links(visitor_hash);
CREATE INDEX IF NOT EXISTS idx_lifecycle_identity_stage
  ON lifecycle_identity_links(lifecycle_stage, consent_state);

CREATE TABLE IF NOT EXISTS lifecycle_orders (
  shopify_order_id TEXT PRIMARY KEY,
  shopify_checkout_id TEXT,
  shopify_customer_id TEXT,
  email TEXT,
  email_hash TEXT,
  first_name TEXT,
  consent_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  completed_at TEXT NOT NULL,
  bundle TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  shade TEXT,
  product_name TEXT,
  total REAL,
  currency TEXT,
  post_purchase_started_at TEXT,
  replenishment_due_at TEXT,
  repeat_purchase INTEGER NOT NULL DEFAULT 0 CHECK (repeat_purchase IN (0, 1)),
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_orders_email_time
  ON lifecycle_orders(email_hash, completed_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_orders_replenishment
  ON lifecycle_orders(replenishment_due_at, repeat_purchase);
CREATE INDEX IF NOT EXISTS idx_lifecycle_orders_checkout
  ON lifecycle_orders(shopify_checkout_id);

CREATE TABLE IF NOT EXISTS lifecycle_attribution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attribution_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  flow TEXT,
  email_number INTEGER,
  template_id TEXT,
  automation_id TEXT,
  resend_email_id TEXT,
  shopify_checkout_id TEXT,
  shopify_order_id TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  sent_at TEXT,
  clicked_at TEXT,
  recovered_at TEXT,
  order_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_attribution_checkout
  ON lifecycle_attribution(shopify_checkout_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_attribution_order
  ON lifecycle_attribution(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_attribution_resend
  ON lifecycle_attribution(resend_email_id);

CREATE TABLE IF NOT EXISTS lifecycle_click_tokens (
  token TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  flow TEXT NOT NULL,
  email_number INTEGER NOT NULL,
  target_url TEXT NOT NULL,
  utm_campaign TEXT NOT NULL,
  utm_content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  first_clicked_at TEXT,
  last_clicked_at TEXT,
  click_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_click_entity
  ON lifecycle_click_tokens(entity_type, entity_id, email_number);
CREATE INDEX IF NOT EXISTS idx_lifecycle_click_expiry
  ON lifecycle_click_tokens(expires_at);

CREATE TABLE IF NOT EXISTS lifecycle_usage_counters (
  period_type TEXT NOT NULL CHECK (period_type IN ('DAY', 'MONTH')),
  period_key TEXT NOT NULL,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  automation_runs INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (period_type, period_key)
);

CREATE TABLE IF NOT EXISTS lifecycle_usage_event_receipts (
  source_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('emails_sent', 'automation_runs')),
  occurred_at TEXT NOT NULL,
  counted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_usage_receipts_uncounted
  ON lifecycle_usage_event_receipts(counted_at, occurred_at);

CREATE TABLE IF NOT EXISTS resend_contact_updates (
  idempotency_key TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  unsubscribed INTEGER NOT NULL CHECK (unsubscribed IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRY', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 7,
  next_attempt_at TEXT NOT NULL,
  last_http_status INTEGER,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_resend_contact_updates_dispatch
  ON resend_contact_updates(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS resend_resources (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('EVENT', 'TEMPLATE', 'AUTOMATION', 'WEBHOOK', 'DOMAIN')),
  name TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resend_resources_external
  ON resend_resources(resource_type, external_id);

CREATE TABLE IF NOT EXISTS lifecycle_cron_locks (
  lock_name TEXT PRIMARY KEY,
  lease_owner TEXT NOT NULL,
  lease_until TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

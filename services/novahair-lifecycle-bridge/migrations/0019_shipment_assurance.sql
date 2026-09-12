-- Shipment assurance, service-case pausing and dispute evidence infrastructure.
-- Customer messages remain disabled until their per-template QA and ownership gate passes.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS lifecycle_shipments (
  shopify_order_id TEXT PRIMARY KEY,
  cj_order_id_hash TEXT,
  tracking_number_hash TEXT,
  tracking_url_encrypted TEXT,
  normalized_state TEXT NOT NULL CHECK (normalized_state IN (
    'PAID', 'SUPPLIER_PROCESSING', 'TRACKING_ASSIGNED', 'CARRIER_PICKED_UP',
    'IN_TRANSIT', 'DELAYED', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP',
    'PICKED_UP', 'DELIVERED', 'BUYER_ACTION_REQUIRED', 'ATTEMPTED_DELIVERY',
    'RETURNING_TO_SENDER', 'REFUNDED', 'DISPUTED', 'UNKNOWN'
  )),
  state_source TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 1,
  paid_at TEXT NOT NULL,
  promised_min_at TEXT,
  promised_max_at TEXT,
  tracking_assigned_at TEXT,
  first_carrier_event_at TEXT,
  last_carrier_event_at TEXT,
  ready_for_pickup_at TEXT,
  picked_up_at TEXT,
  delivered_at TEXT,
  latest_safe_status TEXT,
  last_customer_update_at TEXT,
  next_review_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_shipments_state_review
  ON lifecycle_shipments(normalized_state, next_review_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_shipments_promise
  ON lifecycle_shipments(delivered_at, promised_max_at);

CREATE TABLE IF NOT EXISTS lifecycle_tracking_events (
  event_key TEXT PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_id TEXT,
  normalized_state TEXT NOT NULL,
  safe_status TEXT,
  happened_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at TEXT,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_tracking_order_time
  ON lifecycle_tracking_events(shopify_order_id, happened_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_tracking_state_time
  ON lifecycle_tracking_events(normalized_state, happened_at);

CREATE TABLE IF NOT EXISTS lifecycle_service_cases (
  case_id TEXT PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  customer_hash TEXT,
  reason TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
  promotion_paused INTEGER NOT NULL DEFAULT 1 CHECK (promotion_paused IN (0, 1)),
  source TEXT NOT NULL,
  external_reference TEXT,
  assigned_to TEXT,
  opened_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  last_customer_contact_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_service_cases_open
  ON lifecycle_service_cases(state, promotion_paused, opened_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_service_cases_order
  ON lifecycle_service_cases(shopify_order_id, state);

CREATE TABLE IF NOT EXISTS lifecycle_notification_claims (
  claim_key TEXT PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('SHOPIFY', 'RESEND', 'CARRIER', 'SUPPORT')),
  status TEXT NOT NULL CHECK (status IN ('CLAIMED', 'SENT', 'SUPPRESSED', 'FAILED')),
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  suppression_reason TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_notification_order_purpose
  ON lifecycle_notification_claims(shopify_order_id, purpose, state_version);

CREATE TABLE IF NOT EXISTS lifecycle_customer_preferences (
  preference_key TEXT PRIMARY KEY,
  identity_id TEXT,
  shopify_order_id TEXT,
  preference_type TEXT NOT NULL,
  preference_value TEXT NOT NULL,
  source_token_hash TEXT,
  effective_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_preferences_identity
  ON lifecycle_customer_preferences(identity_id, preference_type, effective_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_preferences_order
  ON lifecycle_customer_preferences(shopify_order_id, preference_type, effective_at);

CREATE TABLE IF NOT EXISTS lifecycle_disputes (
  shopify_dispute_id TEXT PRIMARY KEY,
  shopify_order_id TEXT,
  transaction_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  amount REAL,
  currency TEXT,
  evidence_due_at TEXT,
  evidence_snapshot_id TEXT,
  assigned_to TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_disputes_status_due
  ON lifecycle_disputes(status, evidence_due_at);
CREATE INDEX IF NOT EXISTS idx_lifecycle_disputes_order
  ON lifecycle_disputes(shopify_order_id, received_at);

CREATE TABLE IF NOT EXISTS lifecycle_evidence_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  shopify_order_id TEXT NOT NULL,
  shopify_dispute_id TEXT,
  reason TEXT NOT NULL,
  encrypted_snapshot TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (shopify_order_id) REFERENCES lifecycle_orders(shopify_order_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_evidence_order
  ON lifecycle_evidence_snapshots(shopify_order_id, created_at);

CREATE TABLE IF NOT EXISTS lifecycle_internal_alerts (
  alert_key TEXT PRIMARY KEY,
  shopify_order_id TEXT,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  state_version INTEGER NOT NULL,
  safe_message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_internal_alerts_open
  ON lifecycle_internal_alerts(status, severity, last_seen_at);

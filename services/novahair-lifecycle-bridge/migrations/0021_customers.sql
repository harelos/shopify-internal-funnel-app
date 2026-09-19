-- One row per person. This is the customer-intelligence layer that campaigns
-- segment against. Shopify is the source for identity, consent and purchase
-- history; email_delivery_events is the source for engagement. Nothing here
-- is authoritative for consent decisions: consentAllowsMarketing() still reads
-- the live value, this table only caches it for segmentation.
CREATE TABLE IF NOT EXISTS customers (
  email_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  shopify_customer_id TEXT,
  first_name TEXT,
  consent_state TEXT NOT NULL DEFAULT 'UNKNOWN',
  consent_updated_at TEXT,
  customer_since TEXT,
  first_order_at TEXT,
  last_order_at TEXT,
  order_count INTEGER NOT NULL DEFAULT 0,
  lifetime_value REAL NOT NULL DEFAULT 0,
  lifetime_currency TEXT,
  products_json TEXT NOT NULL DEFAULT '[]',
  novahair_buyer INTEGER NOT NULL DEFAULT 0,
  emails_sent INTEGER NOT NULL DEFAULT 0,
  emails_opened INTEGER NOT NULL DEFAULT 0,
  emails_clicked INTEGER NOT NULL DEFAULT 0,
  last_email_at TEXT,
  last_open_at TEXT,
  last_click_at TEXT,
  engagement_score INTEGER NOT NULL DEFAULT 0,
  score_computed_at TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_consent ON customers(consent_state);
CREATE INDEX IF NOT EXISTS idx_customers_last_order ON customers(last_order_at);
CREATE INDEX IF NOT EXISTS idx_customers_score ON customers(engagement_score DESC);
CREATE INDEX IF NOT EXISTS idx_customers_shopify_id ON customers(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_novahair ON customers(novahair_buyer);

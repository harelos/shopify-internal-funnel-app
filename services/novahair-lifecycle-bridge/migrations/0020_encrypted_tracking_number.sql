-- The raw carrier number is required only by the Worker to reconcile CJPacket.
-- It remains encrypted at rest; logs, analytics and public endpoints use the hash only.
ALTER TABLE lifecycle_orders ADD COLUMN tracking_number_encrypted TEXT;

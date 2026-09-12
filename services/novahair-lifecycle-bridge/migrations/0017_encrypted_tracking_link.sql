-- Carrier tracking links can contain opaque carrier tokens. Retain only an
-- application-encrypted copy so outbound emails can link to the current
-- shipment without exposing the raw URL to logs, analytics, or Resend.
ALTER TABLE lifecycle_orders ADD COLUMN tracking_url_encrypted TEXT;

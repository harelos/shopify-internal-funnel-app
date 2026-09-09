-- Preserve the purchased product set so cross-sell never recommends an item already bought.
ALTER TABLE lifecycle_orders ADD COLUMN purchased_product_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE lifecycle_orders ADD COLUMN purchased_product_handles_json TEXT NOT NULL DEFAULT '[]';

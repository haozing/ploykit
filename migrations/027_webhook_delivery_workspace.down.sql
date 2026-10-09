
ALTER TABLE webhook_delivery DROP CONSTRAINT webhook_delivery_workspace_id_fkey;
DROP INDEX IF EXISTS idx_webhook_delivery_ws;
ALTER TABLE webhook_delivery DROP COLUMN workspace_id;

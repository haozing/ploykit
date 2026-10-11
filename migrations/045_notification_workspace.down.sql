DROP INDEX IF EXISTS idx_notification_ws_inbox;
ALTER TABLE notification DROP COLUMN IF EXISTS workspace_id;

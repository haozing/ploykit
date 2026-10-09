
DROP INDEX IF EXISTS uq_notification_month;
ALTER TABLE notification DROP COLUMN IF EXISTS once_per_month;

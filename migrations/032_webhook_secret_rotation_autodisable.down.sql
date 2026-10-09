

ALTER TABLE webhook_subscription
  DROP COLUMN old_secret,
  DROP COLUMN old_secret_expires_at,
  DROP COLUMN first_failure_at;

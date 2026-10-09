

ALTER TABLE webhook_subscription
  ADD COLUMN old_secret text,
  ADD COLUMN old_secret_expires_at timestamptz,
  ADD COLUMN first_failure_at timestamptz;

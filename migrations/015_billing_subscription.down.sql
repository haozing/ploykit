DROP INDEX idx_workspace_plan_expiry;
ALTER TABLE workspace
  DROP COLUMN plan_expires_at, DROP COLUMN subscription_ref;

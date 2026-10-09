

ALTER TABLE workspace
  ADD COLUMN plan_expires_at timestamptz,
  ADD COLUMN subscription_ref text;
CREATE INDEX idx_workspace_plan_expiry ON workspace (plan_expires_at)
  WHERE plan_expires_at IS NOT NULL;

-- LC-4 user self-serve cancel: workspace.cancel_requested_at marks a
-- user-requested subscription cancel that has not resolved locally yet —
-- either the channel stops at period end (plan collected by the expiry
-- sweeper) or the channel has no canceller API and an operator must finish
-- it in the channel console (admin cancel-requests queue).
ALTER TABLE workspace
  ADD COLUMN cancel_requested_at timestamptz;

-- Operator-queue listing scans WHERE cancel_requested_at IS NOT NULL; partial
-- index keeps that scan off the full workspace table (same shape as
-- idx_workspace_plan_expiry, migration 015).
CREATE INDEX idx_workspace_cancel_requested ON workspace (cancel_requested_at)
  WHERE cancel_requested_at IS NOT NULL;



ALTER TABLE task ADD COLUMN IF NOT EXISTS removed_at timestamptz NULL;
ALTER TABLE task ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL;
ALTER TABLE task ADD COLUMN IF NOT EXISTS idempotency_key text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_ws_idem_key
  ON task (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND removed_at IS NULL;

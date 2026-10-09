

ALTER TABLE webhook_delivery ADD COLUMN workspace_id uuid;

UPDATE webhook_delivery d SET workspace_id = s.workspace_id
  FROM webhook_subscription s WHERE s.id = d.subscription_id;

DELETE FROM webhook_delivery WHERE subscription_id IS NULL;

ALTER TABLE webhook_delivery
  ALTER COLUMN workspace_id SET NOT NULL,
  ADD CONSTRAINT webhook_delivery_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE;

CREATE INDEX idx_webhook_delivery_ws ON webhook_delivery (workspace_id, created_at DESC);

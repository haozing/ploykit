-- F8 (orkome): notifications can carry an optional workspace dimension.
-- Nullable on purpose: user-global notifications (the framework bell) stay NULL;
-- products with workspace-scoped inboxes populate it and filter by it, instead of
-- maintaining a parallel notification table with a second column family.

ALTER TABLE notification
    ADD COLUMN workspace_id uuid REFERENCES workspace(id) ON DELETE CASCADE;

CREATE INDEX idx_notification_ws_inbox
    ON notification (workspace_id, user_id, read_at, created_at DESC)
    WHERE workspace_id IS NOT NULL AND archived_at IS NULL;

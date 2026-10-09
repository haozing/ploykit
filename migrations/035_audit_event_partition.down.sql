

LOCK TABLE audit_event IN ACCESS EXCLUSIVE MODE;

CREATE TABLE audit_event_plain (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id   uuid,
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'pat', 'system')),
  actor_id       text,
  actor_snapshot jsonb NOT NULL DEFAULT '{}',
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text,
  request_id     text,
  metadata       jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO audit_event_plain
  (id, workspace_id, actor_type, actor_id, actor_snapshot, action, resource_type, resource_id, request_id, metadata, created_at)
SELECT id, workspace_id, actor_type, actor_id, actor_snapshot, action, resource_type, resource_id, request_id, metadata, created_at
  FROM audit_event;

ALTER TABLE audit_event RENAME TO audit_event_old035;
ALTER TABLE audit_event_plain RENAME TO audit_event;
DROP TABLE audit_event_old035; 

ALTER TABLE audit_event ADD CONSTRAINT audit_event_pkey PRIMARY KEY (id);
CREATE INDEX idx_audit_ws_time ON audit_event (workspace_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_event (action, created_at DESC);
CREATE INDEX idx_audit_created ON audit_event (created_at DESC);
CREATE INDEX idx_audit_actor_time ON audit_event (actor_id, created_at DESC);

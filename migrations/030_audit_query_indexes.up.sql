

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_event (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_event (actor_id, created_at DESC);

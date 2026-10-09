

CREATE TABLE audit_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE INDEX idx_audit_ws_time ON audit_event (workspace_id, created_at DESC);
CREATE INDEX idx_audit_action ON audit_event (action, created_at DESC);

CREATE TABLE plan (
  code    text PRIMARY KEY,
  name    text NOT NULL,
  limits  jsonb NOT NULL DEFAULT '{}',
  sort_no int NOT NULL DEFAULT 0
);

CREATE TABLE quota_counter (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  period       text NOT NULL,
  counter_key  text NOT NULL,
  used         bigint NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period, counter_key)
);

CREATE TABLE quota_grant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  period       text NOT NULL,
  counter_key  text NOT NULL,
  amount       int NOT NULL CHECK (amount > 0),
  reason       text NOT NULL,
  ref_id       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_quota_grant_dedup ON quota_grant (workspace_id, counter_key, reason, ref_id) WHERE ref_id IS NOT NULL;

CREATE TABLE subscription_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  from_plan     text NOT NULL,
  to_plan       text NOT NULL,
  reason        text,
  actor         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

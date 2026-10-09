

CREATE TABLE workspace (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,38}[a-z0-9]$'),
  name       text NOT NULL CHECK (name <> ''),
  plan_code  text NOT NULL DEFAULT 'free',
  created_by uuid NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug)
);

CREATE TABLE member (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES "user"(id),
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_by   uuid REFERENCES "user"(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  removed_at   timestamptz
);
CREATE UNIQUE INDEX uq_member_active ON member (workspace_id, user_id) WHERE removed_at IS NULL;
CREATE INDEX idx_member_user ON member (user_id) WHERE removed_at IS NULL;



CREATE TABLE workspace_invitation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(email)),
  role         text NOT NULL CHECK (role IN ('admin', 'member')),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  expires_at   timestamptz NOT NULL,
  created_by   uuid NOT NULL REFERENCES "user"(id),
  accepted_by  uuid REFERENCES "user"(id),
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invitation_email ON workspace_invitation (email) WHERE status = 'pending';
CREATE INDEX idx_invitation_ws ON workspace_invitation (workspace_id, status);

CREATE TABLE workspace_share_link (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  code_hash    text NOT NULL UNIQUE,
  code_prefix  text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin', 'member')),
  max_uses     int NOT NULL CHECK (max_uses > 0),
  uses         int NOT NULL DEFAULT 0 CHECK (uses <= max_uses),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_by   uuid NOT NULL REFERENCES "user"(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);



DROP TABLE IF EXISTS workspace_role_permission;

CREATE TABLE workspace_role (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  role         text NOT NULL,
  perms        jsonb NOT NULL DEFAULT '[]',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, role)
);

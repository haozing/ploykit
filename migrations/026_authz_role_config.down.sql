
DROP TABLE IF EXISTS workspace_role;

CREATE TABLE workspace_role_permission (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  role         text NOT NULL,
  permission   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, role, permission)
);

CREATE INDEX idx_wsrp_role ON workspace_role_permission (workspace_id, role);

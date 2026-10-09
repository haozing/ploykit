
CREATE TABLE IF NOT EXISTS task (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  number       bigint NOT NULL DEFAULT 1,
  title        text NOT NULL,
  done         boolean NOT NULL DEFAULT false,
  created_by   uuid REFERENCES "user"(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, number)
);

-- Product migration 1005: video project table (agent video studio domain).
-- Product-owned table (1xxx); the framework table-name ruling only constrains 001-999.
CREATE TABLE video_project (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  title text NOT NULL,
  script text NOT NULL DEFAULT '',
  ir jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by text NOT NULL DEFAULT '', updated_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_video_project_ws ON video_project (workspace_id, updated_at DESC);

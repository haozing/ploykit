-- Product migration 1006: render job rows (one per video_render submission).
CREATE TABLE video_render (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES video_project (id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,               -- denormalized: quota/audit/list without join
  status text NOT NULL,                     -- queued|running|succeeded|failed|interrupted
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ir_snapshot jsonb NOT NULL,
  output_key text NOT NULL DEFAULT '', error text NOT NULL DEFAULT '',
  frames_done integer NOT NULL DEFAULT 0, frames_total integer NOT NULL DEFAULT 0,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX idx_video_render_project ON video_render (project_id, created_at DESC);
CREATE INDEX idx_video_render_ws_status ON video_render (workspace_id, status);

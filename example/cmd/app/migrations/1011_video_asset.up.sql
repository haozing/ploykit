-- Product migration 1011: asset registry for the video studio (F-AUTH-01 /
-- F-TRA-01). Every uploaded asset gets one row: the row is the ownership
-- credential used by the file handler (workspace membership alone no longer
-- grants read on any key — the key must be registered), and the reference
-- list for project deletion (rows cascade with the project; the storage
-- objects are deleted by the service after the DB commit).
--
-- Render outputs are deliberately NOT registered here: the video_render row
-- (output_key) is itself the ownership credential for render products.
CREATE TABLE video_asset (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES video_project (id) ON DELETE CASCADE,
  key text NOT NULL UNIQUE,          -- storagex key (content-addressed, globally unique)
  kind text NOT NULL,                -- image|audio
  bytes integer NOT NULL DEFAULT 0,
  sha256 text NOT NULL DEFAULT '',   -- content hash (reproducibility evidence)
  content_type text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_video_asset_project ON video_asset (project_id);

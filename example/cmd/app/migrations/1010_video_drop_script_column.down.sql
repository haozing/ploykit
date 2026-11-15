-- Down for 1010: restore the script column (best-effort backfill from IR).
ALTER TABLE video_project
  ADD COLUMN IF NOT EXISTS script text NOT NULL DEFAULT '';
UPDATE video_project
  SET script = COALESCE(ir->>'script', '');

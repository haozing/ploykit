-- Down for 1009: drop the idempotency/accounting additions.
DROP INDEX IF EXISTS uq_video_render_submission;
ALTER TABLE video_render
  DROP COLUMN IF EXISTS released_at,
  DROP COLUMN IF EXISTS quota_period,
  DROP COLUMN IF EXISTS submission_key;

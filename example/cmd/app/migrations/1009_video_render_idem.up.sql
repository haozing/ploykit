-- Product migration 1009: render submission idempotency + quota accounting
-- columns (delivery-audit-video-studio §4 P2/P3/P7).
--
-- submission_key: client-supplied idempotency key (REST Idempotency-Key /
-- MCP request_id). NULL = legacy rows and callers that opted out. The
-- unique index makes duplicate submissions impossible at the storage layer:
-- the service maps the unique violation to a 200-with-existing-row.
ALTER TABLE video_render
  ADD COLUMN IF NOT EXISTS submission_key text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_video_render_submission
  ON video_render (workspace_id, submission_key)
  WHERE submission_key <> '';

-- quota_period: the billing period the charge landed in, fixed at
-- submission. Terminal-failure releases target THIS period (releasing
-- "now" across a month boundary decrements the wrong counter or matches
-- zero rows silently).
ALTER TABLE video_render
  ADD COLUMN IF NOT EXISTS quota_period text NOT NULL DEFAULT '';

-- released_at: single-shot release guard. The worker writes it in the same
-- statement that flips the row terminal; a retry that observes it set must
-- not release a second time (quota.Release is a plain counter decrement).
ALTER TABLE video_render
  ADD COLUMN IF NOT EXISTS released_at timestamptz;



ALTER TABLE quota_grant ADD COLUMN period_cycle text
  CHECK (period_cycle IS NULL OR period_cycle IN ('monthly'));

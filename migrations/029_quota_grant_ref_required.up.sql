

DELETE FROM quota_grant WHERE ref_id IS NULL;
DROP INDEX IF EXISTS uq_quota_grant_dedup;
CREATE UNIQUE INDEX uq_quota_grant_dedup ON quota_grant (workspace_id, counter_key, reason, ref_id);

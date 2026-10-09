-- Migrate:No-Transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS pgm_probe_users_id_idx ON pgm_probe_users (id);

ALTER TABLE session DROP COLUMN IF EXISTS mfa_confirmed_at;
DROP TABLE IF EXISTS user_mfa_backup_code;
DROP TABLE IF EXISTS user_mfa;

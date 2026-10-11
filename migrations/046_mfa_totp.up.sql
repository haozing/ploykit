-- ADR 0013 batch 2 (G1): TOTP + backup-code MFA. Secrets are stored sealed
-- (sealx envelope, PLOYKIT_SEAL_KEY) — the framework hard constraint for
-- tenant/user credentials; with no key configured, enrollment writes are
-- rejected upstream (E_SEAL_KEY_MISSING).
CREATE TABLE user_mfa (
  user_id       uuid PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  secret_sealed text NOT NULL,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Backup codes are single-use: consumed_at marks use. Codes are stored as
-- hashes (128-bit random material, sha256-hexed) — plaintext is shown once
-- at generation and never persisted.
CREATE TABLE user_mfa_backup_code (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  code_hash   text NOT NULL UNIQUE,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_mfa_backup_pending ON user_mfa_backup_code (user_id) WHERE consumed_at IS NULL;

-- The second freshness fact on the session, symmetric to
-- password_confirmed_at (044): RequireRecentMFA / authorization's
-- password_and_mfa recent-auth rule read it through the same columns webx
-- stamps (ADR 0011 data-source rule).
ALTER TABLE session ADD COLUMN mfa_confirmed_at timestamptz;

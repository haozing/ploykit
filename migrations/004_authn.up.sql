

CREATE TABLE auth_challenge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL CHECK (email = lower(email)),
  kind        text NOT NULL CHECK (kind IN ('login_code', 'reset_link', 'verify_link')),
  secret_hash text NOT NULL,
  attempts    int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_challenge_pending ON auth_challenge (email, kind, created_at DESC) WHERE consumed_at IS NULL;

CREATE TABLE session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,
  ip_hash             text,
  user_agent          text,
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (absolute_expires_at >= expires_at)
);
CREATE INDEX idx_session_user ON session (user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempt (
  ip_hash    text NOT NULL,
  identity   text NOT NULL,
  success    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempt_window ON login_attempt (ip_hash, identity, created_at);

CREATE TABLE personal_access_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         text NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  prefix       text NOT NULL,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pat_user ON personal_access_token (user_id) WHERE revoked_at IS NULL;

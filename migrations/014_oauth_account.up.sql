

CREATE TABLE oauth_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL CHECK (provider IN ('github', 'google')),
  subject       text NOT NULL,
  user_id       uuid NOT NULL REFERENCES "user"(id),
  email_at_link text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject)
);
CREATE INDEX idx_oauth_account_user ON oauth_account (user_id);

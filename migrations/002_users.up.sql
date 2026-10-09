

CREATE TABLE "user" (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL CHECK (email = lower(email) AND email <> ''),
  display_name      text NOT NULL DEFAULT '',
  avatar_url        text,
  password_hash     text CHECK (password_hash IS NULL OR password_hash LIKE '$argon2id$%'),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  email_verified_at timestamptz,
  tokens_valid_after timestamptz NOT NULL DEFAULT '-infinity',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_user_email ON "user" (email);

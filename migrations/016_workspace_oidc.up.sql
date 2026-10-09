

CREATE TABLE workspace_oidc_provider (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspace(id) ON DELETE CASCADE,
  issuer_url   text NOT NULL,
  client_id    text NOT NULL,
  client_secret text NOT NULL,
  scopes       text NOT NULL DEFAULT 'openid email profile',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE oauth_account DROP CONSTRAINT oauth_account_provider_check;
ALTER TABLE oauth_account ADD CONSTRAINT oauth_account_provider_check
  CHECK (provider IN ('github', 'google') OR provider LIKE 'oidc\_fed:%');

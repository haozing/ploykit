

DELETE FROM oauth_account WHERE provider LIKE 'oidc\_fed:%';
ALTER TABLE oauth_account DROP CONSTRAINT oauth_account_provider_check;
ALTER TABLE oauth_account ADD CONSTRAINT oauth_account_provider_check
  CHECK (provider IN ('github', 'google'));
DROP TABLE workspace_oidc_provider;

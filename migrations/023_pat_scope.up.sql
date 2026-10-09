

ALTER TABLE personal_access_token
  ADD COLUMN scope_workspaces  text[],
  ADD COLUMN scope_permissions text[];

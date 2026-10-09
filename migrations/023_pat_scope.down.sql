
ALTER TABLE personal_access_token
  DROP COLUMN IF EXISTS scope_workspaces,
  DROP COLUMN IF EXISTS scope_permissions;

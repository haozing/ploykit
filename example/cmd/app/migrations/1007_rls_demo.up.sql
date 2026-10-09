

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.workspace_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.user_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
ALTER TABLE task FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_task_tenant_isolation ON task;
CREATE POLICY p_task_tenant_isolation ON task
  USING      (workspace_id = (select app.workspace_id()))
  WITH CHECK (workspace_id = (select app.workspace_id()));

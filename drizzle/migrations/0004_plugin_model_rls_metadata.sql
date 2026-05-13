-- Migration: Plugin Dynamic Model RLS Metadata
-- Date: 2026-05-07
--
-- Adds reconcile metadata for dynamically-created plugin model tables and
-- re-applies FORCE RLS for high-risk user data tables.

ALTER TABLE "plugin_models" ADD COLUMN IF NOT EXISTS "schema_hash" text;
ALTER TABLE "plugin_models" ADD COLUMN IF NOT EXISTS "ddl" text;
ALTER TABLE "plugin_models" ADD COLUMN IF NOT EXISTS "rls_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "plugin_models" ADD COLUMN IF NOT EXISTS "created_by_version" text;

UPDATE "plugin_models"
SET
  "schema_hash" = COALESCE("schema_hash", md5(COALESCE("definition"::text, '{}') || ':' || "table_name")),
  "ddl" = COALESCE("ddl", ''),
  "created_by_version" = COALESCE("created_by_version", "version");

DO $$
DECLARE
  model_record record;
  policy_name text;
BEGIN
  FOR model_record IN SELECT "table_name" FROM "plugin_models"
  LOOP
    IF to_regclass(format('public.%I', model_record."table_name")) IS NULL THEN
      CONTINUE;
    END IF;

    policy_name := model_record."table_name" || '_user_isolation';
    IF length(policy_name) > 63 THEN
      policy_name := 'rls_' || substr(md5(policy_name), 1, 12);
    END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', model_record."table_name");
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', model_record."table_name");
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', policy_name, model_record."table_name");
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_id = current_app_user_id() OR current_app_user_id() = ''system'') WITH CHECK (user_id = current_app_user_id() OR current_app_user_id() = ''system'')',
      policy_name,
      model_record."table_name"
    );

    UPDATE "plugin_models"
    SET "rls_enabled" = true
    WHERE "table_name" = model_record."table_name";
  END LOOP;
END $$;

ALTER TABLE "plugin_models" ALTER COLUMN "schema_hash" SET NOT NULL;
ALTER TABLE "plugin_models" ALTER COLUMN "ddl" SET NOT NULL;
ALTER TABLE "plugin_models" ALTER COLUMN "rls_enabled" SET DEFAULT true;
ALTER TABLE "plugin_models" ALTER COLUMN "created_by_version" SET NOT NULL;

ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_entitlements" FORCE ROW LEVEL SECURITY;
ALTER TABLE "usage_history" FORCE ROW LEVEL SECURITY;
ALTER TABLE "plugin_settings" FORCE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;
ALTER TABLE "credit_logs" FORCE ROW LEVEL SECURITY;

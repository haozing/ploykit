-- Migration: Plugin public content runtime
-- Date: 2026-05-19
--
-- Adds explicit plugin storage scopes, public plugin media, and cache-aware
-- route runtime primitives used by CMS-like plugins.

ALTER TABLE "plugin_records" ADD COLUMN IF NOT EXISTS "scope_type" text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "plugin_records" ADD COLUMN IF NOT EXISTS "scope_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE "plugin_records"
SET
  "scope_type" = 'user',
  "scope_id" = coalesce("user_id", '')
WHERE "scope_id" = '';
--> statement-breakpoint
DROP INDEX IF EXISTS "plugin_records_active_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "plugin_records_plugin_collection_record_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_records_plugin_collection_record_idx"
  ON "plugin_records" ("plugin_id", "collection_name", "scope_type", "scope_id", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_active_idx"
  ON "plugin_records" ("plugin_id", "collection_name", "scope_type", "scope_id", "deleted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_scope_idx"
  ON "plugin_records" ("plugin_id", "collection_name", "scope_type", "scope_id");
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_records_user_plugin_isolation ON "plugin_records";
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_records_scope_plugin_isolation ON "plugin_records";
--> statement-breakpoint
CREATE POLICY plugin_records_scope_plugin_isolation ON "plugin_records"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      (scope_type = 'user' AND scope_id = current_app_user_id())
      OR (
        scope_type = 'workspace'
        AND EXISTS (
          SELECT 1
          FROM "workspace_members"
          WHERE "workspace_members"."workspace_id" = "plugin_records"."scope_id"
            AND "workspace_members"."user_id" = current_app_user_id()
            AND "workspace_members"."status" = 'active'
        )
      )
      OR scope_type IN ('plugin', 'product')
    )
  )
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      (scope_type = 'user' AND scope_id = current_app_user_id())
      OR (
        scope_type = 'workspace'
        AND EXISTS (
          SELECT 1
          FROM "workspace_members"
          WHERE "workspace_members"."workspace_id" = "plugin_records"."scope_id"
            AND "workspace_members"."user_id" = current_app_user_id()
            AND "workspace_members"."status" = 'active'
        )
      )
      OR scope_type IN ('plugin', 'product')
    )
  )
);
--> statement-breakpoint
ALTER TABLE "plugin_record_unique_keys" ADD COLUMN IF NOT EXISTS "scope_type" text NOT NULL DEFAULT 'user';
--> statement-breakpoint
ALTER TABLE "plugin_record_unique_keys" ADD COLUMN IF NOT EXISTS "scope_id" text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE "plugin_record_unique_keys"
SET
  "scope_type" = 'user',
  "scope_id" = coalesce("user_id", '')
WHERE "scope_id" = '';
--> statement-breakpoint
DROP INDEX IF EXISTS "plugin_record_unique_keys_active_key_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_record_unique_keys_active_key_idx"
  ON "plugin_record_unique_keys" ("plugin_id", "collection_name", "scope_type", "scope_id", "unique_key")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_record_unique_keys_user_plugin_isolation ON "plugin_record_unique_keys";
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_record_unique_keys_scope_plugin_isolation ON "plugin_record_unique_keys";
--> statement-breakpoint
CREATE POLICY plugin_record_unique_keys_scope_plugin_isolation ON "plugin_record_unique_keys"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      (scope_type = 'user' AND scope_id = current_app_user_id())
      OR (
        scope_type = 'workspace'
        AND EXISTS (
          SELECT 1
          FROM "workspace_members"
          WHERE "workspace_members"."workspace_id" = "plugin_record_unique_keys"."scope_id"
            AND "workspace_members"."user_id" = current_app_user_id()
            AND "workspace_members"."status" = 'active'
        )
      )
      OR scope_type IN ('plugin', 'product')
    )
  )
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      (scope_type = 'user' AND scope_id = current_app_user_id())
      OR (
        scope_type = 'workspace'
        AND EXISTS (
          SELECT 1
          FROM "workspace_members"
          WHERE "workspace_members"."workspace_id" = "plugin_record_unique_keys"."scope_id"
            AND "workspace_members"."user_id" = current_app_user_id()
            AND "workspace_members"."status" = 'active'
        )
      )
      OR scope_type IN ('plugin', 'product')
    )
  )
);
--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';
--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN IF NOT EXISTS "public_id" text;
--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN IF NOT EXISTS "public_file_name" text;
--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN IF NOT EXISTS "public_cache_control" text;
--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN IF NOT EXISTS "content_disposition" text NOT NULL DEFAULT 'attachment';
--> statement-breakpoint
ALTER TABLE "plugin_files" ADD COLUMN IF NOT EXISTS "published_at" timestamptz;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_files_public_idx"
  ON "plugin_files" ("plugin_id", "public_id")
  WHERE "public_id" IS NOT NULL AND "deleted_at" IS NULL;

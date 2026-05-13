-- Migration: Plugin Storage Runtime
-- Date: 2026-05-08
--
-- Adds generic plugin storage tables for ctx.storage.collection().
-- Ordinary plugin access is scoped by plugin_id + user_id; system context can reconcile.

CREATE OR REPLACE FUNCTION current_app_plugin_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_plugin_id', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_collections" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "name" text NOT NULL,
  "schema_json" jsonb NOT NULL,
  "schema_hash" text NOT NULL,
  "indexes_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_collections_plugin_name_idx"
  ON "plugin_collections" ("plugin_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_collections_plugin_idx"
  ON "plugin_collections" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_collections_schema_hash_idx"
  ON "plugin_collections" ("schema_hash");
--> statement-breakpoint
ALTER TABLE "plugin_collections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_collections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_collections_plugin_isolation ON "plugin_collections";
--> statement-breakpoint
CREATE POLICY plugin_collections_plugin_isolation ON "plugin_collections"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR plugin_id = current_app_plugin_id()
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR plugin_id = current_app_plugin_id()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_records" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "collection_name" text NOT NULL,
  "user_id" text,
  "data" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_records_plugin_collection_record_idx"
  ON "plugin_records" ("plugin_id", "collection_name", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_plugin_collection_idx"
  ON "plugin_records" ("plugin_id", "collection_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_user_idx"
  ON "plugin_records" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_active_idx"
  ON "plugin_records" ("plugin_id", "collection_name", "user_id", "deleted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_created_at_idx"
  ON "plugin_records" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_data_gin_idx"
  ON "plugin_records" USING gin ("data");
--> statement-breakpoint
ALTER TABLE "plugin_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_records_user_plugin_isolation ON "plugin_records";
--> statement-breakpoint
CREATE POLICY plugin_records_user_plugin_isolation ON "plugin_records"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND user_id = current_app_user_id()
  )
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND user_id = current_app_user_id()
  )
);

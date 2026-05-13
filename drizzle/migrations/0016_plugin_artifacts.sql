-- Migration: Generic Plugin Artifacts
-- Date: 2026-05-11
--
-- Adds a project/workspace-scoped text artifact store for plugin-managed
-- content sources. The host owns isolation, metadata, versioning, and paths;
-- plugins define business meaning in metadata instead of using local fs.

CREATE TABLE IF NOT EXISTS "plugin_artifacts" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "workspace_id" text NOT NULL,
  "path" text NOT NULL,
  "content_type" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "version" integer NOT NULL DEFAULT 1,
  "size" integer NOT NULL DEFAULT 0,
  "hash" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_artifacts_active_path_idx"
  ON "plugin_artifacts" ("plugin_id", "user_id", "workspace_id", "path")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_workspace_idx"
  ON "plugin_artifacts" ("plugin_id", "user_id", "workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_plugin_idx"
  ON "plugin_artifacts" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_user_idx"
  ON "plugin_artifacts" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_hash_idx"
  ON "plugin_artifacts" ("hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_updated_at_idx"
  ON "plugin_artifacts" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_metadata_gin_idx"
  ON "plugin_artifacts" USING gin ("metadata");
--> statement-breakpoint
ALTER TABLE "plugin_artifacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_artifacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_artifacts_user_plugin_isolation ON "plugin_artifacts";
--> statement-breakpoint
CREATE POLICY plugin_artifacts_user_plugin_isolation ON "plugin_artifacts"
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

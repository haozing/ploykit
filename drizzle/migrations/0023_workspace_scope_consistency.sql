-- Migration: Workspace Scope Consistency
-- Date: 2026-05-12
--
-- Workspace-scoped plugin artifacts are shared by workspace role, while
-- user-scoped artifacts remain isolated by the creating user.

DROP INDEX IF EXISTS "plugin_artifacts_active_workspace_path_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "plugin_artifacts_active_path_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_artifacts_active_workspace_path_idx"
  ON "plugin_artifacts" ("plugin_id", "scope_type", "scope_id", "path")
  WHERE "deleted_at" IS NULL AND "scope_type" = 'workspace';
--> statement-breakpoint
DROP INDEX IF EXISTS "plugin_artifacts_active_user_path_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_artifacts_active_user_path_idx"
  ON "plugin_artifacts" ("plugin_id", "user_id", "scope_type", "scope_id", "path")
  WHERE "deleted_at" IS NULL AND "scope_type" = 'user';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_workspace_scope_idx"
  ON "plugin_artifacts" ("plugin_id", "scope_type", "scope_id");

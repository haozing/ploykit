-- Migration: Plugin Files 2.0
-- Date: 2026-05-11
--
-- Development-stage clean refactor:
-- - plugin files are first-class scoped assets
-- - plugin file APIs must bind files to user/workspace scope, lifecycle, optional run, and audit/usage refs
-- - the generic platform files table remains for host user file management

CREATE TABLE IF NOT EXISTS "plugin_files" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "file_name" text NOT NULL,
  "content_type" text NOT NULL,
  "size" integer NOT NULL DEFAULT 0,
  "hash" text,
  "purpose" text NOT NULL DEFAULT 'source',
  "status" text NOT NULL DEFAULT 'pending_upload',
  "storage_key" text NOT NULL,
  "storage_provider" text NOT NULL DEFAULT 'local',
  "run_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" timestamptz,
  "uploaded_at" timestamptz,
  "archived_at" timestamptz,
  "deleted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_files_plugin_scope_idx" ON "plugin_files" ("plugin_id", "scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_files_plugin_status_idx" ON "plugin_files" ("plugin_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_files_owner_idx" ON "plugin_files" ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_files_run_idx" ON "plugin_files" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_files_expires_idx" ON "plugin_files" ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_files_storage_key_idx" ON "plugin_files" ("storage_key");

-- Migration: Plugin Platform Boundary Capabilities
-- Date: 2026-05-11
--
-- Development-stage clean refactor:
-- - artifacts/RAG use generic resource scope columns instead of workspace_id
-- - host-owned workspaces, runs, connectors, API keys, and rate-limit buckets
--   are added as platform boundary primitives.

DROP TABLE IF EXISTS "plugin_rag_chunks";
--> statement-breakpoint
DROP TABLE IF EXISTS "plugin_artifacts";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspaces" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text,
  "owner_user_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspaces_slug_idx" ON "workspaces" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_owner_idx" ON "workspaces" ("owner_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspaces_status_idx" ON "workspaces" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_members" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "email" text,
  "joined_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_members_workspace_user_idx" ON "workspace_members" ("workspace_id", "user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_workspace_idx" ON "workspace_members" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_user_idx" ON "workspace_members" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_members_role_idx" ON "workspace_members" ("role");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workspace_invitations" (
  "id" text PRIMARY KEY,
  "workspace_id" text NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "invited_by_user_id" text NOT NULL,
  "expires_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_workspace_email_idx" ON "workspace_invitations" ("workspace_id", "email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invitations_status_idx" ON "workspace_invitations" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_artifacts" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
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
  ON "plugin_artifacts" ("plugin_id", "user_id", "scope_type", "scope_id", "path")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_scope_idx"
  ON "plugin_artifacts" ("plugin_id", "user_id", "scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_plugin_idx" ON "plugin_artifacts" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_user_idx" ON "plugin_artifacts" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_hash_idx" ON "plugin_artifacts" ("hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_updated_at_idx" ON "plugin_artifacts" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_artifacts_metadata_gin_idx" ON "plugin_artifacts" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_rag_chunks" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_path" text,
  "source_hash" text NOT NULL,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_rag_chunks_active_chunk_idx"
  ON "plugin_rag_chunks" ("plugin_id", "user_id", "scope_type", "scope_id", "source_id", "chunk_index")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_scope_idx"
  ON "plugin_rag_chunks" ("plugin_id", "user_id", "scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_source_idx"
  ON "plugin_rag_chunks" ("plugin_id", "user_id", "scope_type", "scope_id", "source_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_path_idx" ON "plugin_rag_chunks" ("source_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_source_hash_idx" ON "plugin_rag_chunks" ("source_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_content_hash_idx" ON "plugin_rag_chunks" ("content_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rag_chunks_metadata_gin_idx" ON "plugin_rag_chunks" USING gin ("metadata");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_runs" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "title" text NOT NULL,
  "status" text NOT NULL,
  "progress" integer NOT NULL DEFAULT 0,
  "idempotency_key" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" jsonb,
  "cancel_reason" text,
  "cancel_requested_at" timestamptz,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_runs_plugin_scope_idx" ON "plugin_runs" ("plugin_id", "scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_runs_plugin_status_idx" ON "plugin_runs" ("plugin_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_runs_idempotency_idx" ON "plugin_runs" ("plugin_id", "user_id", "idempotency_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_run_steps" (
  "id" text PRIMARY KEY,
  "run_id" text NOT NULL,
  "name" text NOT NULL,
  "status" text NOT NULL,
  "progress" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" jsonb,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_run_steps_run_idx" ON "plugin_run_steps" ("run_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_run_logs" (
  "id" text PRIMARY KEY,
  "run_id" text NOT NULL,
  "level" text NOT NULL,
  "message" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_run_logs_run_idx" ON "plugin_run_logs" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_run_logs_created_at_idx" ON "plugin_run_logs" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_run_results" (
  "id" text PRIMARY KEY,
  "run_id" text NOT NULL,
  "type" text NOT NULL,
  "ref" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_run_results_run_idx" ON "plugin_run_results" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_run_results_type_idx" ON "plugin_run_results" ("type");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_connectors" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "scope_type" text,
  "scope_id" text,
  "base_url" text NOT NULL,
  "auth_type" text NOT NULL DEFAULT 'none',
  "secret_name" text,
  "status" text NOT NULL DEFAULT 'active',
  "timeout_ms" integer NOT NULL DEFAULT 30000,
  "retry_count" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_connectors_plugin_name_idx" ON "plugin_connectors" ("plugin_id", "name", "scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_connectors_plugin_idx" ON "plugin_connectors" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_connectors_scope_idx" ON "plugin_connectors" ("scope_type", "scope_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_connector_call_logs" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "connector_name" text NOT NULL,
  "user_id" text,
  "run_id" text,
  "method" text NOT NULL,
  "url" text NOT NULL,
  "status" integer,
  "ok" text NOT NULL DEFAULT 'false',
  "duration_ms" integer,
  "meter" text,
  "credits_consumed" integer NOT NULL DEFAULT 0,
  "request_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "response_metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_connector_call_logs_plugin_connector_idx" ON "plugin_connector_call_logs" ("plugin_id", "connector_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_connector_call_logs_run_idx" ON "plugin_connector_call_logs" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_connector_call_logs_created_at_idx" ON "plugin_connector_call_logs" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_api_keys" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at" timestamptz,
  "revoked_at" timestamptz,
  "last_used_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_api_keys_hash_idx" ON "plugin_api_keys" ("key_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_api_keys_plugin_scope_idx" ON "plugin_api_keys" ("plugin_id", "scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_api_keys_prefix_idx" ON "plugin_api_keys" ("prefix");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_rate_limit_buckets" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "bucket" text NOT NULL,
  "window_key" text NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "limit" integer NOT NULL,
  "reset_at" timestamptz NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_rate_limit_buckets_bucket_window_idx" ON "plugin_rate_limit_buckets" ("plugin_id", "bucket", "window_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_rate_limit_buckets_reset_idx" ON "plugin_rate_limit_buckets" ("reset_at");

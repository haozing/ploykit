-- Migration: Plugin Host Service Capabilities
-- Date: 2026-05-15
--
-- Adds generic resource bindings plus service connection call logs for host-owned
-- plugin service integration.

CREATE TABLE IF NOT EXISTS "plugin_resource_bindings" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "display_name" text,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_resource_bindings_unique_resource"
  ON "plugin_resource_bindings" ("plugin_id", "scope_type", "scope_id", "resource_type", "resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_resource_bindings_scope_idx"
  ON "plugin_resource_bindings" ("plugin_id", "scope_type", "scope_id", "resource_type", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_resource_bindings_status_idx"
  ON "plugin_resource_bindings" ("plugin_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_service_connection_logs" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "service_name" text NOT NULL,
  "user_id" text,
  "workspace_id" text,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "path_template" text,
  "status" integer,
  "ok" text NOT NULL DEFAULT 'false',
  "duration_ms" integer,
  "request_id" text,
  "error_code" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_service_connection_logs_plugin_service_idx"
  ON "plugin_service_connection_logs" ("plugin_id", "service_name", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_service_connection_logs_request_idx"
  ON "plugin_service_connection_logs" ("request_id");

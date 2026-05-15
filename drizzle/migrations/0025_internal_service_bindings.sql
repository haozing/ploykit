-- Migration: Internal Service Bindings
-- Date: 2026-05-15
--
-- Adds host-owned internal service binding configuration. Plugins declare
-- services in plugin.ts; only the host stores base URLs, secret refs, and
-- actor-claims policy here.

ALTER TABLE "plugin_resource_bindings"
  ADD COLUMN IF NOT EXISTS "cardinality" text NOT NULL DEFAULT 'many';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_resource_bindings_one_active_resource"
  ON "plugin_resource_bindings" ("plugin_id", "scope_type", "scope_id", "resource_type")
  WHERE "status" = 'active' AND "cardinality" = 'one';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_internal_service_bindings" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "service_name" text NOT NULL,
  "scope_type" text NOT NULL DEFAULT 'global',
  "scope_id" text,
  "environment" text,
  "base_url" text NOT NULL,
  "auth_type" text NOT NULL DEFAULT 'none',
  "auth_secret_ref" text,
  "auth_username_ref" text,
  "auth_password_ref" text,
  "auth_header_name" text,
  "actor_claims_enabled" boolean NOT NULL DEFAULT false,
  "actor_claims_type" text NOT NULL DEFAULT 'hmac',
  "actor_claims_audience" text,
  "actor_claims_secret_ref" text,
  "actor_claims_previous_secret_ref" text,
  "actor_claims_key_id" text,
  "actor_claims_previous_key_id" text,
  "actor_claims_ttl_seconds" integer NOT NULL DEFAULT 60,
  "timeout_ms" integer NOT NULL DEFAULT 30000,
  "retry_attempts" integer NOT NULL DEFAULT 0,
  "retry_backoff_ms" integer NOT NULL DEFAULT 250,
  "max_response_bytes" integer NOT NULL DEFAULT 10485760,
  "health_path" text,
  "health_method" text NOT NULL DEFAULT 'GET',
  "health_expected_status" integer NOT NULL DEFAULT 200,
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_checked_at" timestamptz,
  "last_check_status" text,
  "last_check_error" text,
  "created_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_internal_service_bindings_global_default_idx"
  ON "plugin_internal_service_bindings" ("plugin_id", "service_name")
  WHERE "scope_type" = 'global' AND "environment" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_internal_service_bindings_global_environment_idx"
  ON "plugin_internal_service_bindings" ("plugin_id", "service_name", "environment")
  WHERE "scope_type" = 'global' AND "environment" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_internal_service_bindings_workspace_default_idx"
  ON "plugin_internal_service_bindings" ("plugin_id", "service_name", "scope_id")
  WHERE "scope_type" = 'workspace' AND "environment" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_internal_service_bindings_workspace_environment_idx"
  ON "plugin_internal_service_bindings" ("plugin_id", "service_name", "scope_id", "environment")
  WHERE "scope_type" = 'workspace' AND "environment" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_internal_service_bindings_plugin_service_idx"
  ON "plugin_internal_service_bindings" ("plugin_id", "service_name", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_internal_service_bindings_scope_lookup_idx"
  ON "plugin_internal_service_bindings" ("scope_type", "scope_id", "environment");

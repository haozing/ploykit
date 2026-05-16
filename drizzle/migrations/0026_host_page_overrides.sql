-- Migration: Host Capability Enhancements
-- Date: 2026-05-16
--
-- Stores the admin-selected active host page override for a host-owned page.
-- Plugin contracts declare candidates; this table records the operational
-- activation decision. Development-stage migration, no compatibility branch.

ALTER TABLE "plugin_collections"
  ADD COLUMN IF NOT EXISTS "schema_version" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_updated_at_idx"
  ON "plugin_records" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_records_data_gin_idx"
  ON "plugin_records" USING gin ("data");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "plugin_host_page_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_path" text NOT NULL,
  "plugin_id" text NOT NULL,
  "component_path" text NOT NULL,
  "mode" text NOT NULL DEFAULT 'main.replace',
  "status" text NOT NULL DEFAULT 'active',
  "priority" integer NOT NULL DEFAULT 100,
  "seo_hash" text,
  "i18n_hash" text,
  "activated_by" text,
  "activated_at" timestamptz NOT NULL DEFAULT now(),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_host_page_overrides_active_page_idx"
  ON "plugin_host_page_overrides" ("page_path")
  WHERE "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_host_page_overrides_plugin_page_idx"
  ON "plugin_host_page_overrides" ("plugin_id", "page_path");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_host_page_overrides_status_idx"
  ON "plugin_host_page_overrides" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_host_page_overrides_plugin_idx"
  ON "plugin_host_page_overrides" ("plugin_id");

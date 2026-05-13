-- Migration: Plugin Capability Context
-- Date: 2026-05-08
--
-- Adds scoped config and secret tables for ctx.config and ctx.secrets.
-- Secrets are intentionally marked plaintext-v1 until a real key management
-- layer is introduced; runtime/docs must report this as partial.

CREATE TABLE IF NOT EXISTS "plugin_config" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text NOT NULL DEFAULT '',
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_config_plugin_user_key_idx"
  ON "plugin_config" ("plugin_id", "user_id", "key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_config_plugin_idx"
  ON "plugin_config" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_config_user_idx"
  ON "plugin_config" ("user_id");
--> statement-breakpoint
ALTER TABLE "plugin_config" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_config" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_config_user_plugin_isolation ON "plugin_config";
--> statement-breakpoint
CREATE POLICY plugin_config_user_plugin_isolation ON "plugin_config"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      user_id = current_app_user_id()
      OR (current_app_user_id() = '' AND user_id = '')
    )
  )
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      user_id = current_app_user_id()
      OR (current_app_user_id() = '' AND user_id = '')
    )
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_secrets" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "user_id" text NOT NULL DEFAULT '',
  "name" text NOT NULL,
  "value_ciphertext" text NOT NULL,
  "encoding" text NOT NULL DEFAULT 'plaintext-v1',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_secrets_plugin_user_name_idx"
  ON "plugin_secrets" ("plugin_id", "user_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_secrets_plugin_idx"
  ON "plugin_secrets" ("plugin_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_secrets_user_idx"
  ON "plugin_secrets" ("user_id");
--> statement-breakpoint
ALTER TABLE "plugin_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_secrets_user_plugin_isolation ON "plugin_secrets";
--> statement-breakpoint
CREATE POLICY plugin_secrets_user_plugin_isolation ON "plugin_secrets"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      user_id = current_app_user_id()
      OR (current_app_user_id() = '' AND user_id = '')
    )
  )
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR (
    plugin_id = current_app_plugin_id()
    AND (
      user_id = current_app_user_id()
      OR (current_app_user_id() = '' AND user_id = '')
    )
  )
);

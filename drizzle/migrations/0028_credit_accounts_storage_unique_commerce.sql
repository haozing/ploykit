-- Migration: Generic credit accounts, plugin storage unique keys, and commerce support
-- Date: 2026-05-18

CREATE TABLE IF NOT EXISTS "credit_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "metric" text NOT NULL,
  "balance" integer NOT NULL DEFAULT 0,
  "unlimited" boolean NOT NULL DEFAULT false,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_accounts_scope_metric_idx" ON "credit_accounts" ("scope_type", "scope_id", "metric");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_accounts_scope_idx" ON "credit_accounts" ("scope_type", "scope_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_accounts_metric_idx" ON "credit_accounts" ("metric");
--> statement-breakpoint
ALTER TABLE "credit_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS credit_accounts_system_only ON "credit_accounts";
--> statement-breakpoint
CREATE POLICY credit_accounts_system_only ON "credit_accounts"
FOR ALL
USING (current_app_user_id() = 'system')
WITH CHECK (current_app_user_id() = 'system');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "credit_accounts"("id") ON DELETE cascade,
  "scope_type" text NOT NULL,
  "scope_id" text NOT NULL,
  "metric" text NOT NULL,
  "plugin_id" text,
  "user_id" text REFERENCES "user"("id") ON DELETE set null,
  "operation" text NOT NULL,
  "amount" integer NOT NULL,
  "balance_before" integer NOT NULL,
  "balance_after" integer NOT NULL,
  "idempotency_key" text,
  "idempotency_fingerprint" text,
  "related_order_id" uuid REFERENCES "orders"("id") ON DELETE set null,
  "related_usage_id" text,
  "reason" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "checksum" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_account_created_at_idx" ON "credit_ledger_entries" ("account_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_scope_metric_idx" ON "credit_ledger_entries" ("scope_type", "scope_id", "metric");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_entries_idempotency_idx" ON "credit_ledger_entries" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_order_idx" ON "credit_ledger_entries" ("related_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_user_idx" ON "credit_ledger_entries" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_entries_plugin_idx" ON "credit_ledger_entries" ("plugin_id");
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS credit_ledger_entries_system_only ON "credit_ledger_entries";
--> statement-breakpoint
CREATE POLICY credit_ledger_entries_system_only ON "credit_ledger_entries"
FOR ALL
USING (current_app_user_id() = 'system')
WITH CHECK (current_app_user_id() = 'system');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_record_unique_keys" (
  "id" text PRIMARY KEY,
  "plugin_id" text NOT NULL,
  "collection_name" text NOT NULL,
  "user_id" text,
  "unique_key" text NOT NULL,
  "record_id" text NOT NULL,
  "fields_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_record_unique_keys_active_key_idx"
  ON "plugin_record_unique_keys" ("plugin_id", "collection_name", "user_id", "unique_key")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_record_unique_keys_record_idx"
  ON "plugin_record_unique_keys" ("plugin_id", "collection_name", "record_id");
--> statement-breakpoint
ALTER TABLE "plugin_record_unique_keys" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_record_unique_keys" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_record_unique_keys_user_plugin_isolation ON "plugin_record_unique_keys";
--> statement-breakpoint
CREATE POLICY plugin_record_unique_keys_user_plugin_isolation ON "plugin_record_unique_keys"
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

CREATE TABLE IF NOT EXISTS "digital_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "plugin_id" text,
  "entitlement_key" text NOT NULL,
  "order_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "source_type" text DEFAULT 'manual' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "digital_entitlements_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE cascade,
  CONSTRAINT "digital_entitlements_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "digital_entitlements_user_key_idx"
  ON "digital_entitlements" ("user_id", "entitlement_key");

CREATE INDEX IF NOT EXISTS "digital_entitlements_plugin_key_idx"
  ON "digital_entitlements" ("plugin_id", "entitlement_key");

CREATE INDEX IF NOT EXISTS "digital_entitlements_order_idx"
  ON "digital_entitlements" ("order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "digital_entitlements_active_plugin_unique_idx"
  ON "digital_entitlements" ("user_id", "plugin_id", "entitlement_key")
  WHERE "status" = 'active' AND "revoked_at" IS NULL AND "plugin_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "digital_entitlements_active_global_unique_idx"
  ON "digital_entitlements" ("user_id", "entitlement_key")
  WHERE "status" = 'active' AND "revoked_at" IS NULL AND "plugin_id" IS NULL;

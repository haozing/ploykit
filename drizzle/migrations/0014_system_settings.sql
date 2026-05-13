CREATE TABLE IF NOT EXISTS "system_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "description" text,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_settings_updated_at_idx" ON "system_settings" ("updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "system_settings_updated_by_idx" ON "system_settings" ("updated_by");

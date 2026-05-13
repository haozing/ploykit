-- Migration: Plugin Runtime Completion
-- Date: 2026-05-08
--
-- Finalizes second-stage runtime persistence:
-- - encrypted plugin secret encoding default
-- - durable plugin job runs with dead-letter state
-- - provider-specific webhook/dead-letter status allowance

ALTER TABLE "plugin_secrets"
  ALTER COLUMN "encoding" SET DEFAULT 'aes-256-gcm-v1';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plugin_job_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "plugin_id" text NOT NULL DEFAULT '',
  "job_name" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 1 NOT NULL,
  "idempotency_key" text,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "dead_lettered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_job_runs_plugin_status_idx"
  ON "plugin_job_runs" ("plugin_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_job_runs_job_started_idx"
  ON "plugin_job_runs" ("job_name", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_job_runs_started_at_idx"
  ON "plugin_job_runs" ("started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plugin_job_runs_idempotency_key_idx"
  ON "plugin_job_runs" ("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "plugin_job_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plugin_job_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS plugin_job_runs_system_only ON "plugin_job_runs";
--> statement-breakpoint
CREATE POLICY plugin_job_runs_system_only ON "plugin_job_runs"
FOR ALL
USING (
  current_app_user_id() = 'system'
  OR plugin_id = current_app_plugin_id()
)
WITH CHECK (
  current_app_user_id() = 'system'
  OR plugin_id = current_app_plugin_id()
);

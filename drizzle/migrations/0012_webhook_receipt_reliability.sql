-- Migration: Webhook receipt reliability
-- Date: 2026-05-09
--
-- Adds database-level idempotency and an update timestamp used to recover
-- webhook receipts left in processing after a worker crash.

ALTER TABLE "webhook_logs"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE "webhook_logs"
SET "updated_at" = COALESCE("processed_at", "created_at", now())
WHERE "updated_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_logs_provider_event_id_unique_idx"
  ON "webhook_logs" ("provider", "event_id")
  WHERE "event_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_logs_status_updated_at_idx"
  ON "webhook_logs" ("status", "updated_at");

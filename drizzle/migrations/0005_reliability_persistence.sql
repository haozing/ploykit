-- Migration: Reliability Persistence
-- Date: 2026-05-07
--
-- Adds durable event outbox storage and extends usage_history with
-- idempotency metadata needed by the critical usage ledger.

CREATE TABLE IF NOT EXISTS "event_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "event" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "error" text,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "event_outbox_status_next_attempt_idx"
  ON "event_outbox" USING btree ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "event_outbox_event_status_idx"
  ON "event_outbox" USING btree ("event", "status");
CREATE INDEX IF NOT EXISTS "event_outbox_created_at_idx"
  ON "event_outbox" USING btree ("created_at");

ALTER TABLE "event_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_outbox" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_outbox_system_only ON "event_outbox";
CREATE POLICY event_outbox_system_only ON "event_outbox"
FOR ALL
USING (current_app_user_id() = 'system')
WITH CHECK (current_app_user_id() = 'system');

ALTER TABLE "usage_history" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
UPDATE "usage_history"
SET "idempotency_key" = COALESCE("idempotency_key", "id"::text);
ALTER TABLE "usage_history" ALTER COLUMN "idempotency_key" SET NOT NULL;

ALTER TABLE "usage_history" ADD COLUMN IF NOT EXISTS "unit" text DEFAULT 'count' NOT NULL;
ALTER TABLE "usage_history" ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "usage_history_idempotency_key_idx"
  ON "usage_history" USING btree ("idempotency_key");

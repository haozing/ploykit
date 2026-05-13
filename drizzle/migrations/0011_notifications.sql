-- Migration: Notifications
-- Date: 2026-05-09
--
-- Adds durable notification records for in-app history, unread state,
-- and queued delivery tracking.

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "type" text NOT NULL,
  "channel" text DEFAULT 'in_app' NOT NULL,
  "recipient" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "error" text,
  "read_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_channel_check"
    CHECK ("channel" IN ('in_app', 'email', 'webhook'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_status_check"
    CHECK ("status" IN ('pending', 'sent', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_status_idx"
  ON "notifications" ("user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_read_idx"
  ON "notifications" ("user_id", "read_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_at_idx"
  ON "notifications" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_type_idx"
  ON "notifications" ("type");
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS notifications_user_isolation ON "notifications";
--> statement-breakpoint
CREATE POLICY notifications_user_isolation ON "notifications"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

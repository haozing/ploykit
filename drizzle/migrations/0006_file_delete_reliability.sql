ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "delete_status" text DEFAULT 'active' NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "delete_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "delete_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN IF NOT EXISTS "delete_last_error" text;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "files"
    ADD CONSTRAINT "files_delete_status_check"
    CHECK ("delete_status" IN ('active', 'pending_delete'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_delete_status" ON "files" USING btree ("delete_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_delete_status_requested_at"
  ON "files" USING btree ("delete_status", "delete_requested_at");

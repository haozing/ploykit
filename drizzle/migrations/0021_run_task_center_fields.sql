-- Migration: Run task center fields
-- Date: 2026-05-11
--
-- Runs now expose user-task-center semantics directly instead of requiring
-- plugins or UI code to infer them from metadata.

ALTER TABLE "plugin_runs"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS "inputs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "costs" jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "retry" jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plugin_runs_visibility_idx" ON "plugin_runs" ("visibility");

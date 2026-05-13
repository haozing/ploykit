-- Migration: Connector 2.0 profiles
-- Date: 2026-05-11
--
-- Connector rows now store first-class auth, egress, retry, and redaction
-- policies. Legacy auth_type/secret_name/timeout_ms/retry_count remain as
-- compatibility mirrors during the development-stage refactor.

ALTER TABLE "plugin_connectors"
  ADD COLUMN IF NOT EXISTS "auth" jsonb NOT NULL DEFAULT '{"type":"none"}'::jsonb,
  ADD COLUMN IF NOT EXISTS "egress" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "retry" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "redaction" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Migration: Row Level Security Baseline
-- Date: 2026-05-07
--
-- Enables RLS and creates user isolation policies for high-risk tables.
-- System context (app.current_user_id = 'system') bypasses user isolation.

-- ============================================================================
-- Helper function: check if current context is system or matching user
-- ============================================================================
CREATE OR REPLACE FUNCTION current_app_user_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_user_id', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- files
-- ============================================================================
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS files_user_isolation ON "files";
CREATE POLICY files_user_isolation ON "files"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

-- ============================================================================
-- user_profiles
-- ============================================================================
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_profiles" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profiles_user_isolation ON "user_profiles";
CREATE POLICY user_profiles_user_isolation ON "user_profiles"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

-- ============================================================================
-- user_entitlements
-- ============================================================================
ALTER TABLE "user_entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_entitlements" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_entitlements_user_isolation ON "user_entitlements";
CREATE POLICY user_entitlements_user_isolation ON "user_entitlements"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

-- ============================================================================
-- usage_history
-- ============================================================================
ALTER TABLE "usage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_history" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_history_user_isolation ON "usage_history";
CREATE POLICY usage_history_user_isolation ON "usage_history"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

-- ============================================================================
-- plugin_settings
-- ============================================================================
ALTER TABLE "plugin_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plugin_settings" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plugin_settings_user_isolation ON "plugin_settings";
CREATE POLICY plugin_settings_user_isolation ON "plugin_settings"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

-- ============================================================================
-- orders
-- ============================================================================
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_user_isolation ON "orders";
CREATE POLICY orders_user_isolation ON "orders"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

-- ============================================================================
-- credit_logs
-- ============================================================================
ALTER TABLE "credit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_logs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_logs_user_isolation ON "credit_logs";
CREATE POLICY credit_logs_user_isolation ON "credit_logs"
FOR ALL
USING (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
)
WITH CHECK (
  user_id = current_app_user_id()
  OR current_app_user_id() = 'system'
);

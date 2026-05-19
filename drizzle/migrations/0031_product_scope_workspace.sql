-- Migration: Product-scoped workspace selection
-- Development-stage migration: workspace is now the host resource boundary for a product scope.

INSERT INTO app_products (id, name, runtime_key, default_locale, status, metadata)
VALUES ('ploykit', 'PloyKit', 'ploykit', 'en', 'active', '{}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  runtime_key = excluded.runtime_key,
  default_locale = excluded.default_locale,
  status = excluded.status,
  updated_at = now();
--> statement-breakpoint

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS product_id text;
--> statement-breakpoint

UPDATE workspaces
SET product_id = 'ploykit'
WHERE product_id IS NULL;
--> statement-breakpoint

ALTER TABLE workspaces
  ALTER COLUMN product_id SET NOT NULL;
--> statement-breakpoint

ALTER TABLE workspaces
  DROP CONSTRAINT IF EXISTS workspaces_product_id_app_products_id_fk;
--> statement-breakpoint

ALTER TABLE workspaces
  ADD CONSTRAINT workspaces_product_id_app_products_id_fk
  FOREIGN KEY (product_id) REFERENCES app_products(id) ON DELETE CASCADE;
--> statement-breakpoint

DROP INDEX IF EXISTS workspaces_slug_idx;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_product_slug_idx
  ON workspaces (product_id, slug);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS workspaces_product_owner_idx
  ON workspaces (product_id, owner_user_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS workspaces_product_status_idx
  ON workspaces (product_id, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS product_scope_preferences (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS product_scope_preferences_user_product_idx
  ON product_scope_preferences (user_id, product_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS product_scope_preferences_product_idx
  ON product_scope_preferences (product_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS product_scope_preferences_workspace_idx
  ON product_scope_preferences (workspace_id);
--> statement-breakpoint

ALTER TABLE product_scope_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

ALTER TABLE product_scope_preferences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS product_scope_preferences_user_isolation ON product_scope_preferences;
--> statement-breakpoint

CREATE POLICY product_scope_preferences_user_isolation ON product_scope_preferences
FOR ALL
USING (user_id = current_app_user_id() OR current_app_user_id() = 'system')
WITH CHECK (user_id = current_app_user_id() OR current_app_user_id() = 'system');


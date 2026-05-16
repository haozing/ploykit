-- PloyKit plugin runtime product/suite/bundle boundary reset.
-- Development-stage migration: plugin runtime install/binding state is rebuilt from manifests.

TRUNCATE TABLE
  plugin_installations,
  plugin_models,
  plugin_resource_bindings,
  plugin_internal_service_bindings,
  plugin_host_page_overrides
RESTART IDENTITY CASCADE;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_products (
  id text PRIMARY KEY,
  name text NOT NULL,
  runtime_key text NOT NULL,
  default_locale text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS app_products_runtime_key_idx
  ON app_products (runtime_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_products_status_idx
  ON app_products (status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS plugin_suites (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  name text NOT NULL,
  version text NOT NULL DEFAULT '0.1.0',
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS plugin_suites_product_idx
  ON plugin_suites (product_id, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS plugin_suite_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suite_id text NOT NULL REFERENCES plugin_suites(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  plugin_id text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  sort_order integer NOT NULL DEFAULT 100,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS plugin_suite_members_suite_plugin_idx
  ON plugin_suite_members (suite_id, plugin_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_suite_members_product_plugin_idx
  ON plugin_suite_members (product_id, plugin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_suite_members_product_idx
  ON plugin_suite_members (product_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_bundles (
  id text PRIMARY KEY,
  product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  suite_id text REFERENCES plugin_suites(id) ON DELETE SET NULL,
  name text NOT NULL,
  version text NOT NULL DEFAULT '0.1.0',
  source_type text NOT NULL DEFAULT 'local',
  source_ref text,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS app_bundles_product_idx
  ON app_bundles (product_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_bundles_suite_idx
  ON app_bundles (suite_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_bundle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id text NOT NULL REFERENCES app_bundles(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  suite_id text REFERENCES plugin_suites(id) ON DELETE SET NULL,
  plugin_id text NOT NULL,
  enable_by_default boolean NOT NULL DEFAULT true,
  required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS app_bundle_members_bundle_plugin_idx
  ON app_bundle_members (bundle_id, plugin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_bundle_members_product_plugin_idx
  ON app_bundle_members (product_id, plugin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS app_bundle_members_suite_idx
  ON app_bundle_members (suite_id);
--> statement-breakpoint

ALTER TABLE plugin_models
  DROP CONSTRAINT IF EXISTS plugin_models_plugin_id_plugin_installations_plugin_id_fk;
--> statement-breakpoint
ALTER TABLE plugin_installations
  DROP CONSTRAINT IF EXISTS plugin_installations_plugin_id_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_installations_plugin_id_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_installations_plugin_id_unique_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_installations_enabled_idx;
--> statement-breakpoint
ALTER TABLE plugin_models
  ADD COLUMN IF NOT EXISTS product_id text NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_models_product_plugin_idx
  ON plugin_models (product_id, plugin_id);
--> statement-breakpoint

ALTER TABLE plugin_installations
  ADD COLUMN IF NOT EXISTS product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS suite_id text REFERENCES plugin_suites(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bundle_id text REFERENCES app_bundles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS install_status text NOT NULL DEFAULT 'installed',
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS plugin_installations_product_plugin_idx
  ON plugin_installations (product_id, plugin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_installations_product_enabled_idx
  ON plugin_installations (product_id, enabled);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_installations_suite_enabled_idx
  ON plugin_installations (suite_id, enabled);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_installations_bundle_idx
  ON plugin_installations (bundle_id);
--> statement-breakpoint

DROP INDEX IF EXISTS plugin_host_page_overrides_active_page_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_host_page_overrides_plugin_page_idx;
--> statement-breakpoint

ALTER TABLE plugin_host_page_overrides
  ADD COLUMN IF NOT EXISTS product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS suite_id text REFERENCES plugin_suites(id) ON DELETE SET NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS plugin_host_page_overrides_active_page_idx
  ON plugin_host_page_overrides (product_id, page_path)
  WHERE status = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_host_page_overrides_plugin_page_idx
  ON plugin_host_page_overrides (product_id, plugin_id, page_path);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_host_page_overrides_product_idx
  ON plugin_host_page_overrides (product_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_host_page_overrides_suite_idx
  ON plugin_host_page_overrides (suite_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS plugin_runtime_surfaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES app_products(id) ON DELETE CASCADE,
  suite_id text REFERENCES plugin_suites(id) ON DELETE SET NULL,
  plugin_id text NOT NULL,
  surface_type text NOT NULL,
  surface_key text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS plugin_runtime_surfaces_unique_surface_idx
  ON plugin_runtime_surfaces (product_id, plugin_id, surface_type, surface_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_runtime_surfaces_product_surface_idx
  ON plugin_runtime_surfaces (product_id, surface_type, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_runtime_surfaces_suite_idx
  ON plugin_runtime_surfaces (suite_id);
--> statement-breakpoint

DROP INDEX IF EXISTS plugin_resource_bindings_unique_resource;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_resource_bindings_one_active_resource;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_resource_bindings_scope_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_resource_bindings_status_idx;
--> statement-breakpoint

ALTER TABLE plugin_resource_bindings
  ADD COLUMN IF NOT EXISTS product_id text NOT NULL,
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'plugin',
  ADD COLUMN IF NOT EXISTS owner_id text NOT NULL,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS plugin_resource_bindings_unique_resource
  ON plugin_resource_bindings (
    product_id,
    owner_type,
    owner_id,
    scope_type,
    scope_id,
    resource_type,
    resource_id
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_resource_bindings_one_active_resource
  ON plugin_resource_bindings (
    product_id,
    owner_type,
    owner_id,
    scope_type,
    scope_id,
    resource_type
  )
  WHERE status = 'active' AND cardinality = 'one';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_resource_bindings_scope_idx
  ON plugin_resource_bindings (
    product_id,
    owner_type,
    owner_id,
    scope_type,
    scope_id,
    resource_type,
    status
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_resource_bindings_plugin_idx
  ON plugin_resource_bindings (plugin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_resource_bindings_status_idx
  ON plugin_resource_bindings (product_id, owner_type, owner_id, status);
--> statement-breakpoint

DROP INDEX IF EXISTS plugin_internal_service_bindings_global_default_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_internal_service_bindings_global_environment_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_internal_service_bindings_workspace_default_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_internal_service_bindings_workspace_environment_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS plugin_internal_service_bindings_plugin_service_idx;
--> statement-breakpoint

ALTER TABLE plugin_internal_service_bindings
  ADD COLUMN IF NOT EXISTS product_id text NOT NULL,
  ADD COLUMN IF NOT EXISTS owner_type text NOT NULL DEFAULT 'plugin',
  ADD COLUMN IF NOT EXISTS owner_id text NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS plugin_internal_service_bindings_global_default_idx
  ON plugin_internal_service_bindings (product_id, owner_type, owner_id, service_name)
  WHERE scope_type = 'global' AND environment IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_internal_service_bindings_global_environment_idx
  ON plugin_internal_service_bindings (
    product_id,
    owner_type,
    owner_id,
    service_name,
    environment
  )
  WHERE scope_type = 'global' AND environment IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_internal_service_bindings_workspace_default_idx
  ON plugin_internal_service_bindings (
    product_id,
    owner_type,
    owner_id,
    service_name,
    scope_id
  )
  WHERE scope_type = 'workspace' AND environment IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_internal_service_bindings_workspace_environment_idx
  ON plugin_internal_service_bindings (
    product_id,
    owner_type,
    owner_id,
    service_name,
    scope_id,
    environment
  )
  WHERE scope_type = 'workspace' AND environment IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_internal_service_bindings_plugin_service_idx
  ON plugin_internal_service_bindings (plugin_id, service_name, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS plugin_internal_service_bindings_owner_service_idx
  ON plugin_internal_service_bindings (
    product_id,
    owner_type,
    owner_id,
    service_name,
    status
  );

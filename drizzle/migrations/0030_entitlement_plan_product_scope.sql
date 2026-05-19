-- Product-scoped entitlement plans.
-- Development-stage migration: existing plans are attached to the default PloyKit product.

INSERT INTO app_products (id, name, runtime_key, default_locale, status, metadata)
VALUES ('ploykit', 'PloyKit', 'ploykit', 'en', 'active', '{}'::jsonb)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  runtime_key = excluded.runtime_key,
  default_locale = excluded.default_locale,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();
--> statement-breakpoint

ALTER TABLE entitlement_plans
  ADD COLUMN IF NOT EXISTS product_id text NOT NULL DEFAULT 'ploykit';
--> statement-breakpoint

ALTER TABLE entitlement_plans
  DROP CONSTRAINT IF EXISTS entitlement_plans_product_id_app_products_id_fk;
--> statement-breakpoint

ALTER TABLE entitlement_plans
  ADD CONSTRAINT entitlement_plans_product_id_app_products_id_fk
  FOREIGN KEY (product_id) REFERENCES app_products(id) ON DELETE CASCADE;
--> statement-breakpoint

DROP INDEX IF EXISTS entitlement_plans_slug_idx;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS entitlement_plans_product_slug_idx
  ON entitlement_plans (product_id, slug);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS entitlement_plans_product_active_idx
  ON entitlement_plans (product_id, is_active);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS entitlement_plans_product_sort_idx
  ON entitlement_plans (product_id, sort_order);

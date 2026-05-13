-- Subscription refactor foundation (plans pricing/limits by interval + stripe price mapping)

ALTER TABLE "entitlement_plans" ADD COLUMN IF NOT EXISTS "pricing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entitlement_plans" ADD COLUMN IF NOT EXISTS "stripe" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint

ALTER TABLE "entitlement_plans" ALTER COLUMN "limits" SET DEFAULT '{"monthly": {}, "yearly": {}}'::jsonb;--> statement-breakpoint

-- Wrap legacy flat limits into { monthly, yearly } (yearly defaults to monthly)
UPDATE "entitlement_plans"
SET "limits" = jsonb_build_object(
  'monthly',
  CASE
    WHEN "limits" ? 'monthly' THEN COALESCE("limits"->'monthly', '{}'::jsonb)
    ELSE COALESCE("limits", '{}'::jsonb)
  END,
  'yearly',
  CASE
    WHEN "limits" ? 'yearly' THEN COALESCE("limits"->'yearly', '{}'::jsonb)
    WHEN "limits" ? 'monthly' THEN COALESCE("limits"->'monthly', '{}'::jsonb)
    ELSE COALESCE("limits", '{}'::jsonb)
  END
)
WHERE "limits" IS NULL OR NOT ("limits" ? 'monthly' AND "limits" ? 'yearly');--> statement-breakpoint

-- Initialize structured pricing from existing columns/metadata (best-effort)
UPDATE "entitlement_plans"
SET "pricing" = jsonb_strip_nulls(jsonb_build_object(
  'currency', COALESCE("currency", 'USD'),
  'trialDays',
  CASE
    WHEN ("metadata"->>'trialDays') ~ '^[0-9]+$' THEN ("metadata"->>'trialDays')::int
    ELSE NULL
  END,
  'monthly', jsonb_build_object('amount', COALESCE("price", 0)::numeric),
  'yearly', jsonb_build_object(
    'amount',
    CASE
      WHEN ("metadata"->>'priceYearly') ~ '^[0-9]+(\\.[0-9]+)?$' THEN ("metadata"->>'priceYearly')::numeric
      ELSE NULL
    END
  )
))
WHERE ("pricing" IS NULL OR "pricing" = '{}'::jsonb);--> statement-breakpoint

ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "billing_interval" text DEFAULT 'monthly' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "quota_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "quota_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_entitlements" ADD COLUMN IF NOT EXISTS "stripe_subscription_status" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_entitlements_billing_interval_idx" ON "user_entitlements" USING btree ("billing_interval");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_plan_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "stripe_env" text DEFAULT 'test' NOT NULL,
  "interval" text NOT NULL,
  "stripe_price_id" text NOT NULL,
  "is_current" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'billing_plan_prices_plan_id_fk'
  ) THEN
    ALTER TABLE "billing_plan_prices"
      ADD CONSTRAINT "billing_plan_prices_plan_id_fk"
      FOREIGN KEY ("plan_id") REFERENCES "public"."entitlement_plans"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "billing_plan_prices_provider_price_idx"
  ON "billing_plan_prices" USING btree ("provider","stripe_env","stripe_price_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_plan_prices_plan_interval_idx"
  ON "billing_plan_prices" USING btree ("plan_id","stripe_env","interval");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_plan_prices_current_idx"
  ON "billing_plan_prices" USING btree ("is_current");--> statement-breakpoint

-- Backfill plan price mappings from legacy metadata fields (best-effort)
INSERT INTO "billing_plan_prices" ("plan_id","provider","stripe_env","interval","stripe_price_id","is_current")
SELECT
  "id" as plan_id,
  'stripe' as provider,
  CASE
    WHEN ("metadata"->>'stripePriceIdMonthly') LIKE '%_test_%' THEN 'test'
    WHEN ("metadata"->>'stripePriceIdMonthly') LIKE 'price_%' THEN 'live'
    ELSE 'test'
  END as stripe_env,
  'monthly' as interval,
  ("metadata"->>'stripePriceIdMonthly') as stripe_price_id,
  true as is_current
FROM "entitlement_plans"
WHERE ("metadata"->>'stripePriceIdMonthly') IS NOT NULL
  AND ("metadata"->>'stripePriceIdMonthly') <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "billing_plan_prices" ("plan_id","provider","stripe_env","interval","stripe_price_id","is_current")
SELECT
  "id" as plan_id,
  'stripe' as provider,
  CASE
    WHEN ("metadata"->>'stripePriceIdYearly') LIKE '%_test_%' THEN 'test'
    WHEN ("metadata"->>'stripePriceIdYearly') LIKE 'price_%' THEN 'live'
    ELSE 'test'
  END as stripe_env,
  'yearly' as interval,
  ("metadata"->>'stripePriceIdYearly') as stripe_price_id,
  true as is_current
FROM "entitlement_plans"
WHERE ("metadata"->>'stripePriceIdYearly') IS NOT NULL
  AND ("metadata"->>'stripePriceIdYearly') <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

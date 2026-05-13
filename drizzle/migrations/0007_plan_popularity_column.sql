ALTER TABLE "entitlement_plans" ADD COLUMN IF NOT EXISTS "is_popular" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "entitlement_plans"
SET "is_popular" = true
WHERE COALESCE(("metadata"->>'isPopular')::boolean, false) = true;

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'active' NOT NULL,
  ADD COLUMN IF NOT EXISTS "suspended_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "suspended_by" text,
  ADD COLUMN IF NOT EXISTS "suspend_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profiles_status_idx" ON "user_profiles" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_profiles_suspended_at_idx" ON "user_profiles" ("suspended_at");
--> statement-breakpoint
ALTER TABLE "credit_logs"
  ADD COLUMN IF NOT EXISTS "ledger_sequence" bigserial,
  ADD COLUMN IF NOT EXISTS "balance_before" jsonb,
  ADD COLUMN IF NOT EXISTS "balance_delta" jsonb,
  ADD COLUMN IF NOT EXISTS "checksum" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_logs_ledger_sequence_idx" ON "credit_logs" ("ledger_sequence");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE set null,
  "provider" text DEFAULT 'local' NOT NULL,
  "provider_invoice_id" text,
  "invoice_number" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "subtotal_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
  "tax_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
  "total_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
  "hosted_url" text,
  "pdf_url" text,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "due_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_user_id_idx" ON "billing_invoices" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_order_id_idx" ON "billing_invoices" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_status_idx" ON "billing_invoices" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_invoices_issued_at_idx" ON "billing_invoices" ("issued_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_invoice_number_idx" ON "billing_invoices" ("invoice_number");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_provider_invoice_idx" ON "billing_invoices" ("provider", "provider_invoice_id") WHERE "provider_invoice_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_payment_methods" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "provider" text DEFAULT 'local' NOT NULL,
  "provider_payment_method_id" text,
  "type" text NOT NULL,
  "brand" text,
  "last4" text,
  "exp_month" integer,
  "exp_year" integer,
  "billing_name" text,
  "billing_email" text,
  "billing_country" text,
  "status" text DEFAULT 'active' NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payment_methods_user_id_idx" ON "billing_payment_methods" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payment_methods_status_idx" ON "billing_payment_methods" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payment_methods_default_idx" ON "billing_payment_methods" ("user_id", "is_default");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_payment_methods_provider_id_idx" ON "billing_payment_methods" ("provider", "provider_payment_method_id") WHERE "provider_payment_method_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_tax_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "legal_name" text,
  "tax_id" text,
  "tax_id_type" text,
  "country" text NOT NULL,
  "region" text,
  "city" text,
  "postal_code" text,
  "address_line1" text,
  "address_line2" text,
  "status" text DEFAULT 'active' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_tax_profiles_user_id_idx" ON "billing_tax_profiles" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_tax_profiles_status_idx" ON "billing_tax_profiles" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_tax_profiles_country_idx" ON "billing_tax_profiles" ("country");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_reconciliation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "checked_users" integer DEFAULT 0 NOT NULL,
  "mismatch_count" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "error" text,
  "report" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_reconciliation_runs_status_idx" ON "credit_reconciliation_runs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_reconciliation_runs_started_at_idx" ON "credit_reconciliation_runs" ("started_at" DESC);
--> statement-breakpoint
ALTER TABLE "files"
  ADD COLUMN IF NOT EXISTS "provider" varchar(50) DEFAULT 'local' NOT NULL,
  ADD COLUMN IF NOT EXISTS "retention_action" text DEFAULT 'none' NOT NULL,
  ADD COLUMN IF NOT EXISTS "retention_until" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_folder" ON "files" ("folder");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_provider" ON "files" ("provider");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_files_retention" ON "files" ("retention_action", "retention_until");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "edge_access_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "source" text DEFAULT 'api_gateway' NOT NULL,
  "request_id" text,
  "method" text NOT NULL,
  "path" text NOT NULL,
  "status_code" integer NOT NULL,
  "duration_ms" integer,
  "ip_address" text,
  "user_agent" text,
  "user_id" text,
  "api_key_id" text,
  "region" text,
  "failure_type" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_access_logs_occurred_at_idx" ON "edge_access_logs" ("occurred_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_access_logs_source_idx" ON "edge_access_logs" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_access_logs_status_idx" ON "edge_access_logs" ("status_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_access_logs_failure_type_idx" ON "edge_access_logs" ("failure_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_access_logs_path_idx" ON "edge_access_logs" ("path");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "edge_access_logs_request_id_idx" ON "edge_access_logs" ("source", "request_id") WHERE "request_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "roles"
SET "permissions" = (
  SELECT ARRAY(
    SELECT DISTINCT permission
    FROM unnest("roles"."permissions" || ARRAY[
      'billing:manage:all',
      'invoice:manage:all',
      'payment_method:manage:all',
      'tax_profile:manage:all',
      'credit:manage:all',
      'credit:reconcile:all',
      'audit:export:all',
      'audit:retention:all',
      'file:manage:all',
      'file:retention:all',
      'outbox:manage:all',
      'webhook:retry:all',
      'reliability:read:all',
      'edge_access_log:read:all',
      'edge_access_log:ingest:all'
    ]::text[]) AS permission
  )
),
"updated_at" = now()
WHERE "slug" = 'admin';
--> statement-breakpoint
ALTER TABLE "billing_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS billing_invoices_user_isolation ON "billing_invoices";
--> statement-breakpoint
CREATE POLICY billing_invoices_user_isolation ON "billing_invoices"
FOR ALL
USING (user_id = current_app_user_id() OR current_app_user_id() = 'system')
WITH CHECK (user_id = current_app_user_id() OR current_app_user_id() = 'system');
--> statement-breakpoint
ALTER TABLE "billing_payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_payment_methods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS billing_payment_methods_user_isolation ON "billing_payment_methods";
--> statement-breakpoint
CREATE POLICY billing_payment_methods_user_isolation ON "billing_payment_methods"
FOR ALL
USING (user_id = current_app_user_id() OR current_app_user_id() = 'system')
WITH CHECK (user_id = current_app_user_id() OR current_app_user_id() = 'system');
--> statement-breakpoint
ALTER TABLE "billing_tax_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "billing_tax_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS billing_tax_profiles_user_isolation ON "billing_tax_profiles";
--> statement-breakpoint
CREATE POLICY billing_tax_profiles_user_isolation ON "billing_tax_profiles"
FOR ALL
USING (user_id = current_app_user_id() OR current_app_user_id() = 'system')
WITH CHECK (user_id = current_app_user_id() OR current_app_user_id() = 'system');

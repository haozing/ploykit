import { Pool } from 'pg';

export const RUNTIME_STORE_POSTGRES_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';

export async function runtimeStorePostgresReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: RUNTIME_STORE_POSTGRES_DATABASE_URL });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function resetRuntimeTables(pool: Pool): Promise<void> {
  await pool.query(`
    drop table if exists module_provider_invocations cascade;
    drop table if exists module_revenue_buckets cascade;
    drop table if exists module_tax_profiles cascade;
    drop table if exists module_subscriptions cascade;
    drop table if exists module_invoices cascade;
    drop table if exists module_billing_accounts cascade;
    drop table if exists module_commercial_catalog cascade;
    drop table if exists module_worker_registry cascade;
    drop table if exists module_delivery_ledger cascade;
    drop table if exists module_notification_deliveries cascade;
    drop table if exists module_notifications cascade;
    drop table if exists module_product_scope_memberships cascade;
    drop table if exists module_product_scope_invites cascade;
    drop table if exists module_product_scope_domain_aliases cascade;
    drop table if exists module_product_scope_workspaces cascade;
    drop table if exists module_product_scope_products cascade;
    drop table if exists module_api_keys cascade;
    drop table if exists module_host_users cascade;
    drop table if exists module_catalog_states cascade;
    drop table if exists module_redeem_redemptions cascade;
    drop table if exists module_redeem_codes cascade;
    drop table if exists module_commercial_orders cascade;
    drop table if exists module_commercial_entitlements cascade;
    drop table if exists module_files cascade;
    drop table if exists module_credit_ledger cascade;
    drop table if exists module_metering_ledger cascade;
    drop table if exists module_usage_records cascade;
    drop table if exists module_audit_logs cascade;
    drop table if exists module_webhook_receipts cascade;
    drop table if exists module_outbox cascade;
    drop table if exists module_run_logs cascade;
    drop table if exists module_runs cascade;
  `);
}

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ModuleDataPostgresExecutor } from '../data';

const RUNTIME_STORE_MIGRATIONS_DIR = path.join(process.cwd(), 'migrations', 'runtime');

export const RUNTIME_STORE_REQUIRED_TABLES = [
  'module_runs',
  'module_run_logs',
  'module_outbox',
  'module_delivery_ledger',
  'module_worker_registry',
  'module_webhook_receipts',
  'module_audit_logs',
  'module_usage_records',
  'module_metering_ledger',
  'module_credit_ledger',
  'module_credit_reservations',
  'module_commercial_catalog',
  'module_commercial_entitlements',
  'module_commercial_orders',
  'module_billing_accounts',
  'module_invoices',
  'module_credit_notes',
  'module_subscriptions',
  'module_subscription_events',
  'module_tax_profiles',
  'module_revenue_buckets',
  'module_settlement_batches',
  'module_provider_invocations',
  'module_rag_sources',
  'module_rag_chunks',
  'module_redeem_codes',
  'module_redeem_redemptions',
  'module_api_keys',
  'module_risk_events',
  'module_risk_blocks',
  'module_files',
  'module_catalog_states',
  'module_product_scope_memberships',
  'module_host_users',
  'module_product_scope_products',
  'module_product_scope_workspaces',
  'module_product_scope_domain_aliases',
  'module_product_scope_invites',
  'module_notifications',
  'module_notification_deliveries',
  'module_host_settings',
  'module_service_connections',
  'module_resource_bindings',
  'module_runtime_migrations',
] as const;

export interface RuntimeStoreMigrationFile {
  id: string;
  filename: string;
  checksum: string;
  sql: string;
}

export interface RuntimeStoreMigrationJournalRecord {
  id: string;
  checksum: string;
  appliedAt?: string;
  durationMs?: number;
  status: 'running' | 'applied' | 'failed';
  environment?: string;
  error?: string;
}

export interface RuntimeStoreSchemaVerification {
  ok: boolean;
  missing: string[];
  columnIssues: string[];
  indexIssues: string[];
  indexAudit: RuntimeStoreIndexAudit;
  migrationIssues: string[];
  migrations: {
    expected: number;
    applied: number;
  };
}

export interface RuntimeStoreIndexAuditEntry {
  index: string;
  domain: string;
  table: string;
  query: string;
  columns: readonly string[];
  unique?: boolean;
}

export interface RuntimeStoreIndexAudit {
  required: number;
  present: number;
  missing: RuntimeStoreIndexAuditEntry[];
  domains: Record<string, { required: number; present: number }>;
}

const REQUIRED_COLUMNS: Record<string, readonly string[]> = {
  module_host_settings: ['id', 'product_id', 'namespace', 'key', 'value_json', 'status', 'version'],
  module_service_connections: [
    'connection_id',
    'product_id',
    'service',
    'provider',
    'status',
    'config',
    'secret_refs',
  ],
  module_resource_bindings: ['binding_id', 'product_id', 'name', 'value_json', 'status'],
  module_outbox: [
    'id',
    'product_id',
    'name',
    'payload',
    'status',
    'attempts',
    'created_at',
    'updated_at',
  ],
  module_delivery_ledger: [
    'id',
    'product_id',
    'kind',
    'source',
    'target',
    'status',
    'attempts',
    'metadata',
    'created_at',
    'updated_at',
  ],
  module_worker_registry: [
    'id',
    'product_id',
    'worker_id',
    'profile',
    'status',
    'queue_profile',
    'heartbeat_at',
    'processed',
    'failed',
    'dead_lettered',
  ],
  module_webhook_receipts: [
    'id',
    'product_id',
    'workspace_id',
    'module_id',
    'webhook_name',
    'path',
    'method',
    'status',
    'attempts',
    'idempotency_key',
    'headers',
    'body_text',
    'body_digest',
  ],
  module_commercial_catalog: [
    'id',
    'product_id',
    'kind',
    'item_id',
    'version',
    'status',
    'value_json',
  ],
  module_billing_accounts: ['id', 'product_id', 'user_id', 'status', 'customer_profile'],
  module_invoices: [
    'id',
    'product_id',
    'user_id',
    'number',
    'status',
    'total',
    'currency',
    'lines',
  ],
  module_credit_notes: [
    'id',
    'product_id',
    'user_id',
    'order_id',
    'invoice_id',
    'number',
    'status',
    'amount',
    'currency',
    'reason',
    'lines',
    'metadata',
    'issued_at',
  ],
  module_subscriptions: ['id', 'product_id', 'user_id', 'plan_id', 'status'],
  module_subscription_events: [
    'id',
    'product_id',
    'user_id',
    'subscription_id',
    'plan_id',
    'type',
    'status',
    'idempotency_key',
    'effective_at',
    'metadata',
  ],
  module_tax_profiles: ['id', 'product_id', 'user_id', 'validation_status', 'profile', 'evidence'],
  module_revenue_buckets: ['id', 'product_id', 'bucket_date', 'currency', 'gross', 'net'],
  module_settlement_batches: [
    'id',
    'product_id',
    'provider',
    'currency',
    'period_start',
    'period_end',
    'status',
    'gross',
    'refund',
    'fee',
    'net',
    'invoice_count',
    'credit_note_count',
  ],
  module_provider_invocations: [
    'id',
    'product_id',
    'provider_id',
    'kind',
    'operation',
    'status',
    'usage',
    'cost',
    'latency_ms',
  ],
  module_rag_sources: [
    'id',
    'product_id',
    'module_id',
    'source_id',
    'status',
    'content_digest',
    'content_length',
    'chunk_count',
    'metadata',
  ],
  module_rag_chunks: [
    'id',
    'product_id',
    'module_id',
    'source_id',
    'chunk_index',
    'content',
    'embedding',
    'metadata',
  ],
  module_files: ['id', 'product_id', 'module_id', 'storage_key', 'status', 'metadata'],
  module_api_keys: [
    'id',
    'product_id',
    'workspace_id',
    'module_id',
    'name',
    'prefix',
    'key_hash',
    'owner_subject_type',
    'owner_subject_id',
    'permissions',
    'status',
    'expires_at',
    'revoked_at',
    'last_used_at',
    'metadata',
  ],
  module_credit_reservations: [
    'id',
    'product_id',
    'workspace_id',
    'user_id',
    'amount_reserved',
    'amount_committed',
    'unit',
    'status',
    'reason',
    'source',
    'source_id',
    'idempotency_key',
    'metadata',
  ],
  module_risk_events: [
    'id',
    'product_id',
    'workspace_id',
    'module_id',
    'subject_type',
    'subject_id',
    'type',
    'severity',
    'source',
    'source_id',
    'metadata',
  ],
  module_risk_blocks: [
    'id',
    'product_id',
    'workspace_id',
    'subject_type',
    'subject_id',
    'scope',
    'reason',
    'expires_at',
    'idempotency_key',
    'metadata',
  ],
};

export const RUNTIME_STORE_REQUIRED_INDEXES: readonly RuntimeStoreIndexAuditEntry[] = [
  {
    index: 'module_host_settings_lookup_idx',
    domain: 'settings',
    table: 'module_host_settings',
    query: 'settings namespace/key lookup by product',
    columns: ['product_id', 'namespace', 'key'],
  },
  {
    index: 'module_service_connections_lookup_idx',
    domain: 'provider',
    table: 'module_service_connections',
    query: 'service connection inventory by product/service/provider/status',
    columns: ['product_id', 'service', 'provider', 'status'],
  },
  {
    index: 'module_resource_bindings_lookup_idx',
    domain: 'provider',
    table: 'module_resource_bindings',
    query: 'resource binding lookup by product/name/status',
    columns: ['product_id', 'name', 'status'],
  },
  {
    index: 'module_runs_idempotency_idx',
    domain: 'runs',
    table: 'module_runs',
    query: 'run idempotency by product/workspace/module/key',
    columns: ['product_id', 'workspace_id', 'module_id', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_outbox_idempotency_idx',
    domain: 'outbox',
    table: 'module_outbox',
    query: 'outbox idempotency by product/workspace/module/name/key',
    columns: ['product_id', 'workspace_id', 'module_id', 'name', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_delivery_ledger_scope_idx',
    domain: 'outbox',
    table: 'module_delivery_ledger',
    query: 'delivery ledger filtering by product/status/kind',
    columns: ['product_id', 'status', 'kind', 'created_at'],
  },
  {
    index: 'module_delivery_ledger_outbox_idx',
    domain: 'outbox',
    table: 'module_delivery_ledger',
    query: 'delivery ledger drilldown by outbox id',
    columns: ['outbox_id'],
  },
  {
    index: 'module_delivery_ledger_worker_idx',
    domain: 'worker',
    table: 'module_delivery_ledger',
    query: 'worker delivery evidence by worker id/status',
    columns: ['worker_id', 'status', 'created_at'],
  },
  {
    index: 'module_worker_registry_lookup_idx',
    domain: 'worker',
    table: 'module_worker_registry',
    query: 'worker status inventory by product/status/profile',
    columns: ['product_id', 'status', 'queue_profile'],
  },
  {
    index: 'module_worker_registry_scope_uidx',
    domain: 'worker',
    table: 'module_worker_registry',
    query: 'worker heartbeat uniqueness by product/workspace/worker',
    columns: ['product_id', 'workspace_id', 'worker_id'],
    unique: true,
  },
  {
    index: 'module_webhook_receipts_idempotency_idx',
    domain: 'webhooks',
    table: 'module_webhook_receipts',
    query: 'webhook idempotency by product/workspace/module/webhook/key',
    columns: ['product_id', 'workspace_id', 'module_id', 'webhook_name', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_webhook_receipts_body_digest_idx',
    domain: 'webhooks',
    table: 'module_webhook_receipts',
    query: 'webhook duplicate detection by body digest',
    columns: ['body_digest'],
  },
  {
    index: 'module_commercial_catalog_lookup_idx',
    domain: 'commercial',
    table: 'module_commercial_catalog',
    query: 'commercial catalog lookup by product/kind/status',
    columns: ['product_id', 'kind', 'status'],
  },
  {
    index: 'module_commercial_catalog_scope_uidx',
    domain: 'commercial',
    table: 'module_commercial_catalog',
    query: 'commercial catalog uniqueness by product/workspace/kind/item/version',
    columns: ['product_id', 'workspace_id', 'kind', 'item_id', 'version'],
    unique: true,
  },
  {
    index: 'module_commercial_orders_idempotency_idx',
    domain: 'commercial',
    table: 'module_commercial_orders',
    query: 'order idempotency by product/workspace/user/key',
    columns: ['product_id', 'workspace_id', 'user_id', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_commercial_orders_provider_ref_idx',
    domain: 'commercial',
    table: 'module_commercial_orders',
    query: 'order provider event idempotency',
    columns: ['product_id', 'workspace_id', 'provider', 'provider_ref'],
    unique: true,
  },
  {
    index: 'module_commercial_orders_lookup_idx',
    domain: 'commercial',
    table: 'module_commercial_orders',
    query: 'order ledger filtering by product/workspace/status/user',
    columns: ['product_id', 'workspace_id', 'status', 'user_id'],
  },
  {
    index: 'module_billing_accounts_lookup_idx',
    domain: 'commercial',
    table: 'module_billing_accounts',
    query: 'billing account lookup by product/user/status',
    columns: ['product_id', 'user_id', 'status'],
  },
  {
    index: 'module_billing_accounts_scope_uidx',
    domain: 'commercial',
    table: 'module_billing_accounts',
    query: 'billing account uniqueness by product/workspace/user',
    columns: ['product_id', 'workspace_id', 'user_id'],
    unique: true,
  },
  {
    index: 'module_invoices_order_uidx',
    domain: 'commercial',
    table: 'module_invoices',
    query: 'invoice uniqueness by order',
    columns: ['order_id'],
    unique: true,
  },
  {
    index: 'module_invoices_number_uidx',
    domain: 'commercial',
    table: 'module_invoices',
    query: 'invoice number uniqueness by product/number',
    columns: ['product_id', 'number'],
    unique: true,
  },
  {
    index: 'module_invoices_lookup_idx',
    domain: 'commercial',
    table: 'module_invoices',
    query: 'invoice ledger filtering by product/workspace/status/user',
    columns: ['product_id', 'workspace_id', 'status', 'user_id'],
  },
  {
    index: 'module_credit_notes_lookup_idx',
    domain: 'commercial',
    table: 'module_credit_notes',
    query: 'credit note ledger filtering by product/workspace/status/user',
    columns: ['product_id', 'workspace_id', 'status', 'user_id'],
  },
  {
    index: 'module_credit_notes_order_idx',
    domain: 'commercial',
    table: 'module_credit_notes',
    query: 'credit notes by order',
    columns: ['order_id'],
  },
  {
    index: 'module_credit_notes_provider_ref_uidx',
    domain: 'commercial',
    table: 'module_credit_notes',
    query: 'credit note provider event idempotency',
    columns: ['product_id', 'workspace_id', 'provider', 'provider_ref'],
    unique: true,
  },
  {
    index: 'module_credit_notes_number_uidx',
    domain: 'commercial',
    table: 'module_credit_notes',
    query: 'credit note number uniqueness by product/number',
    columns: ['product_id', 'number'],
    unique: true,
  },
  {
    index: 'module_credit_ledger_idempotency_idx',
    domain: 'commercial',
    table: 'module_credit_ledger',
    query: 'credit ledger idempotency by product/workspace/user/key',
    columns: ['product_id', 'workspace_id', 'user_id', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_subscriptions_lookup_idx',
    domain: 'commercial',
    table: 'module_subscriptions',
    query: 'subscription lookup by product/workspace/status/user',
    columns: ['product_id', 'workspace_id', 'status', 'user_id'],
  },
  {
    index: 'module_subscription_events_lookup_idx',
    domain: 'commercial',
    table: 'module_subscription_events',
    query: 'subscription event lookup by product/workspace/subscription/status',
    columns: ['product_id', 'workspace_id', 'subscription_id', 'status'],
  },
  {
    index: 'module_subscription_events_type_idx',
    domain: 'commercial',
    table: 'module_subscription_events',
    query: 'subscription event ordering by type/effective time',
    columns: ['type', 'effective_at'],
  },
  {
    index: 'module_subscription_events_idempotency_uidx',
    domain: 'commercial',
    table: 'module_subscription_events',
    query: 'subscription event idempotency by product/workspace/key',
    columns: ['product_id', 'workspace_id', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_tax_profiles_lookup_idx',
    domain: 'commercial',
    table: 'module_tax_profiles',
    query: 'tax profile lookup by product/workspace/user/status',
    columns: ['product_id', 'workspace_id', 'user_id', 'validation_status'],
  },
  {
    index: 'module_tax_profiles_scope_uidx',
    domain: 'commercial',
    table: 'module_tax_profiles',
    query: 'tax profile uniqueness by product/workspace/user',
    columns: ['product_id', 'workspace_id', 'user_id'],
    unique: true,
  },
  {
    index: 'module_revenue_buckets_lookup_idx',
    domain: 'commercial',
    table: 'module_revenue_buckets',
    query: 'revenue bucket lookup by product/workspace/date/currency',
    columns: ['product_id', 'workspace_id', 'bucket_date', 'currency'],
  },
  {
    index: 'module_revenue_buckets_scope_day_currency_uidx',
    domain: 'commercial',
    table: 'module_revenue_buckets',
    query: 'revenue bucket uniqueness by product/workspace/day/currency',
    columns: ['product_id', 'workspace_id', 'bucket_date', 'currency'],
    unique: true,
  },
  {
    index: 'module_settlement_batches_lookup_idx',
    domain: 'commercial',
    table: 'module_settlement_batches',
    query: 'settlement batch lookup by product/provider/status',
    columns: ['product_id', 'provider', 'status'],
  },
  {
    index: 'module_settlement_batches_period_idx',
    domain: 'commercial',
    table: 'module_settlement_batches',
    query: 'settlement batch period lookup',
    columns: ['period_start', 'period_end'],
  },
  {
    index: 'module_provider_invocations_lookup_idx',
    domain: 'provider',
    table: 'module_provider_invocations',
    query: 'provider invocation ledger by product/provider/status',
    columns: ['product_id', 'provider_id', 'status', 'created_at'],
  },
  {
    index: 'module_rag_sources_lookup_idx',
    domain: 'rag',
    table: 'module_rag_sources',
    query: 'RAG source lookup by product/workspace/module/status',
    columns: ['product_id', 'workspace_id', 'module_id', 'status'],
  },
  {
    index: 'module_rag_sources_digest_idx',
    domain: 'rag',
    table: 'module_rag_sources',
    query: 'RAG source digest lookup for reindex idempotency',
    columns: ['content_digest'],
  },
  {
    index: 'module_rag_chunks_lookup_idx',
    domain: 'rag',
    table: 'module_rag_chunks',
    query: 'RAG chunk lookup by source and chunk index',
    columns: ['source_id', 'chunk_index'],
  },
  {
    index: 'module_rag_chunks_module_idx',
    domain: 'rag',
    table: 'module_rag_chunks',
    query: 'RAG chunk lookup by product/workspace/module',
    columns: ['product_id', 'workspace_id', 'module_id'],
  },
  {
    index: 'module_credit_ledger_expiry_idx',
    domain: 'commercial',
    table: 'module_credit_ledger',
    query: 'credit expiry sweep by expires_at',
    columns: ['expires_at'],
  },
  {
    index: 'module_api_keys_hash_uidx',
    domain: 'identity',
    table: 'module_api_keys',
    query: 'API key hash lookup',
    columns: ['key_hash'],
    unique: true,
  },
  {
    index: 'module_api_keys_lookup_idx',
    domain: 'identity',
    table: 'module_api_keys',
    query: 'API key inventory by product/workspace/module/status',
    columns: ['product_id', 'workspace_id', 'module_id', 'status'],
  },
  {
    index: 'module_api_keys_owner_idx',
    domain: 'identity',
    table: 'module_api_keys',
    query: 'API keys by owner subject',
    columns: ['owner_subject_type', 'owner_subject_id'],
  },
  {
    index: 'module_credit_reservations_idempotency_idx',
    domain: 'commercial',
    table: 'module_credit_reservations',
    query: 'credit reservation idempotency by product/workspace/user/key',
    columns: ['product_id', 'workspace_id', 'user_id', 'idempotency_key'],
    unique: true,
  },
  {
    index: 'module_credit_reservations_lookup_idx',
    domain: 'commercial',
    table: 'module_credit_reservations',
    query: 'credit reservation lookup by product/workspace/user/status',
    columns: ['product_id', 'workspace_id', 'user_id', 'status'],
  },
  {
    index: 'module_credit_reservations_source_idx',
    domain: 'commercial',
    table: 'module_credit_reservations',
    query: 'credit reservations by source',
    columns: ['source', 'source_id'],
  },
  {
    index: 'module_risk_events_lookup_idx',
    domain: 'risk',
    table: 'module_risk_events',
    query: 'risk event lookup by product/workspace/module/subject/type',
    columns: ['product_id', 'workspace_id', 'module_id', 'subject_type', 'subject_id', 'type'],
  },
  {
    index: 'module_risk_blocks_scope_uidx',
    domain: 'risk',
    table: 'module_risk_blocks',
    query: 'risk block uniqueness by product/workspace/subject/scope',
    columns: ['product_id', 'workspace_id', 'subject_type', 'subject_id', 'scope'],
    unique: true,
  },
  {
    index: 'module_risk_blocks_lookup_idx',
    domain: 'risk',
    table: 'module_risk_blocks',
    query: 'risk block lookup by product/workspace/subject',
    columns: ['product_id', 'workspace_id', 'subject_type', 'subject_id'],
  },
] as const;

const REQUIRED_INDEXES = RUNTIME_STORE_REQUIRED_INDEXES.map((entry) => entry.index);

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export function readRuntimeStoreMigrations(): RuntimeStoreMigrationFile[] {
  return fs
    .readdirSync(RUNTIME_STORE_MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => {
      const sql = fs.readFileSync(path.join(RUNTIME_STORE_MIGRATIONS_DIR, file), 'utf8');
      return {
        id: file.replace(/\.sql$/, ''),
        filename: file,
        checksum: checksum(sql),
        sql,
      };
    });
}

export function readRuntimeStoreMigrationSql(): string[] {
  return readRuntimeStoreMigrations().map((migration) => migration.sql);
}

async function ensureMigrationJournal(database: ModuleDataPostgresExecutor): Promise<void> {
  await database.query(`
    create table if not exists module_runtime_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz,
      duration_ms integer,
      status text not null,
      environment text,
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

async function readMigrationJournal(
  database: ModuleDataPostgresExecutor
): Promise<Map<string, RuntimeStoreMigrationJournalRecord>> {
  await ensureMigrationJournal(database);
  const result = await database.query<{
    id: string;
    checksum: string;
    applied_at?: Date | string | null;
    duration_ms?: number | null;
    status: RuntimeStoreMigrationJournalRecord['status'];
    environment?: string | null;
    error?: string | null;
  }>(`select * from module_runtime_migrations`);
  return new Map(
    result.rows.map((row) => [
      row.id,
      {
        id: row.id,
        checksum: row.checksum,
        appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : undefined,
        durationMs: row.duration_ms ?? undefined,
        status: row.status,
        environment: row.environment ?? undefined,
        error: row.error ?? undefined,
      },
    ])
  );
}

async function listMissingRequiredTables(database: ModuleDataPostgresExecutor): Promise<string[]> {
  const result = await database.query<{ table_name: string }>(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_name = any($1::text[])`,
    [RUNTIME_STORE_REQUIRED_TABLES]
  );
  const existing = new Set(result.rows.map((row) => row.table_name));
  return RUNTIME_STORE_REQUIRED_TABLES.filter((table) => !existing.has(table));
}

async function listMissingRequiredColumns(database: ModuleDataPostgresExecutor): Promise<string[]> {
  const columnRows = await database.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = any($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)]
  );
  const columnsByTable = new Map<string, Set<string>>();
  for (const row of columnRows.rows) {
    const columns = columnsByTable.get(row.table_name) ?? new Set<string>();
    columns.add(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }
  return Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) => {
    const actual = columnsByTable.get(table) ?? new Set<string>();
    return columns.filter((column) => !actual.has(column)).map((column) => `${table}.${column}`);
  });
}

async function listMissingRequiredIndexes(database: ModuleDataPostgresExecutor): Promise<string[]> {
  const indexRows = await database.query<{ indexname: string }>(
    `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`,
    [REQUIRED_INDEXES]
  );
  const indexes = new Set(indexRows.rows.map((row) => row.indexname));
  return REQUIRED_INDEXES.filter((index) => !indexes.has(index));
}

function buildRuntimeStoreIndexAudit(indexIssues: readonly string[]): RuntimeStoreIndexAudit {
  const missingIndexes = new Set(indexIssues);
  const missing = RUNTIME_STORE_REQUIRED_INDEXES.filter((entry) => missingIndexes.has(entry.index));
  const domains = RUNTIME_STORE_REQUIRED_INDEXES.reduce<
    Record<string, { required: number; present: number }>
  >((acc, entry) => {
    const current = acc[entry.domain] ?? { required: 0, present: 0 };
    current.required += 1;
    if (!missingIndexes.has(entry.index)) {
      current.present += 1;
    }
    acc[entry.domain] = current;
    return acc;
  }, {});

  return {
    required: RUNTIME_STORE_REQUIRED_INDEXES.length,
    present: RUNTIME_STORE_REQUIRED_INDEXES.length - missing.length,
    missing,
    domains,
  };
}

export async function applyRuntimeStoreMigration(
  database: ModuleDataPostgresExecutor
): Promise<void> {
  await database.query(`select pg_advisory_lock(hashtext('ploykit_runtime_migrations'))`);
  try {
    await ensureMigrationJournal(database);
    const journal = await readMigrationJournal(database);
    const missingTables = await listMissingRequiredTables(database);
    const missingColumns = await listMissingRequiredColumns(database);
    const missingIndexes = await listMissingRequiredIndexes(database);
    const forceApply =
      missingTables.some((table) => table !== 'module_runtime_migrations') ||
      missingColumns.length > 0 ||
      missingIndexes.length > 0;
    for (const migration of readRuntimeStoreMigrations()) {
      const existing = journal.get(migration.id);
      if (existing?.status === 'applied' && existing.checksum !== migration.checksum) {
        throw new Error(
          `RUNTIME_MIGRATION_CHECKSUM_DRIFT: ${migration.id} expected ${existing.checksum}, got ${migration.checksum}`
        );
      }
      if (existing?.status === 'applied' && !forceApply) {
        continue;
      }

      const startedAt = Date.now();
      await database.query(
        `insert into module_runtime_migrations (id, checksum, status, environment)
         values ($1, $2, 'running', $3)
         on conflict (id)
         do update set checksum = excluded.checksum, status = 'running', error = null, updated_at = now()`,
        [migration.id, migration.checksum, process.env.NODE_ENV ?? 'development']
      );

      try {
        await database.query(migration.sql);
        await database.query(
          `update module_runtime_migrations
           set status = 'applied',
               applied_at = now(),
               duration_ms = $2,
               error = null,
               updated_at = now()
           where id = $1`,
          [migration.id, Date.now() - startedAt]
        );
      } catch (error) {
        await database.query(
          `update module_runtime_migrations
           set status = 'failed',
               duration_ms = $2,
               error = $3,
               updated_at = now()
           where id = $1`,
          [
            migration.id,
            Date.now() - startedAt,
            error instanceof Error ? error.message : String(error),
          ]
        );
        throw error;
      }
    }
  } finally {
    await database.query(`select pg_advisory_unlock(hashtext('ploykit_runtime_migrations'))`);
  }
}

export async function verifyRuntimeStoreSchema(
  database: ModuleDataPostgresExecutor
): Promise<RuntimeStoreSchemaVerification> {
  const migrations = readRuntimeStoreMigrations();
  await ensureMigrationJournal(database);
  const missing = await listMissingRequiredTables(database);
  const columnIssues = await listMissingRequiredColumns(database);
  const indexIssues = await listMissingRequiredIndexes(database);
  const indexAudit = buildRuntimeStoreIndexAudit(indexIssues);

  const journal = await readMigrationJournal(database);
  const migrationIssues = migrations.flatMap((migration) => {
    const record = journal.get(migration.id);
    if (!record) {
      return [`${migration.id}:missing`];
    }
    if (record.status !== 'applied') {
      return [`${migration.id}:${record.status}`];
    }
    if (record.checksum !== migration.checksum) {
      return [`${migration.id}:checksum`];
    }
    return [];
  });

  return {
    ok:
      missing.length === 0 &&
      columnIssues.length === 0 &&
      indexIssues.length === 0 &&
      migrationIssues.length === 0,
    missing,
    columnIssues,
    indexIssues,
    indexAudit,
    migrationIssues,
    migrations: {
      expected: migrations.length,
      applied: [...journal.values()].filter((record) => record.status === 'applied').length,
    },
  };
}

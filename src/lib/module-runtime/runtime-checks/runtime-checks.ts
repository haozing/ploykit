import type { LoadRuntimeConfigResult } from '../../runtime-config';
import type { ModuleDataPostgresExecutor } from '../data';
import type { ModuleMapHealthReport } from '../loader';
import type { RuntimeStore } from '../stores';
import { verifyRuntimeStoreSchema } from '../stores';

export interface RuntimeCheckStorageAdapter {
  createSignedUrl(input: {
    key: string;
    operation: 'read' | 'write';
    expiresInSeconds: number;
  }): Promise<string>;
}

export interface RuntimeCheckDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
  fix?: string;
}

export interface RuntimeChecksResult {
  ok: boolean;
  diagnostics: RuntimeCheckDiagnostic[];
  checkedAt: string;
  status: RuntimeChecksStatus;
}

export type RuntimeChecksStatusValue =
  | string
  | number
  | boolean
  | null
  | readonly RuntimeChecksStatusValue[]
  | { readonly [key: string]: RuntimeChecksStatusValue };

export type RuntimeChecksStatus = Record<string, RuntimeChecksStatusValue>;

export interface RunRuntimeChecksInput {
  config?: LoadRuntimeConfigResult;
  database?: ModuleDataPostgresExecutor;
  store?: RuntimeStore;
  productId?: string;
  storage?: RuntimeCheckStorageAdapter;
  moduleMapHealth?: ModuleMapHealthReport;
  moduleMapFresh?: boolean;
  catalogFresh?: boolean;
  webhookSecretsConfigured?: boolean;
  billingProviderConfigured?: boolean;
  status?: RuntimeChecksStatus;
  environment?: string;
  now?: () => Date;
}

function diagnostic(
  code: string,
  message: string,
  path: string,
  fix?: string,
  severity: RuntimeCheckDiagnostic['severity'] = 'error'
): RuntimeCheckDiagnostic {
  return { severity, code, message, path, fix };
}

function isStatusRecord(value: RuntimeChecksStatusValue | undefined): value is RuntimeChecksStatus {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function runRuntimeChecks(input: RunRuntimeChecksInput): Promise<RuntimeChecksResult> {
  const diagnostics: RuntimeCheckDiagnostic[] = [];
  const now = input.now ?? (() => new Date());
  const environment = input.environment ?? process.env.NODE_ENV ?? 'development';
  const status = input.status ?? {};

  for (const item of input.config?.diagnostics ?? []) {
    diagnostics.push({
      severity: item.severity,
      code: item.code,
      message: item.message,
      path: item.path,
      fix: item.fix,
    });
  }

  if (input.database) {
    const schema = await verifyRuntimeStoreSchema(input.database);
    for (const table of schema.missing) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_SCHEMA_TABLE_MISSING',
          `Runtime store table is missing: ${table}.`,
          `database.${table}`,
          'Run npm run runtime:stores:migrate.'
        )
      );
    }
    for (const column of schema.columnIssues) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_SCHEMA_COLUMN_MISSING',
          `Runtime store column is missing: ${column}.`,
          `database.${column}`,
          'Run npm run runtime:stores:migrate.'
        )
      );
    }
    for (const index of schema.indexIssues) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_SCHEMA_INDEX_MISSING',
          `Runtime store index is missing: ${index}.`,
          `database.indexes.${index}`,
          'Run npm run runtime:stores:migrate.',
          'warning'
        )
      );
    }
    for (const migration of schema.migrationIssues) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_MIGRATION_JOURNAL_DRIFT',
          `Runtime migration journal issue: ${migration}.`,
          `database.migrations.${migration}`,
          'Review migration checksum/status and rerun runtime store migrations.'
        )
      );
    }
    status.runtimeMigrations = schema.migrations;
  }

  const storeStatus = isStatusRecord(status.store) ? status.store : null;
  if (storeStatus?.durable === false && environment !== 'test') {
    const severity = environment === 'production' ? 'error' : 'warning';
    diagnostics.push(
      diagnostic(
        'RUNTIME_STORE_MEMORY_MODE',
        severity === 'error'
          ? 'Host runtime store is running in memory mode and cannot be used in production.'
          : 'Host runtime store is running in memory mode and is not durable.',
        'store.mode',
        'Set DATABASE_URL or PLOYKIT_RUNTIME_STORE=postgres for product environments.',
        severity
      )
    );
  }

  if (input.store && input.productId) {
    const lagging = await input.store.listOutbox({ productId: input.productId, status: 'failed' });
    const deadLetters = await input.store.listOutbox({
      productId: input.productId,
      status: 'dead_letter',
    });
    if (lagging.length > 0) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_QUEUE_FAILED_MESSAGES',
          `${lagging.length} outbox message(s) are failed.`,
          'outbox.failed',
          'Drain workers or replay failed messages.',
          'warning'
        )
      );
    }
    if (deadLetters.length > 0) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_QUEUE_DEAD_LETTERS',
          `${deadLetters.length} outbox message(s) are dead-lettered.`,
          'outbox.dead_letter',
          'Inspect, replay, or discard dead letters.'
        )
      );
    }
  }

  if (input.storage) {
    try {
      await input.storage.createSignedUrl({
        key: 'runtime-checks/probe',
        operation: 'read',
        expiresInSeconds: 60,
      });
    } catch (error) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_STORAGE_UNAVAILABLE',
          error instanceof Error ? error.message : String(error),
          'storage',
          'Verify storage adapter credentials and endpoint.'
        )
      );
    }
  }

  if (input.moduleMapHealth && !input.moduleMapHealth.ok) {
    for (const issue of input.moduleMapHealth.issues) {
      diagnostics.push(
        diagnostic(
          'RUNTIME_MODULE_MAP_DRIFT',
          issue.message,
          `module-map.${issue.moduleId}.${issue.kind}`,
          'Run npm run modules:scan.'
        )
      );
    }
  } else if (input.moduleMapFresh === false) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_MODULE_MAP_DRIFT',
        'Module map is not up to date.',
        'module-map',
        'Run npm run modules:scan.'
      )
    );
  }

  if (input.catalogFresh === false) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_CATALOG_DRIFT',
        'App catalog state has drifted from the declared bundle.',
        'catalog',
        'Run npm run catalog:plan and apply the expected catalog state.'
      )
    );
  }

  if (input.webhookSecretsConfigured === false) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_WEBHOOK_SECRET_MISSING',
        'One or more signed webhooks are missing secrets.',
        'webhooks',
        'Configure webhook secrets in the host secret store.'
      )
    );
  }

  if (input.billingProviderConfigured === false) {
    diagnostics.push(
      diagnostic(
        'RUNTIME_BILLING_PROVIDER_MISSING',
        'Billing provider is not configured.',
        'billing.provider',
        'Configure the billing provider before enabling paid modules.',
        'warning'
      )
    );
  }

  return {
    ok: diagnostics.every((item) => item.severity !== 'error'),
    diagnostics,
    checkedAt: now().toISOString(),
    status,
  };
}

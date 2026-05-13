/**
 * Row Level Security validation helpers.
 *
 * Runtime checks use these functions to ensure high-risk user data tables
 * have RLS enabled, forced, and backed by user isolation policies.
 */

import { sql } from 'drizzle-orm';
import { db } from './client.server';
import { pluginModels } from './schema/plugin-models';
import { logger } from '@/lib/_core/logger';

/**
 * Normalize Drizzle execute() results across postgres.js and Neon drivers.
 */
function normalizeExecuteResult<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }

  return [];
}

export interface RLSPolicy {
  name: string;
  command: string;
  qual: string;
  withCheck?: string;
}

export interface RLSStatus {
  table: string;
  rlsEnabled: boolean;
  rlsForced: boolean;
  policies: RLSPolicy[];
}

export interface RLSRequirement {
  table: string;
  isolationColumns?: string[];
  requireForce?: boolean;
}

export type RLSRequirementInput = string | RLSRequirement;

export interface RLSValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalTables: number;
    rlsEnabledTables: number;
    rlsForcedTables: number;
    totalPolicies: number;
  };
}

export interface PluginModelRLSValidationResult extends RLSValidationResult {
  models: Array<{
    pluginId: string;
    modelName: string;
    tableName: string;
    metadataRlsEnabled: boolean;
    actualRlsEnabled: boolean;
    actualRlsForced: boolean;
    policyCount: number;
  }>;
}

export const DEFAULT_RLS_REQUIREMENTS: RLSRequirement[] = [
  { table: 'files', isolationColumns: ['user_id'], requireForce: true },
  { table: 'user_profiles', isolationColumns: ['user_id'], requireForce: true },
  { table: 'user_entitlements', isolationColumns: ['user_id'], requireForce: true },
  { table: 'usage_history', isolationColumns: ['user_id'], requireForce: true },
  { table: 'plugin_settings', isolationColumns: ['user_id'], requireForce: true },
  { table: 'plugin_collections', isolationColumns: ['plugin_id'], requireForce: true },
  { table: 'plugin_records', isolationColumns: ['plugin_id', 'user_id'], requireForce: true },
  { table: 'plugin_config', isolationColumns: ['plugin_id', 'user_id'], requireForce: true },
  { table: 'plugin_secrets', isolationColumns: ['plugin_id', 'user_id'], requireForce: true },
  { table: 'plugin_job_runs', isolationColumns: ['plugin_id'], requireForce: true },
  { table: 'orders', isolationColumns: ['user_id'], requireForce: true },
  { table: 'billing_invoices', isolationColumns: ['user_id'], requireForce: true },
  { table: 'billing_payment_methods', isolationColumns: ['user_id'], requireForce: true },
  { table: 'billing_tax_profiles', isolationColumns: ['user_id'], requireForce: true },
  { table: 'credit_logs', isolationColumns: ['user_id'], requireForce: true },
  { table: 'notifications', isolationColumns: ['user_id'], requireForce: true },
];

export const RLS_PROTECTED_TABLES = DEFAULT_RLS_REQUIREMENTS.map(
  (requirement) => requirement.table
);

function normalizeRequirement(requirement: RLSRequirementInput): RLSRequirement {
  if (typeof requirement === 'string') {
    return {
      table: requirement,
      isolationColumns: ['user_id'],
      requireForce: true,
    };
  }

  return {
    isolationColumns: ['user_id'],
    requireForce: true,
    ...requirement,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function policyReferencesColumn(policy: RLSPolicy, column: string): boolean {
  const policyText = `${policy.qual ?? ''} ${policy.withCheck ?? ''}`.toLowerCase();
  return new RegExp(`\\b${escapeRegExp(column.toLowerCase())}\\b`).test(policyText);
}

function hasIsolationPolicy(status: RLSStatus, isolationColumns: string[]): boolean {
  return status.policies.some((policy) =>
    isolationColumns.every((column) => policyReferencesColumn(policy, column))
  );
}

/**
 * Validate an in-memory RLS status snapshot.
 *
 * This pure function is intentionally exported so tests can cover policy
 * semantics without a live database connection.
 */
export function validateRLSStatuses(
  statuses: RLSStatus[],
  requiredTables: RLSRequirementInput[] = DEFAULT_RLS_REQUIREMENTS
): RLSValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const requirements = requiredTables.map(normalizeRequirement);

  for (const requirement of requirements) {
    const status = statuses.find((item) => item.table === requirement.table);

    if (!status) {
      errors.push(`Table "${requirement.table}" not found in database`);
      continue;
    }

    if (!status.rlsEnabled) {
      errors.push(`RLS not enabled on table "${requirement.table}"`);
    }

    if (requirement.requireForce && !status.rlsForced) {
      errors.push(`RLS not forced on table "${requirement.table}"`);
    }

    if (status.policies.length === 0) {
      errors.push(`No RLS policies defined for table "${requirement.table}"`);
      continue;
    }

    const isolationColumns = requirement.isolationColumns ?? ['user_id'];
    if (!hasIsolationPolicy(status, isolationColumns)) {
      errors.push(
        `Table "${requirement.table}" has no RLS policy referencing ${isolationColumns.join(', ')}`
      );
    }

    const hasLegacyTenantPolicy = status.policies.some((policy) =>
      policyReferencesColumn(policy, 'tenant_id')
    );

    if (hasLegacyTenantPolicy) {
      warnings.push(
        `Table "${requirement.table}" still references deprecated tenant_id in an RLS policy`
      );
    }
  }

  const summary = {
    totalTables: statuses.length,
    rlsEnabledTables: statuses.filter((status) => status.rlsEnabled).length,
    rlsForcedTables: statuses.filter((status) => status.rlsForced).length,
    totalPolicies: statuses.reduce((sum, status) => sum + status.policies.length, 0),
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

/**
 * Check all tables in a schema for RLS status and policy metadata.
 */
export async function checkRLSStatus(schemaName = 'public'): Promise<RLSStatus[]> {
  try {
    type TableRow = {
      tablename: string;
      rls_enabled: boolean;
      rls_forced: boolean;
    };

    const tablesResult = await db.execute(sql`
      SELECT
        c.relname AS tablename,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${schemaName}
        AND c.relkind IN ('r', 'p')
      ORDER BY c.relname
    `);

    const tables = normalizeExecuteResult<TableRow>(tablesResult);
    const statuses: RLSStatus[] = [];

    type PolicyRow = {
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    };

    for (const table of tables) {
      const policiesResult = await db.execute(sql`
        SELECT
          policyname,
          cmd,
          qual,
          with_check
        FROM pg_policies
        WHERE schemaname = ${schemaName} AND tablename = ${table.tablename}
        ORDER BY policyname
      `);

      const policies = normalizeExecuteResult<PolicyRow>(policiesResult);

      statuses.push({
        table: table.tablename,
        rlsEnabled: table.rls_enabled,
        rlsForced: table.rls_forced,
        policies: policies.map((policy) => ({
          name: policy.policyname,
          command: policy.cmd,
          qual: policy.qual || '',
          withCheck: policy.with_check || undefined,
        })),
      });
    }

    logger.debug({ schemaName, tableCount: statuses.length }, 'RLS status check completed');

    return statuses;
  } catch (error) {
    logger.error({ schemaName, error }, 'Failed to check RLS status');
    throw error;
  }
}

/**
 * Validate configured required tables against live database RLS metadata.
 */
export async function validateRLSConfiguration(
  requiredTables: RLSRequirementInput[] = DEFAULT_RLS_REQUIREMENTS
): Promise<RLSValidationResult> {
  try {
    const statuses = await checkRLSStatus();
    const result = validateRLSStatuses(statuses, requiredTables);

    if (!result.valid) {
      logger.error(
        { errors: result.errors, warnings: result.warnings, summary: result.summary },
        'RLS configuration validation failed'
      );
    } else if (result.warnings.length > 0) {
      logger.warn(
        { warnings: result.warnings, summary: result.summary },
        'RLS configuration validation passed with warnings'
      );
    } else {
      logger.info({ summary: result.summary }, 'RLS configuration validation passed');
    }

    return result;
  } catch (error) {
    logger.error({ error }, 'RLS validation check failed');
    return {
      valid: false,
      errors: [
        `Validation check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ],
      warnings: [],
      summary: {
        totalTables: 0,
        rlsEnabledTables: 0,
        rlsForcedTables: 0,
        totalPolicies: 0,
      },
    };
  }
}

/**
 * Validate plugin model metadata against the real dynamic tables.
 */
export async function validatePluginModelRLS(
  schemaName = 'public'
): Promise<PluginModelRLSValidationResult> {
  try {
    const statuses = await checkRLSStatus(schemaName);
    const models = await db
      .select({
        pluginId: pluginModels.pluginId,
        modelName: pluginModels.modelName,
        tableName: pluginModels.tableName,
        rlsEnabled: pluginModels.rlsEnabled,
      })
      .from(pluginModels);

    const requirements = models.map((model) => ({
      table: model.tableName,
      isolationColumns: ['user_id'],
      requireForce: true,
    }));

    const result = validateRLSStatuses(statuses, requirements);
    const metadataErrors = models
      .filter((model) => !model.rlsEnabled)
      .map((model) => `Plugin model metadata marks RLS disabled for "${model.tableName}"`);

    const modelSummaries = models.map((model) => {
      const status = statuses.find((item) => item.table === model.tableName);
      return {
        pluginId: model.pluginId,
        modelName: model.modelName,
        tableName: model.tableName,
        metadataRlsEnabled: model.rlsEnabled,
        actualRlsEnabled: status?.rlsEnabled ?? false,
        actualRlsForced: status?.rlsForced ?? false,
        policyCount: status?.policies.length ?? 0,
      };
    });

    const errors = [...result.errors, ...metadataErrors];

    return {
      ...result,
      valid: errors.length === 0,
      errors,
      models: modelSummaries,
    };
  } catch (error) {
    logger.error({ error }, 'Plugin model RLS validation failed');
    return {
      valid: false,
      errors: [
        `Plugin model RLS validation failed: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      ],
      warnings: [],
      summary: {
        totalTables: 0,
        rlsEnabledTables: 0,
        rlsForcedTables: 0,
        totalPolicies: 0,
      },
      models: [],
    };
  }
}

export async function getTableRLSStatus(
  tableName: string,
  schemaName = 'public'
): Promise<RLSStatus | null> {
  const statuses = await checkRLSStatus(schemaName);
  return statuses.find((status) => status.table === tableName) || null;
}

export async function generateRLSReport(): Promise<string> {
  const statuses = await checkRLSStatus();
  const validation = validateRLSStatuses(statuses);

  const lines: string[] = [
    'PostgreSQL Row Level Security (RLS) Configuration Report',
    '',
    'Summary:',
    `  Total Tables: ${validation.summary.totalTables}`,
    `  RLS Enabled Tables: ${validation.summary.rlsEnabledTables}`,
    `  RLS Forced Tables: ${validation.summary.rlsForcedTables}`,
    `  Total Policies: ${validation.summary.totalPolicies}`,
    `  Validation Status: ${validation.valid ? 'PASSED' : 'FAILED'}`,
    '',
  ];

  if (validation.errors.length > 0) {
    lines.push('Errors:');
    for (const error of validation.errors) {
      lines.push(`  ${error}`);
    }
    lines.push('');
  }

  if (validation.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of validation.warnings) {
      lines.push(`  ${warning}`);
    }
    lines.push('');
  }

  lines.push('Table Details:');

  for (const status of statuses) {
    lines.push(`  ${status.table}`);
    lines.push(`    RLS Enabled: ${status.rlsEnabled}`);
    lines.push(`    RLS Forced: ${status.rlsForced}`);
    lines.push(`    Policies: ${status.policies.length}`);

    for (const policy of status.policies) {
      lines.push(`      - ${policy.name} (${policy.command})`);
      lines.push(`        USING: ${policy.qual || 'N/A'}`);
      if (policy.withCheck) {
        lines.push(`        WITH CHECK: ${policy.withCheck}`);
      }
    }
  }

  return lines.join('\n');
}

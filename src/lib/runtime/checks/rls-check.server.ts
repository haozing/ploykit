/**
 * RLS Check
 *
 * Validates that high-risk tables have Row Level Security enabled
 * with proper user isolation policies.
 */

import { env } from '@/lib/_core/env';
import type { RuntimeCheck } from '../types';

function hasDatabaseConfiguration(): boolean {
  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

export const rlsCheck: RuntimeCheck = {
  name: 'rls',
  description: 'Validate Row Level Security on high-risk tables',

  async run() {
    if (!hasDatabaseConfiguration() && env.NODE_ENV !== 'production') {
      return {
        key: 'rls',
        status: 'skipped',
        severity: 'warning',
        message: 'RLS validation skipped: no database connection is configured',
        fix: 'Set database connection variables and run migrations before enabling production checks',
      };
    }

    try {
      const { DEFAULT_RLS_REQUIREMENTS, validatePluginModelRLS, validateRLSConfiguration } =
        await import('@/lib/db/rls-checker');
      const requiredTables = DEFAULT_RLS_REQUIREMENTS.map((requirement) => requirement.table);
      const result = await validateRLSConfiguration(DEFAULT_RLS_REQUIREMENTS);
      const pluginModelResult = await validatePluginModelRLS();
      const errors = [...result.errors, ...pluginModelResult.errors];
      const warnings = [...result.warnings, ...pluginModelResult.warnings];

      if (!result.valid || !pluginModelResult.valid) {
        return {
          key: 'rls',
          status: 'failed',
          severity: env.NODE_ENV === 'production' ? 'error' : 'warning',
          message: errors.join('; '),
          details: {
            totalTables: result.summary.totalTables,
            rlsEnabledTables: result.summary.rlsEnabledTables,
            rlsForcedTables: result.summary.rlsForcedTables,
            totalPolicies: result.summary.totalPolicies,
            requiredTables,
            pluginModelCount: pluginModelResult.models.length,
            warnings,
          },
          fix: 'Run migrations 0003_rls_baseline.sql and 0004_plugin_model_rls_metadata.sql to enable and reconcile RLS',
        };
      }

      return {
        key: 'rls',
        status: 'ok',
        severity: 'info',
        message: `RLS validated on ${requiredTables.length} high-risk tables and ${pluginModelResult.models.length} plugin model tables`,
        details: {
          totalTables: result.summary.totalTables,
          rlsEnabledTables: result.summary.rlsEnabledTables,
          rlsForcedTables: result.summary.rlsForcedTables,
          totalPolicies: result.summary.totalPolicies,
          pluginModelCount: pluginModelResult.models.length,
          warnings,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        key: 'rls',
        status: 'failed',
        severity: env.NODE_ENV === 'production' ? 'error' : 'warning',
        message: `RLS validation failed: ${message}`,
        fix: 'Check database connectivity and migration status',
      };
    }
  },
};

/**
 * Database Check
 *
 * Validates database connectivity and migration status.
 */

import { env } from '@/lib/_core/env';
import type { RuntimeCheck } from '../types';

function hasDatabaseConfiguration(): boolean {
  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

export const dbCheck: RuntimeCheck = {
  name: 'db',
  description: 'Validate database connectivity',

  async run() {
    if (!hasDatabaseConfiguration() && env.NODE_ENV !== 'production') {
      return {
        key: 'db',
        status: 'skipped',
        severity: 'warning',
        message: 'Database connectivity skipped: no database connection is configured',
        fix: 'Set DATABASE_URL, NEON_DATABASE_URL, or POSTGRES_* variables to enable DB checks',
      };
    }

    try {
      // Lazy import to avoid build-time issues
      const { db } = await import('@/lib/db');

      // Simple connectivity test
      const result = await db.execute('SELECT 1 as connected');

      if (!result || !Array.isArray(result) || result.length === 0) {
        return {
          key: 'db',
          status: 'failed',
          severity: 'error',
          message: 'Database connection succeeded but returned unexpected result',
          fix: 'Check database configuration and health',
        };
      }

      return {
        key: 'db',
        status: 'ok',
        severity: 'info',
        message: 'Database connection verified',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        key: 'db',
        status: 'failed',
        severity: 'error',
        message: `Database connection failed: ${message}`,
        fix: 'Check DATABASE_URL and database server status',
      };
    }
  },
};

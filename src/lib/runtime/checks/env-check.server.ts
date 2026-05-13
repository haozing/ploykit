/**
 * Environment Check
 *
 * Validates required environment variables and secrets.
 */

import { env } from '@/lib/_core/env';
import type { RuntimeCheck } from '../types';

export const envCheck: RuntimeCheck = {
  name: 'env',
  description: 'Validate required environment variables',

  run() {
    const issues: string[] = [];

    // Production-only hard checks
    if (env.NODE_ENV === 'production') {
      const authSecret = env.BETTER_AUTH_SECRET || env.AUTH_SECRET;
      if (!authSecret) {
        issues.push('BETTER_AUTH_SECRET or AUTH_SECRET is required in production');
      } else if (authSecret.length < 32) {
        issues.push('Auth secret must be at least 32 characters long');
      }

      if (!env.BETTER_AUTH_URL) {
        issues.push('BETTER_AUTH_URL is required in production');
      }
    }

    // Feature-gated checks
    if (env.BILLING_ENABLED === 'true') {
      if (!env.STRIPE_SECRET_KEY) {
        issues.push('STRIPE_SECRET_KEY is required when BILLING_ENABLED=true');
      }
      if (!env.STRIPE_WEBHOOK_SECRET) {
        issues.push('STRIPE_WEBHOOK_SECRET is required when BILLING_ENABLED=true');
      }
    }

    if (env.FILE_STORAGE_ENABLED === 'true') {
      const driver = env.FILE_STORAGE_DRIVER;
      if (!driver) {
        issues.push('FILE_STORAGE_DRIVER is required when FILE_STORAGE_ENABLED=true');
      }
      if (driver === 'local' && !env.FILE_STORAGE_LOCAL_ROOT) {
        issues.push('FILE_STORAGE_LOCAL_ROOT is required when FILE_STORAGE_DRIVER=local');
      }
      if (driver === 's3' || driver === 'r2') {
        const missing = [
          ['FILE_STORAGE_ENDPOINT', env.FILE_STORAGE_ENDPOINT],
          ['FILE_STORAGE_BUCKET', env.FILE_STORAGE_BUCKET],
          ['FILE_STORAGE_ACCESS_KEY_ID', env.FILE_STORAGE_ACCESS_KEY_ID],
          ['FILE_STORAGE_SECRET_ACCESS_KEY', env.FILE_STORAGE_SECRET_ACCESS_KEY],
        ]
          .filter(([, value]) => !value)
          .map(([key]) => key);

        if (missing.length > 0) {
          issues.push(`${missing.join(', ')} required when FILE_STORAGE_DRIVER=${driver}`);
        }
      }
    }

    if (issues.length > 0) {
      return {
        key: 'env',
        status: 'failed',
        severity: env.NODE_ENV === 'production' ? 'error' : 'warning',
        message: issues.join('; '),
        fix: 'Check your .env file and ensure all required variables are set',
      };
    }

    return {
      key: 'env',
      status: 'ok',
      severity: 'info',
      message: 'Environment variables validated',
    };
  },
};

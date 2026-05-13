/**
 *
 */

import { env } from '@/lib/_core/env';
import { logger } from '@/lib/_core/logger';
import { ConfigurationError, UnsupportedProviderError } from '@/lib/_core/errors';

export type DatabaseProvider = 'postgres' | 'neon' | 'supabase';

export interface DatabaseConfig {
  provider: DatabaseProvider;
  connectionString: string;
  options?: {
    prepare?: boolean;
    max?: number;
    idle_timeout?: number; // Idle timeout in seconds (postgres.js format)
    connection_timeout?: number; // Alternative connection timeout parameter
    max_lifetime?: number; // Maximum connection lifetime in seconds
    connect_timeout?: number;
    ssl?: boolean | { rejectUnauthorized: boolean };
  };
}

/**
 */
export function getDatabaseConfig(): DatabaseConfig {
  const provider = env.DB_PROVIDER;

  switch (provider) {
    case 'postgres': {
      // PostgreSQL
      const url = env.DATABASE_URL || buildPostgresUrl();

      return {
        provider: 'postgres',
        connectionString: url,
        options: {
          max: env.DB_POOL_SIZE,
          idle_timeout: env.DB_IDLE_TIMEOUT, // Use idle_timeout (postgres.js format)
          connect_timeout: 60, // Increased timeout for better reliability
          connection_timeout: 60, // Alternative timeout parameter
          max_lifetime: 60 * 30, // 30 minutes - refresh connections periodically
          ssl: false,
        },
      };
    }

    case 'neon': {
      // Neon Serverless PostgreSQL
      if (!env.NEON_DATABASE_URL) {
        throw new ConfigurationError('NEON_DATABASE_URL is required when DB_PROVIDER=neon', {
          provider: 'neon',
        });
      }

      return {
        provider: 'neon',
        connectionString: env.NEON_DATABASE_URL,
      };
    }

    case 'supabase': {
      // Supabase PostgreSQL (Session Mode - port 5432)
      if (!env.DATABASE_URL) {
        throw new ConfigurationError('DATABASE_URL is required when DB_PROVIDER=supabase', {
          provider: 'supabase',
        });
      }

      return {
        provider: 'supabase',
        connectionString: env.DATABASE_URL,
        options: {
          prepare: true, // Session Mode supports prepared statements
          max: env.DB_POOL_SIZE,
          idle_timeout: env.DB_IDLE_TIMEOUT, // Use idle_timeout (postgres.js format)
          connect_timeout: 60, // Increased from 30 to 60 seconds for Supabase pooler
          connection_timeout: 60, // Alternative timeout parameter
          max_lifetime: 60 * 30, // 30 minutes - refresh connections periodically
          ssl: { rejectUnauthorized: false }, // Supabase uses SSL
        },
      };
    }

    default:
      throw new UnsupportedProviderError(provider, ['postgres', 'neon', 'supabase']);
  }
}

/**
 * Get database migration URL
 *
 * Session Mode (port 5432) supports all PostgreSQL features including migrations
 */
export function getMigrationUrl(): string {
  const provider = env.DB_PROVIDER;

  switch (provider) {
    case 'supabase':
      // Session Mode supports migrations
      return env.DATABASE_URL || '';

    case 'postgres':
    case 'neon':
      return env.DATABASE_URL || env.NEON_DATABASE_URL || '';

    default:
      return '';
  }
}

/**
 */
function buildPostgresUrl(): string {
  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || 5432;
  const database = env.POSTGRES_DB || 'plugin_platform';
  const user = env.POSTGRES_USER || 'postgres';
  const password = env.POSTGRES_PASSWORD || 'postgres';

  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

/**
 */
export function validateDatabaseConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const provider = env.DB_PROVIDER;

  switch (provider) {
    case 'supabase':
      if (!env.DATABASE_URL) {
        errors.push('DATABASE_URL is required for Supabase');
      }
      break;

    case 'neon':
      if (!env.NEON_DATABASE_URL) {
        errors.push('NEON_DATABASE_URL is required for Neon');
      }
      break;

    case 'postgres':
      if (!env.DATABASE_URL && !env.POSTGRES_HOST) {
        errors.push('DATABASE_URL or POSTGRES_* variables required for PostgreSQL');
      }
      break;

    default:
      errors.push(`Unknown DB_PROVIDER: ${provider}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 */
export function logDatabaseConfig(): void {
  const config = getDatabaseConfig();

  // Password
  const safeUrl = config.connectionString.replace(/:([^@]+)@/, ':****@');

  logger.info(
    {
      provider: config.provider,
      url: safeUrl,
      options: config.options || 'default',
    },
    'Database configuration'
  );
}

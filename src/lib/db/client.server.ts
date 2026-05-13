/**
 *
 *
 * - Neon: uses @neondatabase/serverless (HTTP driver)
 * - Supabase: uses postgres.js (note: prepare: false)
 */

import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { neon } from '@neondatabase/serverless';
import pRetry from 'p-retry';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getDatabaseConfig } from './config.server';
import * as schema from './schema';
import { logger } from '@/lib/_core/logger';
import { DatabaseError, UnauthorizedError, UnsupportedProviderError } from '@/lib/_core/errors';

/**
 *
 */
export function createDatabaseClient() {
  const config = getDatabaseConfig();

  switch (config.provider) {
    case 'postgres':
    case 'supabase': {
      const client = postgres(config.connectionString, {
        ...config.options,
        onnotice: () => {},
        // ErrorProcess
        onparameter: () => {},
      });

      // Save reference for proper cleanup (use globalThis for HMR persistence)
      globalThis.__postgresClient = client;
      postgresClient = client;

      logger.debug({ provider: config.provider, driver: 'postgres.js' }, 'Database client created');

      return drizzlePostgres(client, {
        schema,
        logger: process.env.DB_LOG_QUERIES === 'true', // Enable SQL logs via DB_LOG_QUERIES=true
      });
    }

    case 'neon': {
      // Neon HTTP driver (Serverless optimized)
      const sql = neon(config.connectionString);

      logger.debug({ provider: 'neon', driver: 'HTTP' }, 'Database client created');

      return drizzleNeon(sql, {
        schema,
        logger: process.env.DB_LOG_QUERIES === 'true', // Enable SQL logs via DB_LOG_QUERIES=true
      });
    }

    default:
      throw new UnsupportedProviderError(config.provider, ['postgres', 'neon', 'supabase']);
  }
}

// =============================================================================
// Global Singleton Instance (with HMR support)
// =============================================================================

/**
 * Global type declaration for HMR persistence
 */
declare global {
  var __dbInstance: ReturnType<typeof createDatabaseClient> | undefined;
  var __postgresClient: ReturnType<typeof postgres> | undefined;
}

// Module-level handle to the active postgres.js client.
let postgresClient: ReturnType<typeof postgres> | null = null;
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
const databaseContextStorage = new AsyncLocalStorage<DatabaseClient>();

/**
 * Get database instance (lazy initialization with HMR persistence)
 */
export function getDatabase() {
  if (!globalThis.__dbInstance) {
    globalThis.__dbInstance = createDatabaseClient();
  }
  return globalThis.__dbInstance;
}

function getDatabaseForCurrentContext(): DatabaseClient {
  return databaseContextStorage.getStore() ?? getDatabase();
}

/**
 *
 */
export const db = new Proxy<ReturnType<typeof createDatabaseClient>>(
  {} as ReturnType<typeof createDatabaseClient>,
  {
    get(target, prop, receiver) {
      const instance = getDatabaseForCurrentContext();
      return Reflect.get(instance, prop, receiver);
    },
  }
);

/**
 */
export type Database = typeof db;

/**
 * Test database connection with retry logic
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    await pRetry(
      async () => {
        await db.execute(sql`SELECT 1`);
      },
      {
        retries: 3,
        minTimeout: 1000, // 1 second
        maxTimeout: 5000, // 5 seconds
        onFailedAttempt: (context) => {
          logger.warn(
            {
              attempt: context.attemptNumber,
              retriesLeft: context.retriesLeft,
              error: context.error.message,
            },
            'Database connection attempt failed, retrying...'
          );
        },
      }
    );
    logger.info('Database connection successful');
    return true;
  } catch (error) {
    logger.error({ error }, 'Database connection failed after retries');
    throw new DatabaseError(
      `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Close database connection and reset singleton instance
 *
 * Properly closes the underlying postgres.js connection pool
 * before resetting the singleton instance.
 */
export async function closeDatabaseConnection(): Promise<void> {
  const client = globalThis.__postgresClient || postgresClient;
  if (client) {
    try {
      await client.end();
      logger.info('Database connection pool closed');
    } catch (error) {
      logger.error({ error }, 'Error closing database connection pool');
    }
    globalThis.__postgresClient = undefined;
    postgresClient = null;
  }
  globalThis.__dbInstance = undefined;
}

/**
 * Check if database connection is healthy
 *
 * Performs a simple SELECT 1 query to verify connectivity
 *
 * @returns True if connection is healthy, false otherwise
 */
export async function isDatabaseHealthy(): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return false;
  }
}

/**
 * Ensure database connection is healthy, reset if needed
 *
 * Checks connection health and recreates the connection if unhealthy
 *
 * @returns True if connection is healthy (or successfully reset)
 */
export async function ensureHealthyConnection(): Promise<boolean> {
  const isHealthy = await isDatabaseHealthy();

  if (!isHealthy) {
    logger.warn('Database connection unhealthy, attempting to reset...');

    try {
      // Properly close old connection before creating new one
      const client = globalThis.__postgresClient || postgresClient;
      if (client) {
        try {
          await client.end();
        } catch {
          // Ignore close errors during reset
        }
        globalThis.__postgresClient = undefined;
        postgresClient = null;
      }

      // Reset connection
      globalThis.__dbInstance = undefined;
      globalThis.__dbInstance = createDatabaseClient();

      // Verify new connection
      const newIsHealthy = await isDatabaseHealthy();

      if (newIsHealthy) {
        logger.info('Database connection successfully reset');
        return true;
      } else {
        logger.error('Failed to reset database connection');
        return false;
      }
    } catch (error) {
      logger.error({ error }, 'Error while resetting database connection');
      return false;
    }
  }

  return true;
}

// RLS (Row Level Security) Context Helpers

/**
 *
 * - session, user_profiles, usage_history, user_entitlements
 * - files, user_roles, account
 *
 *
 * @example
 * ```typescript
 * const userId = await getUserIdFromHeaders();
 *
 * const profile = await withUserContext(userId, async (db) => {
 *   return db.query.userProfiles.findFirst({
 *   });
 * });
 * ```
 */
export async function withUserContext<T>(
  userId: string | undefined,
  callback: (db: Database) => Promise<T>
): Promise<T> {
  if (!userId) {
    return callback(db);
  }

  // Settings RLS context
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${userId}, true)`);

    const transactionDb = tx as unknown as DatabaseClient;
    return databaseContextStorage.run(transactionDb, () => callback(transactionDb));
  });
}

export async function requireUserContext<T>(
  userId: string | undefined,
  callback: (db: Database) => Promise<T>
): Promise<T> {
  if (!userId) {
    throw new UnauthorizedError('User context is required for this database operation');
  }

  return withUserContext(userId, callback);
}

/**
 *
 *
 *
 * @example
 * ```typescript
 * //
 * await withSystemContext(async (db) => {
 *   return db.delete(session).where(lt(session.expiresAt, new Date()));
 * });
 * ```
 */
export async function withSystemContext<T>(callback: (db: Database) => Promise<T>): Promise<T> {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);

    const transactionDb = tx as unknown as DatabaseClient;
    return databaseContextStorage.run(transactionDb, () => callback(transactionDb));
  });
}

export async function withPluginContext<T>(
  pluginId: string,
  userId: string | undefined,
  callback: (db: Database) => Promise<T>,
  options: { system?: boolean } = {}
): Promise<T> {
  if (!pluginId) {
    throw new DatabaseError('Plugin context requires a pluginId');
  }

  if (!options.system && !userId) {
    throw new UnauthorizedError('User context is required for plugin database operations');
  }

  const contextUserId = options.system ? 'system' : userId!;

  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${contextUserId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_plugin_id', ${pluginId}, true)`);

    const transactionDb = tx as unknown as DatabaseClient;
    return databaseContextStorage.run(transactionDb, () => callback(transactionDb));
  });
}

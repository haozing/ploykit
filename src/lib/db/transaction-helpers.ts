/**
 * Transaction Helpers
 *
 * Utility functions for managing database transactions with automatic retry
 * and comprehensive error handling
 */

import { db, withSystemContext, type Database } from './client.server';
import { logger } from '@/lib/_core/logger';

/**
 * Error codes that indicate a serialization failure that can be retried
 */
const SERIALIZATION_ERROR_CODES = [
  '40001', // serialization_failure
  '40P01', // deadlock_detected
];

/**
 * Check if an error is a serialization error that can be retried
 */
function isSerializationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  // Check for serialization keywords
  if (
    message.includes('serialization') ||
    message.includes('deadlock') ||
    message.includes('could not serialize')
  ) {
    return true;
  }

  // Check for PostgreSQL error codes
  const pgError = error as { code?: string };
  if (pgError.code && SERIALIZATION_ERROR_CODES.includes(pgError.code)) {
    return true;
  }

  return false;
}

/**
 * Options for transaction execution
 */
export interface TransactionOptions {
  /**
   * Use system context (bypasses RLS)
   * @default false
   */
  useSystemContext?: boolean;

  /**
   * Maximum number of retry attempts for serialization errors
   * @default 3
   */
  maxRetries?: number;

  /**
   * Base delay in milliseconds for exponential backoff
   * @default 100
   */
  baseDelayMs?: number;

  /**
   * Log transaction start/end
   * @default false
   */
  debug?: boolean;

  /**
   * Transaction name for logging
   */
  name?: string;
}

/**
 * Transaction timing metrics for monitoring
 */
export interface TransactionMetrics {
  name: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  success: boolean;
  retryCount: number;
  error?: string;
}

/**
 * Internal options for core transaction execution
 */
interface InternalTransactionOptions extends TransactionOptions {
  /**
   * Whether to collect and return metrics
   * @default false
   */
  collectMetrics?: boolean;
}

/**
 * Core transaction execution logic with automatic retry
 *
 * This is the shared implementation used by both runInTransaction
 * and runInTransactionWithMetrics to avoid code duplication.
 */
async function executeTransaction<T>(
  callback: (tx: Database) => Promise<T>,
  options: InternalTransactionOptions = {}
): Promise<{ result: T; metrics?: TransactionMetrics }> {
  const {
    useSystemContext = false,
    maxRetries = 3,
    baseDelayMs = 100,
    debug = false,
    name = 'Transaction',
    collectMetrics = false,
  } = options;

  const startTime = Date.now();
  let lastError: Error | null = null;
  let attempt = 0;
  let retryCount = 0;
  let success = false;
  let errorMessage: string | undefined;
  let result: T;

  while (attempt <= maxRetries) {
    try {
      if (debug) {
        logger.debug(
          { name, attempt: attempt + 1, maxRetries: maxRetries + 1 },
          'Starting transaction'
        );
      }

      // Execute transaction
      if (useSystemContext) {
        // withSystemContext already wraps in a transaction with RLS context set,
        // so we call the callback directly instead of creating a nested transaction
        result = await withSystemContext(callback);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result = await db.transaction(callback as any);
      }

      success = true;
      retryCount = attempt;

      if (debug) {
        const duration = Date.now() - startTime;
        logger.debug(
          { name, attempt: attempt + 1, durationMs: duration },
          'Transaction completed successfully'
        );
      }

      break;
    } catch (error) {
      lastError = error as Error;
      retryCount = attempt;

      const isRetryable = isSerializationError(error);

      if (isRetryable && attempt < maxRetries) {
        // Calculate exponential backoff with jitter
        const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 50;

        logger.warn(
          {
            name,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            delayMs: Math.round(delayMs),
            error: error instanceof Error ? error.message : String(error),
          },
          'Transaction failed with serialization error, retrying...'
        );

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        attempt++;
        continue;
      }

      // Non-retryable error or max retries exceeded
      errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          name,
          attempt: attempt + 1,
          isRetryable,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Transaction failed'
      );

      // If collecting metrics, we need to build metrics before throwing
      if (collectMetrics) {
        const endTime = Date.now();
        const metrics: TransactionMetrics = {
          name,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          success: false,
          retryCount,
          error: errorMessage,
        };

        // Attach metrics to error for caller to access if needed
        (error as Error & { metrics?: TransactionMetrics }).metrics = metrics;
      }

      throw error;
    }
  }

  if (!success) {
    throw lastError || new Error('Transaction failed with unknown error');
  }

  // Build metrics if requested
  if (collectMetrics) {
    const endTime = Date.now();
    const metrics: TransactionMetrics = {
      name,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      success,
      retryCount,
      error: errorMessage,
    };

    // Log slow transactions
    if (metrics.durationMs > 1000) {
      logger.warn({ metrics }, 'Slow transaction detected');
    }

    return { result: result!, metrics };
  }

  return { result: result! };
}

/**
 * Execute a database operation in a transaction with automatic retry
 *
 * Features:
 * - Automatic retry on serialization errors
 * - Exponential backoff with jitter
 * - Comprehensive error logging
 * - Optional system context (RLS bypass)
 * - Debug mode for transaction tracing
 *
 * @param callback - Database operations to execute in transaction
 * @param options - Transaction options
 * @returns Result of the callback
 *
 * @example
 * ```typescript
 * const result = await runInTransaction(async (tx) => {
 *   // Step 1: Update user
 *   await tx.update(users).set({ name: 'John' }).where(eq(users.id, userId));
 *
 *   // Step 2: Create audit log
 *   await tx.insert(auditLogs).values({ action: 'user_updated' });
 *
 *   return { success: true };
 * }, {
 *   useSystemContext: true,
 *   maxRetries: 3,
 *   debug: true,
 *   name: 'UpdateUserWithAudit'
 * });
 * ```
 */
export async function runInTransaction<T>(
  callback: (tx: Database) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const { result } = await executeTransaction(callback, {
    ...options,
    collectMetrics: false,
  });
  return result;
}

/**
 * Execute a database operation in a system context transaction with automatic retry
 *
 * This is a convenience wrapper around runInTransaction with useSystemContext: true
 *
 * @param callback - Database operations to execute in transaction
 * @param options - Transaction options (useSystemContext is always true)
 * @returns Result of the callback
 *
 * @example
 * ```typescript
 * const result = await runInSystemTransaction(async (tx) => {
 *   // Operations that bypass RLS
 *   return tx.select().from(users);
 * }, {
 *   maxRetries: 3,
 *   name: 'AdminUserQuery'
 * });
 * ```
 */
export async function runInSystemTransaction<T>(
  callback: (tx: Database) => Promise<T>,
  options: Omit<TransactionOptions, 'useSystemContext'> = {}
): Promise<T> {
  return runInTransaction(callback, {
    ...options,
    useSystemContext: true,
  });
}

/**
 * Execute a transaction and collect performance metrics
 *
 * Useful for monitoring and debugging slow transactions
 *
 * @param callback - Database operations to execute
 * @param options - Transaction options
 * @returns Tuple of [result, metrics]
 *
 * @example
 * ```typescript
 * const [result, metrics] = await runInTransactionWithMetrics(
 *   async (tx) => {
 *     // Slow operation
 *     return tx.select().from(users);
 *   },
 *   { name: 'SlowQuery' }
 * );
 *
 * if (metrics.durationMs > 1000) {
 *   logger.warn({ metrics }, 'Slow transaction detected');
 * }
 * ```
 */
export async function runInTransactionWithMetrics<T>(
  callback: (tx: Database) => Promise<T>,
  options: TransactionOptions = {}
): Promise<[T, TransactionMetrics]> {
  const { result, metrics } = await executeTransaction(callback, {
    ...options,
    collectMetrics: true,
  });
  return [result, metrics!];
}

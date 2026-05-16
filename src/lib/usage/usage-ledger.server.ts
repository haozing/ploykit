/**
 * Usage Ledger
 *
 * Interface for critical usage tracking with idempotency and outbox support.
 * Critical usage (API quota, storage, jobs, billing credit) must be
 * durable and not fire-and-forget.
 *
 * Phase 1: In-memory with deduplication and structured logging
 * Phase 2: Database-backed with outbox
 */

import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import { logger } from '@/lib/_core/logger';
import { withSystemContext, type Database } from '@/lib/db/client.server';
import { usageHistory } from '@/lib/db/schema/entitlement';

export type UsageCategory =
  | 'storage'
  | 'api_quota'
  | 'job_executions'
  | 'credit'
  | 'bandwidth'
  | 'compute_time';

export interface UsageRecord {
  /** Unique record ID */
  id: string;
  /** Idempotency key for deduplication */
  idempotencyKey: string;
  /** User or entity being metered */
  userId: string;
  /** Usage category */
  category: UsageCategory;
  /** Amount consumed (positive) or released (negative) */
  amount: number;
  /** Unit of measurement */
  unit: string;
  /** Optional context */
  metadata?: Record<string, unknown>;
  /** When the usage occurred */
  timestamp: Date;
}

export interface UsageLedgerCapabilities {
  storage: 'memory' | 'database';
  durable: boolean;
  idempotent: boolean;
  redactsSensitiveMetadata: boolean;
}

export interface UsageLedger {
  record(usage: UsageRecord): Promise<void>;
  query(options: {
    userId?: string;
    category?: UsageCategory;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<UsageRecord[]>;
  getQuotaUsage(userId: string, category: UsageCategory): Promise<number>;
  getCapabilities?(): UsageLedgerCapabilities;
}

const usageCategories = new Set<string>([
  'storage',
  'api_quota',
  'job_executions',
  'credit',
  'bandwidth',
  'compute_time',
]);

function isUsageCategory(value: unknown): value is UsageCategory {
  return typeof value === 'string' && usageCategories.has(value);
}

function sanitizeUsageMetadata(
  metadata?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;

  const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'creditCard', 'email', 'phone'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * In-memory usage ledger (Phase 1)
 * Logs to structured logger and keeps recent records in memory.
 * Deduplicates by idempotencyKey.
 */
export class MemoryUsageLedger implements UsageLedger {
  private records: UsageRecord[] = [];
  private idempotencyKeys = new Set<string>();
  private maxSize: number;

  constructor(maxSize = 100000) {
    this.maxSize = maxSize;
  }

  async record(usage: UsageRecord): Promise<void> {
    // Idempotency check
    if (this.idempotencyKeys.has(usage.idempotencyKey)) {
      logger.warn(
        {
          idempotencyKey: usage.idempotencyKey,
          userId: usage.userId,
          category: usage.category,
        },
        'Usage record deduplicated (idempotency key already exists)'
      );
      return;
    }

    // Sanitize metadata to remove PII
    const sanitizedMeta = sanitizeUsageMetadata(usage.metadata);

    // Write to structured logger
    logger.info(
      {
        usageId: usage.id,
        idempotencyKey: usage.idempotencyKey,
        userId: usage.userId,
        category: usage.category,
        amount: usage.amount,
        unit: usage.unit,
        metadata: sanitizedMeta,
        timestamp: usage.timestamp.toISOString(),
      },
      `Usage: ${usage.category} ${usage.amount}${usage.unit}`
    );

    // Store in memory
    this.idempotencyKeys.add(usage.idempotencyKey);
    this.records.unshift(usage);

    if (this.records.length > this.maxSize) {
      const evicted = this.records.splice(this.maxSize);
      // Clean up idempotency keys for evicted records
      for (const r of evicted) {
        this.idempotencyKeys.delete(r.idempotencyKey);
      }
    }
  }

  async query(options: {
    userId?: string;
    category?: UsageCategory;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<UsageRecord[]> {
    let results = this.records;

    if (options.userId) {
      results = results.filter((r) => r.userId === options.userId);
    }
    if (options.category) {
      results = results.filter((r) => r.category === options.category);
    }
    if (options.from) {
      results = results.filter((r) => r.timestamp >= options.from!);
    }
    if (options.to) {
      results = results.filter((r) => r.timestamp <= options.to!);
    }

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;

    return results.slice(offset, offset + limit);
  }

  async getQuotaUsage(userId: string, category: UsageCategory): Promise<number> {
    const relevant = this.records.filter((r) => r.userId === userId && r.category === category);
    return relevant.reduce((sum, r) => sum + r.amount, 0);
  }

  getCapabilities(): UsageLedgerCapabilities {
    return {
      storage: 'memory',
      durable: false,
      idempotent: true,
      redactsSensitiveMetadata: true,
    };
  }
}

export class DatabaseUsageLedger implements UsageLedger {
  constructor(private readonly database: Database | undefined = undefined) {}

  async record(usage: UsageRecord): Promise<void> {
    const metadata = sanitizeUsageMetadata(usage.metadata) ?? {};
    const pluginId = typeof metadata.pluginId === 'string' ? metadata.pluginId : 'system';

    await this.withDatabase(async (database) => {
      await database
        .insert(usageHistory)
        .values({
          idempotencyKey: usage.idempotencyKey,
          userId: usage.userId,
          pluginId,
          metric: usage.category,
          value: Math.trunc(usage.amount),
          unit: usage.unit,
          metadata,
          recordedAt: usage.timestamp,
        })
        .onConflictDoNothing({ target: usageHistory.idempotencyKey });
    });

    logger.info(
      {
        usageId: usage.id,
        idempotencyKey: usage.idempotencyKey,
        userId: usage.userId,
        category: usage.category,
        amount: usage.amount,
        unit: usage.unit,
        storage: 'database',
      },
      `Usage: ${usage.category} ${usage.amount}${usage.unit}`
    );
  }

  async query(options: {
    userId?: string;
    category?: UsageCategory;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<UsageRecord[]> {
    return this.withDatabase(async (database) => {
      const conditions: SQL[] = [];

      if (options.userId) {
        conditions.push(eq(usageHistory.userId, options.userId));
      }
      if (options.category) {
        conditions.push(eq(usageHistory.metric, options.category));
      }
      if (options.from) {
        conditions.push(gte(usageHistory.recordedAt, options.from));
      }
      if (options.to) {
        conditions.push(lte(usageHistory.recordedAt, options.to));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const limit = options.limit ?? 100;
      const offset = options.offset ?? 0;

      const rows = where
        ? await database
            .select()
            .from(usageHistory)
            .where(where)
            .orderBy(desc(usageHistory.recordedAt))
            .limit(limit)
            .offset(offset)
        : await database
            .select()
            .from(usageHistory)
            .orderBy(desc(usageHistory.recordedAt))
            .limit(limit)
            .offset(offset);

      return rows.map((row) => ({
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        userId: row.userId,
        category: isUsageCategory(row.metric) ? row.metric : 'api_quota',
        amount: row.value,
        unit: row.unit,
        metadata: row.metadata,
        timestamp: row.recordedAt,
      }));
    });
  }

  async getQuotaUsage(userId: string, category: UsageCategory): Promise<number> {
    const records = await this.query({ userId, category, limit: 10000 });
    return records.reduce((sum, record) => sum + record.amount, 0);
  }

  getCapabilities(): UsageLedgerCapabilities {
    return {
      storage: 'database',
      durable: true,
      idempotent: true,
      redactsSensitiveMetadata: true,
    };
  }

  private async withDatabase<T>(callback: (database: Database) => Promise<T>): Promise<T> {
    if (this.database) {
      return callback(this.database);
    }

    return withSystemContext(callback);
  }
}

/**
 * Global usage ledger instance
 */
let globalUsageLedger: UsageLedger = new MemoryUsageLedger();

export function setUsageLedger(ledger: UsageLedger): void {
  globalUsageLedger = ledger;
}

export function getUsageLedger(): UsageLedger {
  return globalUsageLedger;
}

export function describeUsageLedger(
  ledger: UsageLedger = globalUsageLedger
): UsageLedgerCapabilities {
  return (
    ledger.getCapabilities?.() ?? {
      storage: 'memory',
      durable: false,
      idempotent: false,
      redactsSensitiveMetadata: false,
    }
  );
}

/**
 * Convenience function for recording usage
 */
export async function recordUsage(
  category: UsageCategory,
  amount: number,
  unit: string,
  options: {
    userId: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const record: UsageRecord = {
    id: randomUUID(),
    idempotencyKey: options.idempotencyKey,
    userId: options.userId,
    category,
    amount,
    unit,
    metadata: options.metadata,
    timestamp: new Date(),
  };

  await globalUsageLedger.record(record);
}

/**
 * Convenience function for checking remaining quota
 */
export async function checkQuota(
  userId: string,
  category: UsageCategory,
  limit: number
): Promise<{ available: number; used: number; exceeded: boolean }> {
  const used = await globalUsageLedger.getQuotaUsage(userId, category);
  const available = Math.max(0, limit - used);
  return { available, used, exceeded: used >= limit };
}

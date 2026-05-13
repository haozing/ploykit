import { asc, eq, and, lte, sql } from 'drizzle-orm';

import { db as defaultDb, eventOutbox, type Database } from '@/lib/db';

import type {
  OutboxEntry,
  OutboxEntryStatus,
  OutboxProcessLease,
  OutboxStats,
  OutboxStore,
} from './outbox-store';
import type { EventMetadata } from './types';

function serializeMetadata(metadata: EventMetadata): Record<string, unknown> {
  return {
    ...metadata,
    timestamp: metadata.timestamp.toISOString(),
  };
}

function parseMetadata(value: unknown): EventMetadata {
  const metadata = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const timestamp = metadata.timestamp;
  const eventId = typeof metadata.eventId === 'string' ? metadata.eventId : 'unknown';

  return {
    emitterId: typeof metadata.emitterId === 'string' ? metadata.emitterId : 'unknown',
    timestamp: typeof timestamp === 'string' ? new Date(timestamp) : new Date(),
    eventId,
    correlationId: typeof metadata.correlationId === 'string' ? metadata.correlationId : eventId,
    causationId: typeof metadata.causationId === 'string' ? metadata.causationId : undefined,
    idempotencyKey:
      typeof metadata.idempotencyKey === 'string' ? metadata.idempotencyKey : undefined,
  };
}

function normalizeStatus(status: string): OutboxEntryStatus {
  if (
    status === 'pending' ||
    status === 'processing' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'ignored' ||
    status === 'archived'
  ) {
    return status;
  }

  return 'failed';
}

function toEntry(row: typeof eventOutbox.$inferSelect): OutboxEntry {
  return {
    id: row.id,
    event: row.event,
    payload: row.payload,
    metadata: parseMetadata(row.metadata),
    status: normalizeStatus(row.status),
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    error: row.error ?? undefined,
    nextAttemptAt: row.nextAttemptAt,
    lockedAt: row.lockedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    processedAt: row.processedAt ?? undefined,
  };
}

export class DatabaseOutboxStore implements OutboxStore {
  constructor(private readonly database: Database = defaultDb) {}

  async enqueue(entry: OutboxEntry): Promise<void> {
    await this.database
      .insert(eventOutbox)
      .values({
        id: entry.id,
        event: entry.event,
        payload: entry.payload,
        metadata: serializeMetadata(entry.metadata),
        status: entry.status,
        attempts: entry.attempts,
        maxAttempts: entry.maxAttempts,
        error: entry.error,
        nextAttemptAt: entry.nextAttemptAt ?? new Date(),
        lockedAt: entry.lockedAt,
        processedAt: entry.processedAt,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt ?? entry.createdAt,
      })
      .onConflictDoNothing({ target: eventOutbox.id });
  }

  async listPending(): Promise<OutboxEntry[]> {
    const rows = await this.database
      .select()
      .from(eventOutbox)
      .where(and(eq(eventOutbox.status, 'pending'), lte(eventOutbox.nextAttemptAt, new Date())))
      .orderBy(asc(eventOutbox.createdAt))
      .limit(100);

    return rows.map(toEntry);
  }

  async markProcessing(
    entryId: string,
    attempts: number,
    lockedAt: Date
  ): Promise<OutboxProcessLease> {
    const rows = await this.database
      .update(eventOutbox)
      .set({
        status: 'processing',
        attempts,
        lockedAt,
        updatedAt: lockedAt,
      })
      .where(and(eq(eventOutbox.id, entryId), eq(eventOutbox.status, 'pending')))
      .returning();

    return {
      acquired: rows.length > 0,
      attempts: rows[0] ? toEntry(rows[0]).attempts : attempts,
    };
  }

  async markCompleted(entryId: string, processedAt: Date): Promise<void> {
    await this.database
      .update(eventOutbox)
      .set({
        status: 'completed',
        processedAt,
        lockedAt: null,
        updatedAt: processedAt,
      })
      .where(eq(eventOutbox.id, entryId));
  }

  async markRetry(
    entryId: string,
    options: { attempts: number; error: string; nextAttemptAt: Date }
  ): Promise<void> {
    await this.database
      .update(eventOutbox)
      .set({
        status: 'pending',
        attempts: options.attempts,
        error: options.error,
        nextAttemptAt: options.nextAttemptAt,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(eventOutbox.id, entryId));
  }

  async markFailed(entryId: string, options: { attempts: number; error: string }): Promise<void> {
    await this.database
      .update(eventOutbox)
      .set({
        status: 'failed',
        attempts: options.attempts,
        error: options.error,
        lockedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(eventOutbox.id, entryId));
  }

  async getStats(): Promise<OutboxStats> {
    const rows = await this.database.select({ status: eventOutbox.status }).from(eventOutbox);

    return rows.reduce<OutboxStats>(
      (stats, row) => {
        const status = normalizeStatus(row.status);
        stats.total += 1;
        stats[status] += 1;
        return stats;
      },
      { total: 0, pending: 0, processing: 0, completed: 0, failed: 0, ignored: 0, archived: 0 }
    );
  }

  async getFailedEntries(): Promise<OutboxEntry[]> {
    const rows = await this.database
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.status, 'failed'))
      .orderBy(asc(eventOutbox.updatedAt))
      .limit(100);

    return rows.map(toEntry);
  }

  async resetFailed(entryId: string): Promise<boolean> {
    const rows = await this.database
      .update(eventOutbox)
      .set({
        status: 'pending',
        attempts: 0,
        error: null,
        lockedAt: null,
        processedAt: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(eventOutbox.id, entryId), eq(eventOutbox.status, 'failed')))
      .returning();

    return rows.length > 0;
  }

  async markIgnored(entryId: string, reason?: string): Promise<boolean> {
    const now = new Date();
    const values: Partial<typeof eventOutbox.$inferInsert> = {
      status: 'ignored',
      lockedAt: null,
      updatedAt: now,
    };
    if (reason) {
      values.error = reason;
    }

    const rows = await this.database
      .update(eventOutbox)
      .set(values)
      .where(and(eq(eventOutbox.id, entryId), eq(eventOutbox.status, 'failed')))
      .returning();

    return rows.length > 0;
  }

  async markArchived(entryId: string, reason?: string): Promise<boolean> {
    const now = new Date();
    const values: Partial<typeof eventOutbox.$inferInsert> = {
      status: 'archived',
      lockedAt: null,
      updatedAt: now,
    };
    if (reason) {
      values.error = reason;
    }

    const rows = await this.database
      .update(eventOutbox)
      .set(values)
      .where(and(eq(eventOutbox.id, entryId), eq(eventOutbox.status, 'failed')))
      .returning();

    return rows.length > 0;
  }

  async clear(): Promise<void> {
    await this.database.execute(sql`DELETE FROM event_outbox`);
  }
}

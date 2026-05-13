import { randomUUID } from 'crypto';
import { asc, and, eq, isNull, lte, ne, sql } from 'drizzle-orm';
import { logger } from '@/lib/_core/logger';
import { db, type Database } from '@/lib/db/client.server';
import { pluginFiles, type PluginFile } from '@/lib/db/schema/plugin-platform';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import { auditLog } from '@/lib/audit/audit-port.server';
import type { UsageLedger } from '@/lib/usage/usage-ledger.server';
import { recordUsage } from '@/lib/usage/usage-ledger.server';
import type { BlobStore } from '@/lib/services/storage/blob-store';
import { getInitializedBlobStore } from '@/lib/services/storage/init.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginFileCleanupRepository {
  listExpiredTempFiles(input: {
    now: Date;
    limit: number;
    pluginId?: string;
  }): Promise<PluginFile[]>;
  markExpiredDeleted(file: PluginFile, now: Date): Promise<PluginFile | null>;
}

export interface CleanupExpiredPluginFilesOptions {
  now?: Date;
  limit?: number;
  pluginId?: string;
  repository?: PluginFileCleanupRepository;
  blobStore?: BlobStore;
  auditPort?: AuditPort;
  usageLedger?: UsageLedger;
}

export interface CleanupExpiredPluginFilesResult {
  scanned: number;
  deleted: number;
  failed: number;
  reclaimedBytes: number;
}

const DEFAULT_PLUGIN_FILE_CLEANUP_LIMIT = 100;
const MAX_PLUGIN_FILE_CLEANUP_LIMIT = 500;

export class DbPluginFileCleanupRepository implements PluginFileCleanupRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inSystem<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    if (this.executor !== db) {
      return fn(this.executor);
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      return fn(tx);
    });
  }

  async listExpiredTempFiles(input: {
    now: Date;
    limit: number;
    pluginId?: string;
  }): Promise<PluginFile[]> {
    return this.inSystem((executor) => {
      const conditions = [
        eq(pluginFiles.purpose, 'temp'),
        ne(pluginFiles.status, 'deleted'),
        isNull(pluginFiles.deletedAt),
        lte(pluginFiles.expiresAt, input.now),
      ];

      if (input.pluginId) {
        conditions.push(eq(pluginFiles.pluginId, input.pluginId));
      }

      return executor
        .select()
        .from(pluginFiles)
        .where(and(...conditions))
        .orderBy(asc(pluginFiles.expiresAt), asc(pluginFiles.createdAt))
        .limit(input.limit);
    });
  }

  async markExpiredDeleted(file: PluginFile, now: Date): Promise<PluginFile | null> {
    const [row] = await this.inSystem((executor) =>
      executor
        .update(pluginFiles)
        .set({
          status: 'deleted',
          deletedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(pluginFiles.id, file.id),
            eq(pluginFiles.purpose, 'temp'),
            ne(pluginFiles.status, 'deleted'),
            isNull(pluginFiles.deletedAt),
            lte(pluginFiles.expiresAt, now)
          )
        )
        .returning()
    );

    return row ?? null;
  }
}

function normalizeCleanupLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_PLUGIN_FILE_CLEANUP_LIMIT;
  }

  return Math.min(Math.max(Math.floor(limit!), 1), MAX_PLUGIN_FILE_CLEANUP_LIMIT);
}

async function recordFileExpiredAudit(file: PluginFile, auditPort?: AuditPort): Promise<void> {
  const event = {
    id: randomUUID(),
    type: 'file.expired' as const,
    actorId: 'system',
    actorType: 'system' as const,
    targetId: file.id,
    targetType: 'plugin_file',
    action: `${file.pluginId}.files.expire`,
    details: {
      pluginId: file.pluginId,
      scopeType: file.scopeType,
      scopeId: file.scopeId,
      ownerUserId: file.ownerUserId,
      fileName: file.fileName,
      size: file.size,
      runId: file.runId,
      expiresAt: file.expiresAt?.toISOString(),
    },
    timestamp: new Date(),
  };

  if (auditPort) {
    await auditPort.log(event);
    return;
  }

  await auditLog('file.expired', event.action, {
    actorId: event.actorId,
    actorType: event.actorType,
    targetId: event.targetId,
    targetType: event.targetType,
    details: event.details,
  });
}

async function recordFileExpiredUsage(file: PluginFile, usageLedger?: UsageLedger): Promise<void> {
  const usage = {
    id: randomUUID(),
    idempotencyKey: `plugin-file:${file.id}:expired`,
    userId: file.ownerUserId,
    category: 'storage' as const,
    amount: -file.size,
    unit: 'byte',
    metadata: {
      pluginId: file.pluginId,
      fileId: file.id,
      scopeType: file.scopeType,
      scopeId: file.scopeId,
      runId: file.runId,
      action: 'expire',
    },
    timestamp: new Date(),
  };

  if (usageLedger) {
    await usageLedger.record(usage);
    return;
  }

  await recordUsage(usage.category, usage.amount, usage.unit, {
    userId: usage.userId,
    idempotencyKey: usage.idempotencyKey,
    metadata: usage.metadata,
  });
}

export async function cleanupExpiredPluginFiles(
  options: CleanupExpiredPluginFilesOptions = {}
): Promise<CleanupExpiredPluginFilesResult> {
  const now = options.now ?? new Date();
  const limit = normalizeCleanupLimit(options.limit);
  const repository = options.repository ?? new DbPluginFileCleanupRepository();
  const blobStore = options.blobStore ?? getInitializedBlobStore();
  const expiredFiles = await repository.listExpiredTempFiles({
    now,
    limit,
    pluginId: options.pluginId,
  });

  let deleted = 0;
  let failed = 0;
  let reclaimedBytes = 0;

  for (const file of expiredFiles) {
    try {
      await blobStore.delete(file.storageKey);
      const marked = await repository.markExpiredDeleted(file, now);
      if (!marked) {
        continue;
      }

      await recordFileExpiredAudit(marked, options.auditPort);
      await recordFileExpiredUsage(marked, options.usageLedger);

      deleted += 1;
      reclaimedBytes += marked.size;
    } catch (error) {
      failed += 1;
      logger.warn(
        {
          fileId: file.id,
          pluginId: file.pluginId,
          storageKey: file.storageKey,
          error: error instanceof Error ? error.message : String(error),
        },
        'Expired plugin file cleanup failed'
      );
    }
  }

  logger.info(
    {
      scanned: expiredFiles.length,
      deleted,
      failed,
      reclaimedBytes,
      pluginId: options.pluginId,
    },
    'Expired plugin file cleanup completed'
  );

  return {
    scanned: expiredFiles.length,
    deleted,
    failed,
    reclaimedBytes,
  };
}

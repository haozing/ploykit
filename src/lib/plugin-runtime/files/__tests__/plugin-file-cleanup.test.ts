import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent, AuditPort } from '@/lib/audit/audit-port.server';
import type { UsageLedger, UsageRecord } from '@/lib/usage/usage-ledger.server';
import type { BlobStore } from '@/lib/services/storage/blob-store';
import type { PluginFile } from '@/lib/db/schema/plugin-platform';
import {
  cleanupExpiredPluginFiles,
  type PluginFileCleanupRepository,
} from '../plugin-file-cleanup.server';

function createFile(overrides: Partial<PluginFile> = {}): PluginFile {
  const now = new Date('2026-05-11T00:00:00.000Z');
  return {
    id: 'file-1',
    pluginId: 'cleanup-test',
    userId: 'user-1',
    scopeType: 'user',
    scopeId: 'user-1',
    ownerUserId: 'user-1',
    fileName: 'temp.txt',
    contentType: 'text/plain',
    size: 5,
    hash: null,
    purpose: 'temp',
    status: 'ready',
    visibility: 'private',
    publicId: null,
    publicFileName: null,
    publicCacheControl: null,
    contentDisposition: 'attachment',
    storageKey: 'plugins/cleanup-test/user/user-1/file-1/temp.txt',
    storageProvider: 'local',
    runId: 'run-1',
    metadata: {},
    expiresAt: new Date('2026-05-10T00:00:00.000Z'),
    uploadedAt: now,
    publishedAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class MemoryCleanupRepository implements PluginFileCleanupRepository {
  readonly files = new Map<string, PluginFile>();

  constructor(files: PluginFile[]) {
    for (const file of files) {
      this.files.set(file.id, file);
    }
  }

  async listExpiredTempFiles(input: {
    now: Date;
    limit: number;
    pluginId?: string;
  }): Promise<PluginFile[]> {
    return Array.from(this.files.values())
      .filter(
        (file) =>
          file.purpose === 'temp' &&
          file.status !== 'deleted' &&
          !file.deletedAt &&
          file.expiresAt &&
          file.expiresAt <= input.now &&
          (!input.pluginId || file.pluginId === input.pluginId)
      )
      .slice(0, input.limit);
  }

  async markExpiredDeleted(file: PluginFile, now: Date): Promise<PluginFile | null> {
    const existing = this.files.get(file.id);
    if (
      !existing ||
      existing.purpose !== 'temp' ||
      existing.status === 'deleted' ||
      existing.deletedAt ||
      !existing.expiresAt ||
      existing.expiresAt > now
    ) {
      return null;
    }

    const updated: PluginFile = {
      ...existing,
      status: 'deleted',
      deletedAt: now,
      updatedAt: now,
    };
    this.files.set(updated.id, updated);
    return updated;
  }
}

function createBlobStore(failKey?: string): BlobStore {
  return {
    put: vi.fn(async (input) => ({ key: input.key, size: input.body.length })),
    get: vi.fn(async () => ({ body: Buffer.from('hello') })),
    delete: vi.fn(async (key) => {
      if (key === failKey) {
        throw new Error('delete failed');
      }
    }),
    exists: vi.fn(async () => true),
  };
}

function createAuditPort(events: AuditEvent[]): AuditPort {
  return {
    async log(event) {
      events.push(event);
    },
    async query() {
      return events;
    },
  };
}

function createUsageLedger(records: UsageRecord[]): UsageLedger {
  return {
    async record(usage) {
      records.push(usage);
    },
    async query() {
      return records;
    },
    async getQuotaUsage() {
      return records.reduce((sum, record) => sum + record.amount, 0);
    },
  };
}

describe('plugin file cleanup', () => {
  it('expires temp files, deletes blobs, and records audit and usage', async () => {
    const now = new Date('2026-05-11T00:00:00.000Z');
    const file = createFile();
    const repository = new MemoryCleanupRepository([file]);
    const blobStore = createBlobStore();
    const auditEvents: AuditEvent[] = [];
    const usageRecords: UsageRecord[] = [];

    const result = await cleanupExpiredPluginFiles({
      now,
      repository,
      blobStore,
      auditPort: createAuditPort(auditEvents),
      usageLedger: createUsageLedger(usageRecords),
    });

    expect(result).toEqual({
      scanned: 1,
      deleted: 1,
      failed: 0,
      reclaimedBytes: 5,
    });
    expect(blobStore.delete).toHaveBeenCalledWith(file.storageKey);
    expect(repository.files.get(file.id)).toMatchObject({
      status: 'deleted',
      deletedAt: now,
    });
    expect(auditEvents[0]).toMatchObject({
      type: 'file.expired',
      action: 'cleanup-test.files.expire',
      targetId: file.id,
    });
    expect(usageRecords[0]).toMatchObject({
      idempotencyKey: `plugin-file:${file.id}:expired`,
      userId: 'user-1',
      category: 'storage',
      amount: -5,
      unit: 'byte',
    });
  });

  it('keeps metadata active when blob cleanup fails', async () => {
    const file = createFile();
    const repository = new MemoryCleanupRepository([file]);
    const result = await cleanupExpiredPluginFiles({
      now: new Date('2026-05-11T00:00:00.000Z'),
      repository,
      blobStore: createBlobStore(file.storageKey),
      auditPort: createAuditPort([]),
      usageLedger: createUsageLedger([]),
    });

    expect(result).toMatchObject({
      scanned: 1,
      deleted: 0,
      failed: 1,
      reclaimedBytes: 0,
    });
    expect(repository.files.get(file.id)).toMatchObject({
      status: 'ready',
      deletedAt: null,
    });
  });
});

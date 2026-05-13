import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { File } from '@/lib/db/schema';

const { auditLogDurableMock, getUserEntitlementMock, mockBlobStore, mockDb, setMetricMock } =
  vi.hoisted(() => ({
    auditLogDurableMock: vi.fn(),
    getUserEntitlementMock: vi.fn(),
    mockBlobStore: {
      put: vi.fn(),
      delete: vi.fn(),
    },
    mockDb: {
      query: {
        files: {
          findMany: vi.fn(),
        },
      },
      delete: vi.fn(),
      insert: vi.fn(),
      select: vi.fn(),
      update: vi.fn(),
    },
    setMetricMock: vi.fn(),
  }));

vi.mock('@/lib/db', () => ({
  db: mockDb,
  requireUserContext: vi.fn((_userId, callback) => callback(mockDb)),
  withSystemContext: vi.fn((callback) => callback(mockDb)),
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/services/user/user-entitlement-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/services/user/user-entitlement-service')>();
  return {
    ...actual,
    getUserEntitlement: getUserEntitlementMock,
    setMetric: setMetricMock,
  };
});

vi.mock('@/lib/services/audit/audit-service', () => ({
  auditLogDurable: auditLogDurableMock,
  AUDIT_ACTIONS: {
    FILE_UPLOADED: 'file.uploaded',
    FILE_DELETED: 'file.deleted',
  },
}));

vi.mock('../init.server', () => ({
  getInitializedBlobStore: () => mockBlobStore,
}));

vi.mock('../blob-store', () => ({
  getBlobStoreDriver: vi.fn(() => 'local'),
}));

import {
  cleanupPendingFileDeletes,
  deleteFile,
  getFilePath,
  getUserStoragePolicy,
  listFiles,
  uploadFile,
  type FileMetadata,
} from '../file-storage-service';

function createFile(overrides: Partial<File> = {}): File {
  const now = new Date('2026-05-07T00:00:00.000Z');

  return {
    id: 'file_1',
    userId: 'user_1',
    fileName: 'file_1-report.txt',
    originalName: 'report.txt',
    mimeType: 'text/plain',
    size: 12,
    uploadedBy: 'user_1',
    uploadedByEmail: 'user@example.com',
    path: 'reports/file_1-report.txt',
    folder: 'reports',
    provider: 'local',
    retentionAction: 'none',
    retentionUntil: null,
    archivedAt: null,
    deleteStatus: 'active',
    deleteRequestedAt: null,
    deleteAttempts: 0,
    deleteLastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTextBuffer(content = 'hello world'): Buffer {
  return Buffer.from(content, 'utf8');
}

function mockUpdateReturning(files: File[]): void {
  const returning = vi.fn().mockResolvedValue(files);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });

  mockDb.update.mockReturnValue({ set });
}

function mockInsertReturning(file: File): void {
  const returning = vi.fn().mockResolvedValue([file]);
  const values = vi.fn().mockReturnValue({ returning });
  mockDb.insert.mockReturnValue({ values });
}

function queueStorageStats(totalSize = 0): void {
  const statsWhere = vi.fn().mockResolvedValue([{ totalFiles: 1, totalSize }]);
  const statsFrom = vi.fn().mockReturnValue({ where: statsWhere });
  const statsSelect = vi.fn().mockReturnValue({ from: statsFrom });

  const typeGroupBy = vi.fn().mockResolvedValue([]);
  const typeWhere = vi.fn().mockReturnValue({ groupBy: typeGroupBy });
  const typeFrom = vi.fn().mockReturnValue({ where: typeWhere });
  const typeSelect = vi.fn().mockReturnValue({ from: typeFrom });

  mockDb.select.mockImplementationOnce(statsSelect).mockImplementationOnce(typeSelect);
}

beforeEach(() => {
  vi.clearAllMocks();

  getUserEntitlementMock.mockResolvedValue(null);
  mockBlobStore.put.mockResolvedValue({ key: 'blob-key', size: 11 });
  mockBlobStore.delete.mockResolvedValue(undefined);
  setMetricMock.mockResolvedValue(true);

  mockDb.delete.mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  });
});

describe('file storage policy', () => {
  it('uses conservative defaults when the user has no entitlement', async () => {
    const policy = await getUserStoragePolicy('user_1');

    expect(policy).toEqual({
      quotaBytes: 5 * 1024 * 1024 * 1024,
      maxFileSizeBytes: 100 * 1024 * 1024,
      source: 'default',
    });
  });

  it('resolves storage and file size limits from monthly entitlement limits', async () => {
    getUserEntitlementMock.mockResolvedValue({
      billingInterval: 'monthly',
      plan: {
        limits: {
          monthly: {
            'platform.storageBytes': 200 * 1024 * 1024,
            'platform.maxFileSizeBytes': 10 * 1024 * 1024,
          },
        },
      },
    });

    const policy = await getUserStoragePolicy('user_1');

    expect(policy).toEqual({
      quotaBytes: 200 * 1024 * 1024,
      maxFileSizeBytes: 10 * 1024 * 1024,
      source: 'entitlement',
    });
  });
});

describe('file storage upload and listing', () => {
  it('stores sanitized folder values, updates storage usage, and writes audit', async () => {
    getUserEntitlementMock.mockResolvedValue({
      billingInterval: 'monthly',
      plan: {
        limits: {
          monthly: {
            'platform.storageBytes': 100 * 1024 * 1024,
            'platform.maxFileSizeBytes': 5 * 1024 * 1024,
          },
        },
      },
    });
    queueStorageStats(10);
    mockInsertReturning(
      createFile({
        id: 'file_uploaded',
        fileName: 'file_uploaded-report.txt',
        originalName: 'report.txt',
        size: 11,
        path: 'unsafe_folder/docs/file_uploaded-report.txt',
        folder: 'unsafe_folder/docs',
      })
    );

    const result = await uploadFile({
      userId: 'user_1',
      file: createTextBuffer(),
      originalName: 'report.txt',
      mimeType: 'text/plain',
      uploadedBy: 'user_1',
      uploadedByEmail: 'user@example.com',
      folder: ' unsafe folder/docs ',
    });

    const insertValues = mockDb.insert.mock.results[0].value.values;
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: 'unsafe_folder/docs',
        path: expect.stringMatching(/^unsafe_folder\/docs\/.+-report\.txt$/),
      })
    );
    expect(result.folder).toBe('unsafe_folder/docs');
    expect(setMetricMock).toHaveBeenCalledWith('user_1', 'platform.storageBytes', 21);
    expect(auditLogDurableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.uploaded',
        resource: 'file',
        resourceId: 'file_uploaded',
      })
    );
  });

  it('uses the sanitized folder when listing files', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const countWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
    const countFrom = vi.fn().mockReturnValue({ where: countWhere });
    const countSelect = vi.fn().mockReturnValue({ from: countFrom });
    const sizeWhere = vi.fn().mockResolvedValue([{ totalSize: 0 }]);
    const sizeFrom = vi.fn().mockReturnValue({ where: sizeWhere });
    const sizeSelect = vi.fn().mockReturnValue({ from: sizeFrom });

    mockDb.query.files.findMany = findMany;
    mockDb.select.mockImplementationOnce(countSelect).mockImplementationOnce(sizeSelect);

    await listFiles({
      userId: 'user_1',
      folder: ' unsafe folder/docs ',
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      })
    );
  });
});

describe('file storage delete reliability', () => {
  it('builds a download URL backed by the user file API', () => {
    expect(getFilePath(createFile() as unknown as FileMetadata)).toBe(
      '/api/files/file_1?download=true'
    );
  });

  it('marks a file pending before deleting blob and metadata', async () => {
    const file = createFile({ deleteStatus: 'pending_delete' });
    mockUpdateReturning([file]);
    queueStorageStats(0);

    await deleteFile(file.id, file.userId, 'admin_1', 'admin@example.com');

    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockBlobStore.delete).toHaveBeenCalledWith(file.path);
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(setMetricMock).toHaveBeenCalledWith(file.userId, 'platform.storageBytes', 0);
    expect(auditLogDurableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'file.deleted',
        resource: 'file',
        resourceId: file.id,
      })
    );
  });

  it('keeps pending metadata for cleanup when blob delete fails', async () => {
    const file = createFile({ deleteStatus: 'pending_delete' });
    mockUpdateReturning([file]);
    mockBlobStore.delete.mockRejectedValue(new Error('storage unavailable'));

    await deleteFile(file.id, file.userId, 'admin_1', 'admin@example.com');

    expect(mockBlobStore.delete).toHaveBeenCalledWith(file.path);
    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(setMetricMock).not.toHaveBeenCalled();
    expect(auditLogDurableMock).not.toHaveBeenCalled();
  });

  it('retries pending deletes in cleanup batches', async () => {
    const files = [
      createFile({ id: 'file_1', path: 'file_1.txt', size: 10, deleteStatus: 'pending_delete' }),
      createFile({ id: 'file_2', path: 'file_2.txt', size: 20, deleteStatus: 'pending_delete' }),
    ];

    mockDb.query.files.findMany.mockResolvedValue(files);

    const result = await cleanupPendingFileDeletes({ limit: 2 });

    expect(result).toEqual({
      scanned: 2,
      deleted: 2,
      failed: 0,
      reclaimedBytes: 30,
    });
    expect(mockBlobStore.delete).toHaveBeenCalledTimes(2);
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });
});

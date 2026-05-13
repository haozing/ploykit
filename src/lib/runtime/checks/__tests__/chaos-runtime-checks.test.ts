import { afterEach, describe, expect, it, vi } from 'vitest';

const mockEnv = vi.hoisted(() => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://ploykit:ploykit@localhost:55432/ploykit',
  NEON_DATABASE_URL: undefined as string | undefined,
  POSTGRES_HOST: undefined as string | undefined,
  FILE_STORAGE_ENABLED: 'true',
  FILE_STORAGE_DRIVER: 's3' as 'local' | 's3' | 'r2',
  FILE_STORAGE_LOCAL_ROOT: undefined as string | undefined,
  FILE_STORAGE_ENDPOINT: 'https://s3.example.test',
  FILE_STORAGE_BUCKET: 'ploykit-files',
  FILE_STORAGE_ACCESS_KEY_ID: undefined as string | undefined,
  FILE_STORAGE_SECRET_ACCESS_KEY: undefined as string | undefined,
  FILE_STORAGE_REGION: undefined as string | undefined,
  FILE_STORAGE_FORCE_PATH_STYLE: undefined as string | undefined,
  FILE_STORAGE_PUBLIC_BASE_URL: undefined as string | undefined,
}));

const mockDb = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@/lib/_core/env', () => ({
  env: mockEnv,
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/services/storage/blob-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/storage/blob-store')>();
  return {
    ...actual,
    getBlobStore: vi.fn(),
    getBlobStoreDriver: vi.fn(() => mockEnv.FILE_STORAGE_DRIVER),
    isBlobStoreInitialized: vi.fn(() => false),
    setBlobStore: vi.fn(),
  };
});

describe('chaos runtime failure checks', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockEnv.NODE_ENV = 'production';
    mockEnv.DATABASE_URL = 'postgresql://ploykit:ploykit@localhost:55432/ploykit';
    mockEnv.FILE_STORAGE_ENABLED = 'true';
    mockEnv.FILE_STORAGE_DRIVER = 's3';
    mockEnv.FILE_STORAGE_ENDPOINT = 'https://s3.example.test';
    mockEnv.FILE_STORAGE_BUCKET = 'ploykit-files';
    mockEnv.FILE_STORAGE_ACCESS_KEY_ID = undefined;
    mockEnv.FILE_STORAGE_SECRET_ACCESS_KEY = undefined;
  });

  it('reports a structured DB failure instead of throwing an opaque startup error', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('ECONNREFUSED synthetic outage'));
    const { dbCheck } = await import('../db-check.server');

    const result = await dbCheck.run();

    expect(result).toMatchObject({
      key: 'db',
      status: 'failed',
      severity: 'error',
      fix: 'Check DATABASE_URL and database server status',
    });
    expect(result.message).toContain('Database connection failed: ECONNREFUSED synthetic outage');
  });

  it('fails fast with actionable object storage configuration errors', async () => {
    const { storageCheck } = await import('../storage-check.server');

    const result = await storageCheck.run();

    expect(result).toMatchObject({
      key: 'storage',
      status: 'failed',
      severity: 'error',
      fix: 'Set FILE_STORAGE_DRIVER and adapter-specific environment variables, then rerun runtime:check',
    });
    expect(result.message).toContain('FILE_STORAGE_ACCESS_KEY_ID');
    expect(result.message).toContain('FILE_STORAGE_SECRET_ACCESS_KEY');
  });
});

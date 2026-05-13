import { beforeEach, describe, expect, it, vi } from 'vitest';

const { envMock, setBlobStoreMock } = vi.hoisted(() => ({
  envMock: {
    FILE_STORAGE_ENABLED: 'true',
    FILE_STORAGE_DRIVER: 'local' as 'local' | 's3' | 'r2' | undefined,
    FILE_STORAGE_LOCAL_ROOT: '.data/test-blobs',
    FILE_STORAGE_ENDPOINT: undefined as string | undefined,
    FILE_STORAGE_BUCKET: undefined as string | undefined,
    FILE_STORAGE_ACCESS_KEY_ID: undefined as string | undefined,
    FILE_STORAGE_SECRET_ACCESS_KEY: undefined as string | undefined,
    FILE_STORAGE_REGION: undefined as string | undefined,
    FILE_STORAGE_FORCE_PATH_STYLE: undefined as 'true' | 'false' | undefined,
    FILE_STORAGE_PUBLIC_BASE_URL: undefined as string | undefined,
  },
  setBlobStoreMock: vi.fn(),
}));

vi.mock('@/lib/_core/env', () => ({
  env: envMock,
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../blob-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../blob-store')>();
  return {
    ...actual,
    getBlobStore: vi.fn(),
    getBlobStoreDriver: vi.fn(() => null),
    isBlobStoreInitialized: vi.fn(() => false),
    setBlobStore: setBlobStoreMock,
  };
});

import { S3CompatibleBlobStore } from '../adapters/s3-compatible-blob-store.server';
import { initializeStorageRuntime } from '../init.server';

describe('storage runtime initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.FILE_STORAGE_ENABLED = 'true';
    envMock.FILE_STORAGE_DRIVER = 'local';
    envMock.FILE_STORAGE_LOCAL_ROOT = '.data/test-blobs';
    envMock.FILE_STORAGE_ENDPOINT = undefined;
    envMock.FILE_STORAGE_BUCKET = undefined;
    envMock.FILE_STORAGE_ACCESS_KEY_ID = undefined;
    envMock.FILE_STORAGE_SECRET_ACCESS_KEY = undefined;
    envMock.FILE_STORAGE_REGION = undefined;
    envMock.FILE_STORAGE_FORCE_PATH_STYLE = undefined;
    envMock.FILE_STORAGE_PUBLIC_BASE_URL = undefined;
  });

  it('registers the local blob store', () => {
    const status = initializeStorageRuntime();

    expect(status).toMatchObject({
      enabled: true,
      driver: 'local',
      adapterAvailable: true,
    });
    expect(setBlobStoreMock).toHaveBeenCalledWith(expect.anything(), 'local');
  });

  it('registers an S3-compatible blob store for s3', () => {
    envMock.FILE_STORAGE_DRIVER = 's3';
    envMock.FILE_STORAGE_ENDPOINT = 'https://s3.example.test';
    envMock.FILE_STORAGE_BUCKET = 'ploykit-files';
    envMock.FILE_STORAGE_ACCESS_KEY_ID = 'access';
    envMock.FILE_STORAGE_SECRET_ACCESS_KEY = 'secret';
    envMock.FILE_STORAGE_REGION = 'us-east-1';

    const status = initializeStorageRuntime();

    expect(status).toMatchObject({
      enabled: true,
      driver: 's3',
      adapterAvailable: true,
      endpoint: 'https://s3.example.test',
      bucket: 'ploykit-files',
    });
    expect(setBlobStoreMock).toHaveBeenCalledWith(expect.any(S3CompatibleBlobStore), 's3');
  });

  it('registers an S3-compatible blob store for r2', () => {
    envMock.FILE_STORAGE_DRIVER = 'r2';
    envMock.FILE_STORAGE_ENDPOINT = 'https://account.r2.cloudflarestorage.com';
    envMock.FILE_STORAGE_BUCKET = 'ploykit-files';
    envMock.FILE_STORAGE_ACCESS_KEY_ID = 'access';
    envMock.FILE_STORAGE_SECRET_ACCESS_KEY = 'secret';

    const status = initializeStorageRuntime();

    expect(status).toMatchObject({
      enabled: true,
      driver: 'r2',
      adapterAvailable: true,
      endpoint: 'https://account.r2.cloudflarestorage.com',
      bucket: 'ploykit-files',
    });
    expect(setBlobStoreMock).toHaveBeenCalledWith(expect.any(S3CompatibleBlobStore), 'r2');
  });

  it('fails fast when object storage credentials are missing', () => {
    envMock.FILE_STORAGE_DRIVER = 's3';
    envMock.FILE_STORAGE_ENDPOINT = 'https://s3.example.test';
    envMock.FILE_STORAGE_BUCKET = 'ploykit-files';

    expect(() => initializeStorageRuntime()).toThrow(
      'FILE_STORAGE_ACCESS_KEY_ID, FILE_STORAGE_SECRET_ACCESS_KEY are required when FILE_STORAGE_DRIVER=s3'
    );
  });
});

import { env } from '@/lib/_core/env';
import { ConfigurationError } from '@/lib/_core/errors';
import { logger } from '@/lib/_core/logger';
import {
  getBlobStore,
  getBlobStoreDriver,
  isBlobStoreInitialized,
  setBlobStore,
  type BlobStore,
} from './blob-store';
import { localBlobStore } from './adapters/local-blob-store.server';
import { S3CompatibleBlobStore } from './adapters/s3-compatible-blob-store.server';

export interface StorageRuntimeStatus {
  enabled: boolean;
  driver?: string;
  initialized: boolean;
  adapterAvailable: boolean;
  localRoot?: string;
  bucket?: string;
  endpoint?: string;
  unsupportedReason?: string;
}

function createStorageRuntimeStatus(options: {
  enabled: boolean;
  driver?: string;
  initialized: boolean;
}): StorageRuntimeStatus {
  const { enabled, driver, initialized } = options;
  const adapterAvailable = driver === 'local' || driver === 's3' || driver === 'r2';

  return {
    enabled,
    driver,
    initialized,
    adapterAvailable,
    localRoot: driver === 'local' ? env.FILE_STORAGE_LOCAL_ROOT : undefined,
    bucket: driver === 's3' || driver === 'r2' ? env.FILE_STORAGE_BUCKET : undefined,
    endpoint: driver === 's3' || driver === 'r2' ? env.FILE_STORAGE_ENDPOINT : undefined,
    unsupportedReason:
      enabled && driver && !adapterAvailable
        ? `FILE_STORAGE_DRIVER=${driver} is declared but no adapter is configured yet`
        : undefined,
  };
}

function createS3CompatibleBlobStore(driver: 's3' | 'r2'): S3CompatibleBlobStore {
  const missing: string[] = [];
  if (!env.FILE_STORAGE_ENDPOINT) missing.push('FILE_STORAGE_ENDPOINT');
  if (!env.FILE_STORAGE_BUCKET) missing.push('FILE_STORAGE_BUCKET');
  if (!env.FILE_STORAGE_ACCESS_KEY_ID) missing.push('FILE_STORAGE_ACCESS_KEY_ID');
  if (!env.FILE_STORAGE_SECRET_ACCESS_KEY) missing.push('FILE_STORAGE_SECRET_ACCESS_KEY');

  if (missing.length > 0) {
    throw new ConfigurationError(
      `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required when FILE_STORAGE_DRIVER=${driver}`,
      { driver, missing }
    );
  }

  return new S3CompatibleBlobStore({
    endpoint: env.FILE_STORAGE_ENDPOINT!,
    bucket: env.FILE_STORAGE_BUCKET!,
    accessKeyId: env.FILE_STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: env.FILE_STORAGE_SECRET_ACCESS_KEY!,
    region: env.FILE_STORAGE_REGION || (driver === 'r2' ? 'auto' : 'us-east-1'),
    forcePathStyle: env.FILE_STORAGE_FORCE_PATH_STYLE !== 'false',
    publicBaseUrl: env.FILE_STORAGE_PUBLIC_BASE_URL,
  });
}

export function initializeStorageRuntime(): StorageRuntimeStatus {
  if (env.FILE_STORAGE_ENABLED !== 'true') {
    return createStorageRuntimeStatus({
      enabled: false,
      driver: env.FILE_STORAGE_DRIVER,
      initialized: isBlobStoreInitialized(),
    });
  }

  if (isBlobStoreInitialized()) {
    return createStorageRuntimeStatus({
      enabled: true,
      driver: getBlobStoreDriver() || env.FILE_STORAGE_DRIVER,
      initialized: true,
    });
  }

  switch (env.FILE_STORAGE_DRIVER) {
    case 'local':
      setBlobStore(localBlobStore, 'local');
      logger.info(
        { driver: 'local', root: env.FILE_STORAGE_LOCAL_ROOT },
        'BlobStore runtime initialized'
      );
      break;

    case 's3':
    case 'r2':
      setBlobStore(createS3CompatibleBlobStore(env.FILE_STORAGE_DRIVER), env.FILE_STORAGE_DRIVER);
      logger.info(
        {
          driver: env.FILE_STORAGE_DRIVER,
          bucket: env.FILE_STORAGE_BUCKET,
          endpoint: env.FILE_STORAGE_ENDPOINT,
        },
        'BlobStore runtime initialized'
      );
      break;

    default:
      throw new ConfigurationError(
        'FILE_STORAGE_DRIVER is required when FILE_STORAGE_ENABLED=true'
      );
  }

  return createStorageRuntimeStatus({
    enabled: true,
    driver: getBlobStoreDriver() || env.FILE_STORAGE_DRIVER,
    initialized: isBlobStoreInitialized(),
  });
}

export function getStorageRuntimeStatus(): StorageRuntimeStatus {
  return createStorageRuntimeStatus({
    enabled: env.FILE_STORAGE_ENABLED === 'true',
    driver: getBlobStoreDriver() || env.FILE_STORAGE_DRIVER,
    initialized: isBlobStoreInitialized(),
  });
}

export function getInitializedBlobStore(): BlobStore {
  const status = initializeStorageRuntime();

  if (!status.initialized) {
    throw new ConfigurationError('BlobStore is not initialized', {
      enabled: status.enabled,
      driver: status.driver,
    });
  }

  return getBlobStore();
}

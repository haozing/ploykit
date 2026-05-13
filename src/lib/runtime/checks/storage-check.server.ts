import { randomUUID } from 'crypto';
import { env } from '@/lib/_core/env';
import { getBlobStore } from '@/lib/services/storage/blob-store';
import {
  getStorageRuntimeStatus,
  initializeStorageRuntime,
} from '@/lib/services/storage/init.server';
import type { RuntimeCheck } from '../types';

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function statusDetails(
  status: ReturnType<typeof getStorageRuntimeStatus>
): Record<string, unknown> {
  return { ...status };
}

export const storageCheck: RuntimeCheck = {
  name: 'storage',
  description: 'Validate BlobStore runtime configuration',

  async run() {
    if (env.FILE_STORAGE_ENABLED !== 'true') {
      return {
        key: 'storage',
        status: 'skipped',
        severity: 'info',
        message: 'File storage disabled',
        details: statusDetails(getStorageRuntimeStatus()),
      };
    }

    const configuredStatus = getStorageRuntimeStatus();
    if (
      configuredStatus.driver &&
      configuredStatus.unsupportedReason &&
      configuredStatus.adapterAvailable === false
    ) {
      return {
        key: 'storage',
        status: 'failed',
        severity: 'error',
        message: configuredStatus.unsupportedReason,
        details: statusDetails(configuredStatus),
        fix: 'Use FILE_STORAGE_DRIVER=local, s3, or r2 and provide the driver-specific environment variables',
      };
    }

    try {
      const status = initializeStorageRuntime();
      const blobStore = getBlobStore();
      const key = `runtime-check/${randomUUID()}.txt`;
      const body = Buffer.from('ploykit storage runtime check');

      await blobStore.put({
        key,
        body,
        contentType: 'text/plain',
      });

      const existsAfterPut = await blobStore.exists(key);
      const blob = await blobStore.get(key);
      await blobStore.delete(key);
      const existsAfterDelete = await blobStore.exists(key);

      if (!existsAfterPut || existsAfterDelete) {
        return {
          key: 'storage',
          status: 'failed',
          severity: 'error',
          message: 'BlobStore read/write/delete probe returned an unexpected result',
          details: {
            ...statusDetails(status),
            existsAfterPut,
            existsAfterDelete,
          },
          fix: 'Check BlobStore adapter configuration, credentials, bucket permissions, and local filesystem permissions',
        };
      }

      return {
        key: 'storage',
        status: 'ok',
        severity: 'info',
        message: 'BlobStore runtime verified',
        details: {
          ...statusDetails(status),
          probeBytes: Buffer.isBuffer(blob.body) ? blob.body.length : blob.size,
        },
      };
    } catch (error) {
      return {
        key: 'storage',
        status: 'failed',
        severity: 'error',
        message: `BlobStore validation failed: ${toMessage(error)}`,
        fix: 'Set FILE_STORAGE_DRIVER and adapter-specific environment variables, then rerun runtime:check',
      };
    }
  },
};

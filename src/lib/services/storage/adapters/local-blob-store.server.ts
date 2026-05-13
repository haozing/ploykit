/**
 * Local BlobStore Adapter
 *
 * Stores files on local filesystem.
 */

import fs from 'fs/promises';
import path from 'path';
import { env } from '@/lib/_core/env';
import { NotFoundError } from '@/lib/_core/errors';
import type {
  BlobStore,
  BlobStorePutInput,
  BlobStorePutResult,
  BlobStoreGetResult,
} from '../blob-store';

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function getStorageRoot(): string {
  const root = env.FILE_STORAGE_LOCAL_ROOT || path.join(process.cwd(), '.data', 'blobs');
  return root;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function resolveBlobPath(root: string, key: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, key);

  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Invalid blob key');
  }

  return resolvedPath;
}

export const localBlobStore: BlobStore = {
  async put(input: BlobStorePutInput): Promise<BlobStorePutResult> {
    const root = getStorageRoot();
    const filePath = resolveBlobPath(root, input.key);
    await ensureDir(path.dirname(filePath));

    await fs.writeFile(filePath, input.body);

    return {
      key: input.key,
      size: input.body.length,
    };
  },

  async get(key: string): Promise<BlobStoreGetResult> {
    const root = getStorageRoot();
    const filePath = resolveBlobPath(root, key);

    let buffer: Buffer;
    let stats: Awaited<ReturnType<typeof fs.stat>>;

    try {
      [buffer, stats] = await Promise.all([fs.readFile(filePath), fs.stat(filePath)]);
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new NotFoundError('Blob', key);
      }

      throw error;
    }

    if (!stats.isFile()) {
      throw new NotFoundError('Blob', key);
    }

    return {
      body: buffer,
      size: stats.size,
    };
  },

  async delete(key: string): Promise<void> {
    const root = getStorageRoot();
    const filePath = resolveBlobPath(root, key);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }

      throw error;
    }
  },

  async exists(key: string): Promise<boolean> {
    const root = getStorageRoot();
    try {
      const stats = await fs.stat(resolveBlobPath(root, key));
      return stats.isFile();
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }

      throw error;
    }
  },
};

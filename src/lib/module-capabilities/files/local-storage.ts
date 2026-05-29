import fs from 'node:fs/promises';
import path from 'node:path';
import {
  checksumBytes,
  sliceStorageRange,
  type ModuleFileStorageAdapter,
  type ModuleFileStorageHead,
  type ModuleFileStorageObject,
  type ModuleFileStoragePutInput,
  type ModuleFileStorageRange,
  type ModuleFileStorageSignedUrlInput,
} from './storage-adapter';

export interface CreateLocalModuleFileStorageOptions {
  rootDir: string;
  publicBaseUrl?: string;
}

function metadataPath(objectPath: string): string {
  return `${objectPath}.json`;
}

function safePath(rootDir: string, key: string): string {
  const resolved = path.resolve(rootDir, key);
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`MODULE_FILE_STORAGE_INVALID_KEY: ${key}`);
  }
  return resolved;
}

async function readMetadata(
  objectPath: string
): Promise<Omit<ModuleFileStorageHead, 'key'> | null> {
  try {
    return JSON.parse(await fs.readFile(metadataPath(objectPath), 'utf8')) as Omit<
      ModuleFileStorageHead,
      'key'
    >;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function isMetadataFile(rootDir: string, filePath: string): Promise<boolean> {
  if (!filePath.endsWith('.json')) {
    return false;
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      key?: unknown;
      checksum?: unknown;
      sizeBytes?: unknown;
      metadata?: unknown;
    };
    if (
      typeof parsed.key !== 'string' ||
      typeof parsed.checksum !== 'string' ||
      typeof parsed.sizeBytes !== 'number' ||
      !parsed.metadata ||
      typeof parsed.metadata !== 'object' ||
      Array.isArray(parsed.metadata)
    ) {
      return false;
    }
    const objectPath = safePath(rootDir, parsed.key);
    await fs.stat(objectPath);
    return path.resolve(metadataPath(objectPath)) === path.resolve(filePath);
  } catch {
    return false;
  }
}

async function listObjectPaths(rootDir: string, dir = rootDir): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listObjectPaths(rootDir, fullPath));
    } else if (entry.isFile() && !(await isMetadataFile(rootDir, fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

export function createLocalModuleFileStorage(
  options: CreateLocalModuleFileStorageOptions
): ModuleFileStorageAdapter {
  return {
    kind: 'local',
    async put(input: ModuleFileStoragePutInput) {
      const objectPath = safePath(options.rootDir, input.key);
      await fs.mkdir(path.dirname(objectPath), { recursive: true });
      await fs.writeFile(objectPath, input.body);
      const head: ModuleFileStorageHead = {
        key: input.key,
        sizeBytes: input.body.byteLength,
        checksum: checksumBytes(input.body),
        contentType: input.contentType,
        metadata: input.metadata ?? {},
      };
      await fs.writeFile(metadataPath(objectPath), JSON.stringify(head, null, 2));
      return head;
    },
    async get(key: string, range?: ModuleFileStorageRange) {
      const objectPath = safePath(options.rootDir, key);
      try {
        const [body, metadata] = await Promise.all([
          fs.readFile(objectPath),
          readMetadata(objectPath),
        ]);
        const head = metadata ?? {
          sizeBytes: body.byteLength,
          checksum: checksumBytes(body),
          metadata: {},
        };
        const ranged = sliceStorageRange(body, range);
        return {
          key,
          body: ranged,
          sizeBytes: ranged.byteLength,
          checksum: head.checksum,
          contentType: head.contentType,
          metadata: head.metadata,
        } satisfies ModuleFileStorageObject;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async head(key: string) {
      const objectPath = safePath(options.rootDir, key);
      const metadata = await readMetadata(objectPath);
      return metadata ? { key, ...metadata } : null;
    },
    async list(input = {}) {
      const root = path.resolve(options.rootDir);
      const objectPaths = await listObjectPaths(root);
      const heads = await Promise.all(
        objectPaths.map(async (objectPath) => {
          const key = path.relative(root, objectPath).split(path.sep).join('/');
          const metadata = await readMetadata(objectPath);
          if (metadata) {
            return { key, ...metadata };
          }
          const body = await fs.readFile(objectPath);
          return {
            key,
            sizeBytes: body.byteLength,
            checksum: checksumBytes(body),
            metadata: {},
          } satisfies ModuleFileStorageHead;
        })
      );
      return heads
        .filter((head) => !input.prefix || head.key.startsWith(input.prefix))
        .sort((left, right) => left.key.localeCompare(right.key))
        .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    },
    async delete(key: string) {
      const objectPath = safePath(options.rootDir, key);
      await fs.rm(objectPath, { force: true });
      await fs.rm(metadataPath(objectPath), { force: true });
    },
    async createSignedUrl(input: ModuleFileStorageSignedUrlInput) {
      const baseUrl = options.publicBaseUrl ?? 'local-file://';
      const url = new URL(input.key, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      url.searchParams.set('operation', input.operation);
      url.searchParams.set('expiresInSeconds', String(input.expiresInSeconds));
      if (input.disposition) {
        url.searchParams.set('disposition', input.disposition);
      }
      return url.toString();
    },
  };
}

import type { RuntimeStore, RuntimeStoreFileRecord } from './runtime-store-types';

type InMemoryFilesRuntimeStore = Pick<
  RuntimeStore,
  'createFile' | 'getFile' | 'updateFile' | 'listFiles'
>;

interface CreateInMemoryFilesRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryFilesRuntimeStore({
  now,
  createId,
}: CreateInMemoryFilesRuntimeStoreInput): InMemoryFilesRuntimeStore {
  const files = new Map<string, RuntimeStoreFileRecord>();

  function readFile(id: string): RuntimeStoreFileRecord {
    const file = files.get(id);
    if (!file) {
      throw new Error(`RUNTIME_STORE_FILE_NOT_FOUND: ${id}`);
    }
    return file;
  }

  return {
    async createFile(input) {
      const timestamp = iso(now);
      const file: RuntimeStoreFileRecord = {
        id: createId('file'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        ownerId: input.ownerId ?? input.actorId,
        name: input.name,
        purpose: input.purpose,
        status: input.status ?? 'uploading',
        visibility: input.visibility ?? 'private',
        contentType: input.contentType,
        sizeBytes: input.sizeBytes ?? 0,
        checksum: input.checksum,
        storageKey: input.storageKey,
        runId: input.runId,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAt: input.expiresAt,
      };
      files.set(file.id, file);
      return clone(file);
    },
    async getFile(id) {
      const file = files.get(id);
      return file ? clone(file) : null;
    },
    async updateFile(id, patch) {
      const previous = readFile(id);
      const next: RuntimeStoreFileRecord = {
        ...previous,
        ...patch,
        metadata: patch.metadata
          ? { ...previous.metadata, ...patch.metadata }
          : { ...previous.metadata },
        updatedAt: iso(now),
      };
      files.set(id, next);
      return clone(next);
    },
    async listFiles(query = {}) {
      return [...files.values()]
        .filter((file) => !query.productId || file.productId === query.productId)
        .filter((file) => query.workspaceId === undefined || file.workspaceId === query.workspaceId)
        .filter((file) => !query.moduleId || file.moduleId === query.moduleId)
        .filter((file) => !query.ownerId || file.ownerId === query.ownerId)
        .filter((file) => !query.purpose || file.purpose === query.purpose)
        .filter((file) => !query.status || file.status === query.status)
        .filter((file) => !query.visibility || file.visibility === query.visibility)
        .filter((file) => !query.runId || file.runId === query.runId)
        .filter((file) => query.includeDeleted || file.status !== 'deleted')
        .map((file) => clone(file));
    },
  };
}

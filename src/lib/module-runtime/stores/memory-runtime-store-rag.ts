import type {
  RuntimeStore,
  RuntimeStoreRagChunkRecord,
  RuntimeStoreRagSourceRecord,
} from './runtime-store-types';

type InMemoryRagRuntimeStore = Pick<
  RuntimeStore,
  | 'upsertRagSource'
  | 'listRagSources'
  | 'upsertRagChunk'
  | 'listRagChunks'
  | 'deleteRagChunkById'
  | 'deleteRagChunksBySource'
>;

interface CreateInMemoryRagRuntimeStoreInput {
  now: () => Date;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryRagRuntimeStore({
  now,
}: CreateInMemoryRagRuntimeStoreInput): InMemoryRagRuntimeStore {
  const ragSources = new Map<string, RuntimeStoreRagSourceRecord>();
  const ragChunks = new Map<string, RuntimeStoreRagChunkRecord>();

  return {
    async upsertRagSource(input) {
      const id = `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}`;
      const existing = ragSources.get(id);
      const timestamp = iso(now);
      const status = input.status ?? existing?.status ?? 'indexed';
      const record: RuntimeStoreRagSourceRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        sourceId: input.sourceId,
        status,
        contentDigest: input.contentDigest ?? existing?.contentDigest ?? null,
        contentLength: input.contentLength ?? existing?.contentLength ?? 0,
        chunkCount: input.chunkCount ?? existing?.chunkCount ?? 0,
        indexedAt:
          input.indexedAt ?? (status === 'indexed' ? timestamp : (existing?.indexedAt ?? null)),
        deletedAt:
          input.deletedAt ?? (status === 'deleted' ? timestamp : (existing?.deletedAt ?? null)),
        metadata: input.metadata ?? existing?.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      ragSources.set(id, record);
      return clone(record);
    },
    async listRagSources(query = {}) {
      return [...ragSources.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async upsertRagChunk(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}:${input.chunkIndex}`;
      const existing = ragChunks.get(id);
      const timestamp = iso(now);
      const record: RuntimeStoreRagChunkRecord = {
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        sourceId: input.sourceId,
        chunkIndex: input.chunkIndex,
        content: input.content,
        embedding: [...input.embedding],
        metadata: input.metadata ?? existing?.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      ragChunks.set(id, record);
      return clone(record);
    },
    async listRagChunks(query = {}) {
      return [...ragChunks.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .sort((left, right) => {
          const sourceOrder = left.sourceId.localeCompare(right.sourceId);
          return sourceOrder === 0 ? left.chunkIndex - right.chunkIndex : sourceOrder;
        })
        .map((record) => clone(record));
    },
    async deleteRagChunkById(input) {
      const record = ragChunks.get(input.id);
      if (
        !record ||
        record.productId !== input.productId ||
        record.workspaceId !== (input.workspaceId ?? null) ||
        (input.moduleId && record.moduleId !== input.moduleId)
      ) {
        return false;
      }
      ragChunks.delete(input.id);
      return true;
    },
    async deleteRagChunksBySource(input) {
      let deleted = 0;
      for (const [id, record] of ragChunks.entries()) {
        if (
          record.productId === input.productId &&
          record.workspaceId === (input.workspaceId ?? null) &&
          (!input.moduleId || record.moduleId === input.moduleId) &&
          record.sourceId === input.sourceId
        ) {
          ragChunks.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
}

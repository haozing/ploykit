import type { RuntimeStore } from '../../module-runtime/stores/runtime-store-types';
import type {
  RagVectorRecord,
  RagVectorSearchInput,
  RagVectorSourceRecord,
  RagVectorStore,
} from './vector-store';

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function sourceKey(input: {
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
}): string {
  return `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}`;
}

function chunkIndex(metadata: Record<string, unknown>): number {
  const value = Number(metadata.chunkIndex ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function createRuntimeStoreRagVectorStore(store: RuntimeStore): RagVectorStore {
  return {
    async upsertSource(record: RagVectorSourceRecord) {
      const source = await store.upsertRagSource({
        productId: record.productId,
        workspaceId: record.workspaceId ?? null,
        moduleId: record.moduleId,
        sourceId: record.sourceId,
        status: record.status,
        contentDigest: record.contentDigest,
        contentLength: record.contentLength,
        chunkCount: record.chunkCount,
        metadata: record.metadata,
      });
      return {
        productId: source.productId,
        workspaceId: source.workspaceId,
        moduleId: source.moduleId,
        sourceId: source.sourceId,
        status: source.status,
        contentDigest: source.contentDigest ?? undefined,
        contentLength: source.contentLength,
        chunkCount: source.chunkCount,
        metadata: source.metadata,
      };
    },
    async upsert(record: RagVectorRecord) {
      const chunk = await store.upsertRagChunk({
        id: record.id,
        productId: record.productId,
        workspaceId: record.workspaceId ?? null,
        moduleId: record.moduleId,
        sourceId: record.sourceId,
        chunkIndex: Number(record.metadata.chunkIndex ?? 0),
        content: record.content,
        embedding: record.embedding,
        metadata: record.metadata,
      });
      return {
        id: chunk.id,
        productId: chunk.productId,
        workspaceId: chunk.workspaceId,
        moduleId: chunk.moduleId,
        sourceId: chunk.sourceId,
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
      };
    },
    async search(input: RagVectorSearchInput) {
      const [chunks, sources] = await Promise.all([
        store.listRagChunks({
          productId: input.productId,
          workspaceId: input.workspaceId ?? null,
          moduleId: input.moduleId,
        }),
        store.listRagSources({
          productId: input.productId,
          workspaceId: input.workspaceId ?? null,
          moduleId: input.moduleId,
        }),
      ]);
      const sourceLedger = new Map(sources.map((source) => [sourceKey(source), source]));
      return chunks
        .filter((chunk) => {
          const source = sourceLedger.get(sourceKey(chunk));
          if (!source) {
            return true;
          }
          return source.status === 'indexed' && chunkIndex(chunk.metadata) < source.chunkCount;
        })
        .map((chunk) => ({
          id: chunk.id,
          productId: chunk.productId,
          workspaceId: chunk.workspaceId,
          moduleId: chunk.moduleId,
          sourceId: chunk.sourceId,
          content: chunk.content,
          embedding: chunk.embedding,
          metadata: chunk.metadata,
          score: dot(input.embedding, chunk.embedding),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, input.limit ?? 5);
    },
    deleteById(input) {
      return store.deleteRagChunkById(input);
    },
    async deleteBySource(input) {
      const deleted = await store.deleteRagChunksBySource(input);
      if (input.moduleId) {
        await store.upsertRagSource({
          productId: input.productId,
          workspaceId: input.workspaceId ?? null,
          moduleId: input.moduleId,
          sourceId: input.sourceId,
          status: 'deleted',
          chunkCount: 0,
          metadata: { deletedRecords: deleted },
        });
      }
      return deleted;
    },
  };
}

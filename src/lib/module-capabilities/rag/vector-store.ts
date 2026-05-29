export interface RagVectorRecord {
  id: string;
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export type RagVectorSourceStatus = 'indexed' | 'deleted' | 'stale';

export interface RagVectorSourceRecord {
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
  status: RagVectorSourceStatus;
  contentDigest?: string;
  contentLength?: number;
  chunkCount?: number;
  metadata: Record<string, unknown>;
}

export interface RagVectorSearchInput {
  productId: string;
  workspaceId?: string | null;
  moduleId?: string;
  embedding: number[];
  limit?: number;
}

export interface RagVectorStore {
  upsertSource?(record: RagVectorSourceRecord): Promise<RagVectorSourceRecord>;
  upsert(record: RagVectorRecord): Promise<RagVectorRecord>;
  search(input: RagVectorSearchInput): Promise<(RagVectorRecord & { score: number })[]>;
  deleteById(input: {
    productId: string;
    workspaceId?: string | null;
    moduleId?: string;
    id: string;
  }): Promise<boolean>;
  deleteBySource(input: {
    productId: string;
    workspaceId?: string | null;
    moduleId?: string;
    sourceId: string;
  }): Promise<number>;
}

function sourceKey(input: {
  productId: string;
  workspaceId?: string | null;
  moduleId: string;
  sourceId: string;
}): string {
  return `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}`;
}

function chunkIndex(record: RagVectorRecord): number {
  const value = Number(record.metadata.chunkIndex ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function isSearchableSource(
  source: RagVectorSourceRecord | undefined,
  record: RagVectorRecord
): boolean {
  if (!source) {
    return true;
  }
  if (source.status !== 'indexed') {
    return false;
  }
  if (source.chunkCount !== undefined && chunkIndex(record) >= source.chunkCount) {
    return false;
  }
  return true;
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

export function createInMemoryRagVectorStore(): RagVectorStore {
  const records = new Map<string, RagVectorRecord>();
  const sources = new Map<string, RagVectorSourceRecord>();

  return {
    async upsertSource(record) {
      const source = { ...record, metadata: { ...record.metadata } };
      sources.set(sourceKey(source), source);
      return { ...source, metadata: { ...source.metadata } };
    },
    async upsert(record) {
      records.set(record.id, { ...record, metadata: { ...record.metadata } });
      return { ...record, metadata: { ...record.metadata } };
    },
    async search(input) {
      return [...records.values()]
        .filter((record) => record.productId === input.productId)
        .filter((record) => record.workspaceId === input.workspaceId)
        .filter((record) => !input.moduleId || record.moduleId === input.moduleId)
        .filter((record) => isSearchableSource(sources.get(sourceKey(record)), record))
        .map((record) => ({
          ...record,
          metadata: { ...record.metadata },
          score: dot(input.embedding, record.embedding),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, input.limit ?? 5);
    },
    async deleteById(input) {
      const record = records.get(input.id);
      if (
        !record ||
        record.productId !== input.productId ||
        record.workspaceId !== input.workspaceId ||
        (input.moduleId && record.moduleId !== input.moduleId)
      ) {
        return false;
      }
      records.delete(input.id);
      return true;
    },
    async deleteBySource(input) {
      let deleted = 0;
      for (const [id, record] of records.entries()) {
        if (
          record.productId === input.productId &&
          record.workspaceId === input.workspaceId &&
          (!input.moduleId || record.moduleId === input.moduleId) &&
          record.sourceId === input.sourceId
        ) {
          records.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
  };
}

import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore } from './runtime-store-types';
import { mapRagChunk, mapRagSource, type Row } from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter, runtimeWorkspaceKey } from './postgres-runtime-store-utils';

export type PostgresRagStore = Pick<
  RuntimeStore,
  | 'upsertRagSource'
  | 'listRagSources'
  | 'upsertRagChunk'
  | 'listRagChunks'
  | 'deleteRagChunkById'
  | 'deleteRagChunksBySource'
>;

export interface CreatePostgresRagStoreOptions {
  database: ModuleDataPostgresExecutor;
}

export function createPostgresRagStore(options: CreatePostgresRagStoreOptions): PostgresRagStore {
  const { database } = options;

  return {
    async upsertRagSource(input) {
      const id = `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}`;
      const result = await database.query<Row>(
        `insert into module_rag_sources (
          id, product_id, workspace_id, module_id, source_id, status,
          content_digest, content_length, chunk_count, indexed_at, deleted_at, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9,
          coalesce($10::timestamptz, case when $6 = 'indexed' then now() else null end),
          coalesce($11::timestamptz, case when $6 = 'deleted' then now() else null end),
          $12::jsonb
        )
        on conflict (id)
        do update set
          status = excluded.status,
          content_digest = coalesce(excluded.content_digest, module_rag_sources.content_digest),
          content_length = excluded.content_length,
          chunk_count = excluded.chunk_count,
          indexed_at = coalesce(excluded.indexed_at, module_rag_sources.indexed_at),
          deleted_at = coalesce(excluded.deleted_at, module_rag_sources.deleted_at),
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.sourceId,
          input.status ?? 'indexed',
          input.contentDigest ?? null,
          input.contentLength ?? 0,
          input.chunkCount ?? 0,
          input.indexedAt ?? null,
          input.deletedAt ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRagSource(result.rows[0]!);
    },
    async listRagSources(query = {}) {
      const result = await database.query<Row>(
        `select * from module_rag_sources
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or source_id = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.sourceId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapRagSource);
    },
    async upsertRagChunk(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.sourceId}:${input.chunkIndex}`;
      const result = await database.query<Row>(
        `insert into module_rag_chunks (
          id, product_id, workspace_id, module_id, source_id, chunk_index,
          content, embedding, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        on conflict (id)
        do update set
          content = excluded.content,
          embedding = excluded.embedding,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.sourceId,
          input.chunkIndex,
          input.content,
          json(input.embedding),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRagChunk(result.rows[0]!);
    },
    async listRagChunks(query = {}) {
      const result = await database.query<Row>(
        `select * from module_rag_chunks
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or source_id = $4)
         order by source_id asc, chunk_index asc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.sourceId ?? null,
        ]
      );
      return result.rows.map(mapRagChunk);
    },
    async deleteRagChunkById(input) {
      const result = await database.query<{ id: string }>(
        `delete from module_rag_chunks
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and ($3::text is null or module_id = $3)
           and id = $4
         returning id`,
        [input.productId, runtimeWorkspaceKey(input.workspaceId), input.moduleId ?? null, input.id]
      );
      return result.rows.length > 0;
    },
    async deleteRagChunksBySource(input) {
      const result = await database.query<{ id: string }>(
        `delete from module_rag_chunks
         where product_id = $1
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and source_id = $4
         returning id`,
        [
          input.productId,
          runtimeWorkspaceKey(input.workspaceId),
          input.moduleId ?? null,
          input.sourceId,
        ]
      );
      return result.rows.length;
    },
  };
}

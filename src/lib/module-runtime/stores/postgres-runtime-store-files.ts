import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapFile, type Row } from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter } from './postgres-runtime-store-utils';

export type PostgresFileStore = Pick<
  RuntimeStore,
  'createFile' | 'getFile' | 'updateFile' | 'listFiles'
>;

export interface CreatePostgresFileStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresFileStore(
  options: CreatePostgresFileStoreOptions
): PostgresFileStore {
  const { database, createId } = options;

  return {
    async createFile(input) {
      const result = await database.query<Row>(
        `insert into module_files (
          id, product_id, workspace_id, module_id, owner_id, name, purpose, status,
          visibility, content_type, size_bytes, checksum, storage_key, run_id, metadata, expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::timestamptz)
        returning *`,
        [
          createId('file'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.ownerId ?? input.actorId ?? null,
          input.name,
          input.purpose,
          input.status ?? 'uploading',
          input.visibility ?? 'private',
          input.contentType ?? null,
          input.sizeBytes ?? 0,
          input.checksum ?? null,
          input.storageKey,
          input.runId ?? null,
          json(input.metadata ?? {}),
          input.expiresAt ?? null,
        ]
      );
      return mapFile(result.rows[0]!);
    },
    async getFile(id) {
      const result = await database.query<Row>('select * from module_files where id = $1', [id]);
      return result.rows[0] ? mapFile(result.rows[0]) : null;
    },
    async updateFile(id, patch) {
      const result = await database.query<Row>(
        `update module_files
         set status = coalesce($2, status),
             visibility = coalesce($3, visibility),
             content_type = coalesce($4, content_type),
             size_bytes = coalesce($5, size_bytes),
             checksum = coalesce($6, checksum),
             metadata = metadata || $7::jsonb,
             expires_at = coalesce($8::timestamptz, expires_at),
             published_at = coalesce($9::timestamptz, published_at),
             deleted_at = coalesce($10::timestamptz, deleted_at),
             quarantined_at = coalesce($11::timestamptz, quarantined_at),
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.status ?? null,
          patch.visibility ?? null,
          patch.contentType ?? null,
          patch.sizeBytes ?? null,
          patch.checksum ?? null,
          json(patch.metadata ?? {}),
          patch.expiresAt ?? null,
          patch.publishedAt ?? null,
          patch.deletedAt ?? null,
          patch.quarantinedAt ?? null,
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_FILE_NOT_FOUND: ${id}`);
      }
      return mapFile(result.rows[0]);
    },
    async listFiles(query = {}) {
      const result = await database.query<Row>(
        `select * from module_files
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or owner_id = $4)
           and ($5::text is null or purpose = $5)
           and ($6::text is null or status = $6)
           and ($7::text is null or visibility = $7)
           and ($8::text is null or run_id = $8)
           and ($9::boolean = true or status <> 'deleted')
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.ownerId ?? null,
          query.purpose ?? null,
          query.status ?? null,
          query.visibility ?? null,
          query.runId ?? null,
          query.includeDeleted ?? false,
        ]
      );
      return result.rows.map(mapFile);
    },
  };
}

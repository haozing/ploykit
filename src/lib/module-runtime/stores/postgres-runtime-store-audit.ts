import type { ModuleDataPostgresExecutor } from '../data';
import { createAuditEnvelope } from '../observability/audit-metadata';
import type { RuntimeStore } from './runtime-store-types';
import { mapAudit, type Row } from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresAuditStore = Pick<RuntimeStore, 'recordAudit' | 'listAudit'>;

export interface CreatePostgresAuditStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresAuditStore(
  options: CreatePostgresAuditStoreOptions
): PostgresAuditStore {
  const { database, createId } = options;

  return {
    async recordAudit(input) {
      const id = createId('audit');
      const createdAt = new Date().toISOString();
      const previous = await database.query<Row>(
        `select metadata #>> '{_audit,recordHash}' as record_hash
         from module_audit_logs
         where product_id = $1
           and (metadata #>> '{_audit,recordHash}') is not null
         order by created_at desc
         limit 1`,
        [input.productId]
      );
      const previousHash =
        typeof previous.rows[0]?.record_hash === 'string' ? previous.rows[0].record_hash : null;
      const envelope = createAuditEnvelope({
        id,
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        type: input.type,
        metadata: input.metadata ?? {},
        createdAt,
        previousHash,
      });
      const result = await database.query<Row>(
        `insert into module_audit_logs (
          id, product_id, workspace_id, module_id, actor_id, type, metadata, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.actorId ?? null,
          input.type,
          json(envelope.storedMetadata),
          createdAt,
        ]
      );
      return mapAudit(result.rows[0]!);
    },
    async listAudit(query = {}) {
      const result = await database.query<Row>(
        `select * from module_audit_logs
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or module_id = $3)
           and ($4::text is null or actor_id = $4)
           and ($5::text is null or type = $5)
           and ($6::timestamptz is null or created_at >= $6::timestamptz)
           and ($7::timestamptz is null or created_at <= $7::timestamptz)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.moduleId ?? null,
          query.actorId ?? null,
          query.type ?? null,
          query.from ?? null,
          query.to ?? null,
        ]
      );
      return result.rows.map(mapAudit);
    },
  };
}

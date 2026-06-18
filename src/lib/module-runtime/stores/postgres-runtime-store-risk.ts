import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore } from './runtime-store-types';
import { mapRiskBlock, mapRiskEvent, type Row } from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter } from './postgres-runtime-store-utils';

export type PostgresRiskStore = Pick<
  RuntimeStore,
  'recordRiskEvent' | 'upsertRiskBlock' | 'releaseRiskBlock' | 'listRiskEvents' | 'listRiskBlocks'
>;

export interface CreatePostgresRiskStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresRiskStore(options: CreatePostgresRiskStoreOptions): PostgresRiskStore {
  const { database, createId } = options;

  return {
    async recordRiskEvent(input) {
      const result = await database.query<Row>(
        `insert into module_risk_events (
          id, product_id, workspace_id, module_id, subject_type, subject_id,
          type, severity, status, source, source_id, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        returning *`,
        [
          input.id ?? createId('risk_event'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.subjectType ?? null,
          input.subjectId ?? null,
          input.type,
          input.severity ?? 'medium',
          input.status ?? 'open',
          input.source ?? null,
          input.sourceId ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRiskEvent(result.rows[0]!);
    },
    async upsertRiskBlock(input) {
      const id = input.id ?? createId('risk_block');
      const result = await database.query<Row>(
        `insert into module_risk_blocks (
          id, product_id, workspace_id, subject_type, subject_id, scope, reason,
          expires_at, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb)
        on conflict (
          product_id,
          (coalesce(workspace_id, ''::text)),
          subject_type,
          subject_id,
          (coalesce(scope, ''::text))
        )
        where released_at is null
        do update set
          reason = excluded.reason,
          expires_at = excluded.expires_at,
          idempotency_key = excluded.idempotency_key,
          metadata = module_risk_blocks.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.subjectType,
          input.subjectId,
          input.scope ?? null,
          input.reason,
          input.expiresAt ?? null,
          input.idempotencyKey ?? null,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapRiskBlock(result.rows[0]!);
    },
    async releaseRiskBlock(id, patch = {}) {
      const result = await database.query<Row>(
        `update module_risk_blocks
         set released_at = coalesce($2::timestamptz, now()),
             released_by = $3,
             release_reason = $4,
             metadata = metadata || $5::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          patch.releasedAt ?? null,
          patch.releasedBy ?? null,
          patch.reason ?? null,
          json(redactSensitive(patch.metadata ?? {})),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_RISK_BLOCK_NOT_FOUND: ${id}`);
      }
      return mapRiskBlock(result.rows[0]);
    },
    async listRiskEvents(query = {}) {
      const result = await database.query<Row>(
        `select * from module_risk_events
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or coalesce(module_id, ''::text) = $3)
           and ($4::text is null or subject_type = $4)
           and ($5::text is null or subject_id = $5)
           and ($6::text is null or type = $6)
           and ($7::text is null or severity = $7)
           and ($8::text is null or status = $8)
           and ($9::text is null or source = $9)
           and ($10::text is null or source_id = $10)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.subjectType ?? null,
          query.subjectId ?? null,
          query.type ?? null,
          query.severity ?? null,
          query.status ?? null,
          query.source ?? null,
          query.sourceId ?? null,
        ]
      );
      return result.rows.map(mapRiskEvent);
    },
    async listRiskBlocks(query = {}) {
      const result = await database.query<Row>(
        `select * from module_risk_blocks
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or subject_type = $3)
           and ($4::text is null or subject_id = $4)
           and ($5::text is null or coalesce(scope, ''::text) = $5)
           and ($6::boolean is true or released_at is null)
         order by updated_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.subjectType ?? null,
          query.subjectId ?? null,
          query.scope === undefined ? null : (query.scope ?? ''),
          query.includeReleased ?? false,
        ]
      );
      return result.rows.map(mapRiskBlock);
    },
  };
}

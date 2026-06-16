import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore } from './runtime-store-types';
import { mapWorker, type Row } from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresWorkerStore = Pick<RuntimeStore, 'upsertWorkerHeartbeat' | 'listWorkers'>;

export interface CreatePostgresWorkerStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresWorkerStore(
  options: CreatePostgresWorkerStoreOptions
): PostgresWorkerStore {
  const { database, createId } = options;

  return {
    async upsertWorkerHeartbeat(input) {
      const result = await database.query<Row>(
        `insert into module_worker_registry (
          id, product_id, workspace_id, worker_id, profile, status, queue_profile,
          heartbeat_at, last_drain_at, last_duration_ms, processed, failed,
          dead_lettered, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7,
          coalesce($8::timestamptz, now()), $9::timestamptz, $10, $11, $12,
          $13, $14::jsonb
        )
        on conflict (product_id, (coalesce(workspace_id, ''::text)), worker_id)
        do update set
          profile = excluded.profile,
          status = excluded.status,
          queue_profile = excluded.queue_profile,
          heartbeat_at = excluded.heartbeat_at,
          last_drain_at = coalesce(excluded.last_drain_at, module_worker_registry.last_drain_at),
          last_duration_ms = excluded.last_duration_ms,
          processed = excluded.processed,
          failed = excluded.failed,
          dead_lettered = excluded.dead_lettered,
          metadata = module_worker_registry.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('worker'),
          input.productId,
          input.workspaceId ?? '',
          input.workerId,
          input.profile ?? 'default',
          input.status ?? 'running',
          input.queueProfile ?? 'default',
          input.heartbeatAt ?? null,
          input.lastDrainAt ?? null,
          input.lastDurationMs ?? 0,
          input.processed ?? 0,
          input.failed ?? 0,
          input.deadLettered ?? 0,
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapWorker(result.rows[0]!);
    },
    async listWorkers(query = {}) {
      const result = await database.query<Row>(
        `select * from module_worker_registry
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or worker_id = $3)
           and ($4::text is null or status = $4)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.workerId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapWorker);
    },
  };
}

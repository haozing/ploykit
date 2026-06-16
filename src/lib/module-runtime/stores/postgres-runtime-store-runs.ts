import type { ModuleRunLogEntry, ModuleRunRecord, ModuleRunStatus } from '../runs';
import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { CreateRuntimeStoreRunInput, RuntimeStore } from './runtime-store-types';
import { mapRun, type Row } from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter, toIso } from './postgres-runtime-store-utils';

export type PostgresRunStore = Pick<
  RuntimeStore,
  'createRun' | 'getRun' | 'listRuns' | 'updateRunStatus' | 'appendRunLog'
>;

export interface CreatePostgresRunStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresRunStore(
  options: CreatePostgresRunStoreOptions
): PostgresRunStore {
  const { database, createId } = options;

  async function readRun<TInput = unknown>(id: string): Promise<ModuleRunRecord<TInput>> {
    const run = await database.query<Row>('select * from module_runs where id = $1', [id]);
    if (!run.rows[0]) {
      throw new Error(`RUNTIME_STORE_RUN_NOT_FOUND: ${id}`);
    }
    const logs = await database.query<Row>(
      'select * from module_run_logs where run_id = $1 order by at asc, id asc',
      [id]
    );
    return mapRun(
      run.rows[0],
      logs.rows.map((row) => ({
        at: toIso(row.at)!,
        level: row.level,
        message: row.message,
        metadata: row.metadata ?? undefined,
      }))
    ) as ModuleRunRecord<TInput>;
  }

  return {
    async createRun<TInput = unknown>(input: CreateRuntimeStoreRunInput<TInput>) {
      if (input.id) {
        const existingById = await database.query<Row>(
          'select id, idempotency_key from module_runs where id = $1',
          [input.id]
        );
        if (existingById.rows[0]) {
          const existingIdempotencyKey = existingById.rows[0].idempotency_key ?? undefined;
          if (input.idempotencyKey && existingIdempotencyKey === input.idempotencyKey) {
            return readRun<TInput>(input.id);
          }
          throw new Error(`RUNTIME_STORE_RUN_ID_CONFLICT: ${input.id}`);
        }
      }
      const id = input.id ?? createId('run');
      const result = await database.query<Row>(
        `insert into module_runs (
          id, product_id, workspace_id, module_id, kind, name, status, progress,
          attempt, max_attempts, input, cost_ref, idempotency_key
        )
        values ($1, $2, $3, $4, $5, $6, 'queued', 0, 0, $7, $8::jsonb, $9, $10)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), module_id, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_runs.updated_at
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.kind,
          input.name,
          input.maxAttempts ?? 1,
          json(input.input),
          input.costRef ?? null,
          input.idempotencyKey ?? null,
        ]
      );
      return mapRun(result.rows[0]!) as ModuleRunRecord<TInput>;
    },
    async getRun(id: string) {
      const result = await database.query<Row>('select id from module_runs where id = $1', [id]);
      return result.rows[0] ? readRun(id) : null;
    },
    async listRuns(query = {}) {
      const result = await database.query<Row>(
        `select * from module_runs
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or status = $4)
           and ($5::text is null or kind = $5)
           and ($6::text is null or idempotency_key = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.status ?? null,
          query.kind ?? null,
          query.idempotencyKey ?? null,
        ]
      );
      return result.rows.map((row) => mapRun(row));
    },
    async updateRunStatus(id: string, status: ModuleRunStatus, patch = {}) {
      await database.query(
        `update module_runs
         set status = $2,
             progress = coalesce($3, progress),
             result = coalesce($4::jsonb, result),
             error = $5::jsonb,
             updated_at = now(),
             started_at = case when $2 = 'running' then coalesce(started_at, now()) else started_at end,
             completed_at = case when $2 in ('succeeded', 'failed', 'canceled') then now() else completed_at end,
             cancel_requested_at = case when $2 = 'cancel_requested' then coalesce(cancel_requested_at, now()) else cancel_requested_at end,
             canceled_at = case when $2 = 'canceled' then coalesce(canceled_at, now()) else canceled_at end
         where id = $1`,
        [id, status, patch.progress ?? null, json(patch.result), json(patch.error)]
      );
      return readRun(id);
    },
    async appendRunLog(
      id: string,
      level: ModuleRunLogEntry['level'],
      message: string,
      metadata?: Record<string, unknown>
    ) {
      await database.query(
        `insert into module_run_logs (run_id, level, message, metadata)
         values ($1, $2, $3, $4::jsonb)`,
        [id, level, message, json(redactSensitive(metadata))]
      );
      await database.query('update module_runs set updated_at = now() where id = $1', [id]);
      return readRun(id);
    },
  };
}

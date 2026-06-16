import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type {
  EnqueueRuntimeStoreOutboxInput,
  RuntimeStore,
  RuntimeStoreOutboxRecord,
  RuntimeStoreOutboxStatus,
} from './runtime-store-types';
import { mapDelivery, mapOutbox, type Row } from './postgres-runtime-store-mappers';
import {
  deliveryErrorFrom,
  errorFrom,
  json,
  runtimeWorkspaceFilter,
} from './postgres-runtime-store-utils';

export type PostgresOutboxStore = Pick<
  RuntimeStore,
  'enqueueOutbox' | 'listOutbox' | 'claimOutbox' | 'markOutbox' | 'recordDelivery' | 'listDeliveries'
>;

export interface CreatePostgresOutboxStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresOutboxStore(
  options: CreatePostgresOutboxStoreOptions
): PostgresOutboxStore {
  const { database, createId } = options;

  return {
    async enqueueOutbox<TPayload = unknown>(input: EnqueueRuntimeStoreOutboxInput<TPayload>) {
      const result = await database.query<Row>(
        `insert into module_outbox (
          id, product_id, workspace_id, module_id, name, payload, metadata, status,
          idempotency_key, scheduled_at, priority
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'queued', $8, $9, $10)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), name, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_outbox.updated_at
        returning *`,
        [
          createId('outbox'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.name,
          json(input.payload),
          json(input.metadata ?? {}),
          input.idempotencyKey ?? null,
          input.scheduledAt ?? null,
          input.priority ?? 0,
        ]
      );
      return mapOutbox(result.rows[0]!) as RuntimeStoreOutboxRecord<TPayload>;
    },
    async listOutbox(query = {}) {
      const result = await database.query<Row>(
        `select * from module_outbox
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or status = $3)
           and ($4::text is null or name = $4)
           and ($5::text is null or name like $5 || '%')
         order by created_at asc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.status ?? null,
          query.name ?? null,
          query.namePrefix ?? null,
        ]
      );
      return result.rows.map(mapOutbox);
    },
    async claimOutbox(query = {}) {
      const result = await database.query<Row>(
        `with picked as (
           select id
           from module_outbox
           where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or name = $3)
           and ($4::text is null or name like $4 || '%')
           and (
             (status = any($5::text[]) and (scheduled_at is null or scheduled_at <= now()))
             or (status = 'processing' and lease_expires_at is not null and lease_expires_at <= now())
           )
          order by priority desc, coalesce(scheduled_at, created_at), created_at asc
           limit $6
           for update skip locked
         )
         update module_outbox
         set status = 'processing',
             attempts = attempts + 1,
             lease_owner = $7,
             lease_expires_at = now() + ($8::text || ' milliseconds')::interval,
             heartbeat_at = now(),
             updated_at = now()
         where id in (select id from picked)
         returning *`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.name ?? null,
          query.namePrefix ?? null,
          query.statuses ?? ['queued', 'failed'],
          query.limit ?? 50,
          query.leaseOwner ?? 'postgres-runtime-worker',
          query.leaseMs ?? 60_000,
        ]
      );
      return result.rows.map(mapOutbox);
    },
    async markOutbox(
      id: string,
      status: RuntimeStoreOutboxStatus,
      error?: Error | string,
      options = {}
    ) {
      const result = await database.query<Row>(
        `update module_outbox
         set status = $2,
             attempts = case when $2 = 'processing' then attempts + 1 else attempts end,
             processed_at = case when $2 = 'processed' then now() else processed_at end,
             error = $3::jsonb,
             scheduled_at = $4::timestamptz,
             lease_owner = case when $2 = 'processing' then lease_owner else null end,
             lease_expires_at = case when $2 = 'processing' then lease_expires_at else null end,
             heartbeat_at = case when $2 = 'processing' then coalesce($5::timestamptz, now()) else null end,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          status,
          json(errorFrom(error)),
          options.scheduledAt ?? null,
          options.heartbeatAt ?? null,
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_OUTBOX_NOT_FOUND: ${id}`);
      }
      return mapOutbox(result.rows[0]);
    },
    async recordDelivery(input) {
      const result = await database.query<Row>(
        `insert into module_delivery_ledger (
          id, product_id, workspace_id, module_id, actor_id, kind, source, target,
          status, attempts, outbox_id, run_id, receipt_id, event_id, email_id,
          worker_id, correlation_id, causation_id, next_retry_at, error_category,
          error, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19::timestamptz, $20,
          $21::jsonb, $22::jsonb
        )
        returning *`,
        [
          createId('delivery'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? null,
          input.actorId ?? null,
          input.kind,
          input.source,
          input.target,
          input.status,
          input.attempts ?? 0,
          input.outboxId ?? null,
          input.runId ?? null,
          input.receiptId ?? null,
          input.eventId ?? null,
          input.emailId ?? null,
          input.workerId ?? null,
          input.correlationId ?? null,
          input.causationId ?? null,
          input.nextRetryAt ?? null,
          input.errorCategory ?? null,
          json(deliveryErrorFrom(input.error)),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapDelivery(result.rows[0]!);
    },
    async listDeliveries(query = {}) {
      const result = await database.query<Row>(
        `select * from module_delivery_ledger
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = coalesce($2, ''))
           and ($3::text is null or coalesce(module_id, '') = coalesce($3, ''))
           and ($4::text is null or kind = $4)
           and ($5::text is null or status = $5)
           and ($6::text is null or outbox_id = $6)
           and ($7::text is null or run_id = $7)
           and ($8::text is null or receipt_id = $8)
           and ($9::text is null or event_id = $9)
           and ($10::text is null or email_id = $10)
           and ($11::text is null or worker_id = $11)
           and ($12::text is null or correlation_id = $12)
         order by created_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.moduleId === undefined ? null : (query.moduleId ?? ''),
          query.kind ?? null,
          query.status ?? null,
          query.outboxId ?? null,
          query.runId ?? null,
          query.receiptId ?? null,
          query.eventId ?? null,
          query.emailId ?? null,
          query.workerId ?? null,
          query.correlationId ?? null,
        ]
      );
      return result.rows.map(mapDelivery);
    },
  };
}

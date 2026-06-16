import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore, RuntimeStoreMeteringStatus } from './runtime-store-types';
import { mapMetering, mapUsage, type Row } from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresMeteringStore = Pick<
  RuntimeStore,
  | 'recordUsage'
  | 'listUsage'
  | 'recordMetering'
  | 'getMetering'
  | 'updateMeteringStatus'
  | 'listMetering'
>;

export interface CreatePostgresMeteringStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresMeteringStore(
  options: CreatePostgresMeteringStoreOptions
): PostgresMeteringStore {
  const { database, createId } = options;

  return {
    async recordUsage(input) {
      const result = await database.query<Row>(
        `insert into module_usage_records (
          id, product_id, workspace_id, module_id, meter, quantity, unit, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        on conflict (product_id, module_id, meter, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_usage_records.metadata
        returning *`,
        [
          createId('usage'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.meter,
          input.quantity ?? 1,
          input.unit ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapUsage(result.rows[0]!);
    },
    async listUsage(query = {}) {
      const result = await database.query<Row>(
        `select * from module_usage_records
         where ($1::text is null or product_id = $1)
           and ($2::text is null or module_id = $2)
           and ($3::text is null or meter = $3)
         order by created_at desc`,
        [query.productId ?? null, query.moduleId ?? null, query.meter ?? null]
      );
      return result.rows.map(mapUsage);
    },
    async recordMetering(input) {
      const result = await database.query<Row>(
        `insert into module_metering_ledger (
          id, product_id, workspace_id, module_id, meter, quantity, unit, status,
          idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'authorized', $8, $9::jsonb)
        on conflict (product_id, module_id, meter, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_metering_ledger.metadata
        returning *`,
        [
          createId('meter'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId,
          input.meter,
          input.quantity ?? 1,
          input.unit ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapMetering(result.rows[0]!);
    },
    async getMetering(id) {
      const result = await database.query<Row>(
        'select * from module_metering_ledger where id = $1',
        [id]
      );
      return result.rows[0] ? mapMetering(result.rows[0]) : null;
    },
    async updateMeteringStatus(
      id: string,
      status: RuntimeStoreMeteringStatus,
      metadata?: Record<string, unknown>
    ) {
      const result = await database.query<Row>(
        `update module_metering_ledger
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_METERING_NOT_FOUND: ${id}`);
      }
      return mapMetering(result.rows[0]);
    },
    async listMetering(query = {}) {
      const result = await database.query<Row>(
        `select * from module_metering_ledger
         where ($1::text is null or product_id = $1)
           and ($2::text is null or module_id = $2)
           and ($3::text is null or meter = $3)
           and ($4::text is null or status = $4)
         order by created_at desc`,
        [query.productId ?? null, query.moduleId ?? null, query.meter ?? null, query.status ?? null]
      );
      return result.rows.map(mapMetering);
    },
  };
}

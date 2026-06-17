import type { ModuleDataPostgresExecutor } from '../data';
import type {
  RuntimeStore,
  RuntimeStoreIdempotencyRecord,
} from './runtime-store-types';
import {
  mapIdempotencyKey,
  type Row,
} from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter } from './postgres-runtime-store-utils';

export type PostgresIdempotencyStore = Pick<
  RuntimeStore,
  | 'beginIdempotencyKey'
  | 'completeIdempotencyKey'
  | 'getIdempotencyKey'
  | 'listIdempotencyKeys'
  | 'deleteExpiredIdempotencyKeys'
>;

export interface CreatePostgresIdempotencyStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

function defaultExpiresAt(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

export function createPostgresIdempotencyStore(
  options: CreatePostgresIdempotencyStoreOptions
): PostgresIdempotencyStore {
  const { database, createId } = options;

  async function findByScope(input: {
    productId: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    namespace: string;
    key: string;
  }): Promise<RuntimeStoreIdempotencyRecord | null> {
    const result = await database.query<Row>(
      `select * from module_idempotency_keys
       where product_id = $1
         and coalesce(environment_id, ''::text) = $2
         and coalesce(workspace_id, ''::text) = $3
         and namespace = $4
         and idempotency_key = $5
       limit 1`,
      [
        input.productId,
        input.environmentId ?? '',
        input.workspaceId ?? '',
        input.namespace,
        input.key,
      ]
    );
    return result.rows[0] ? mapIdempotencyKey(result.rows[0]) : null;
  }

  return {
    async beginIdempotencyKey(input) {
      await database.query(
        `delete from module_idempotency_keys
         where product_id = $1
           and coalesce(environment_id, ''::text) = $2
           and coalesce(workspace_id, ''::text) = $3
           and namespace = $4
           and idempotency_key = $5
           and expires_at <= now()`,
        [
          input.productId,
          input.environmentId ?? '',
          input.workspaceId ?? '',
          input.namespace,
          input.key,
        ]
      );

      const inserted = await database.query<Row>(
        `insert into module_idempotency_keys (
          id, product_id, environment_id, workspace_id, namespace, idempotency_key, request_hash,
          status, locked_at, expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'in_progress', now(), $8, $9::jsonb)
        on conflict (
          product_id,
          (coalesce(environment_id, ''::text)),
          (coalesce(workspace_id, ''::text)),
          namespace,
          idempotency_key
        )
        do nothing
        returning *`,
        [
          createId('idem'),
          input.productId,
          input.environmentId ?? null,
          input.workspaceId ?? null,
          input.namespace,
          input.key,
          input.requestHash,
          input.expiresAt ?? defaultExpiresAt(),
          json(input.metadata ?? {}),
        ]
      );
      if (inserted.rows[0]) {
        return { outcome: 'started', record: mapIdempotencyKey(inserted.rows[0]) };
      }

      const existing = await findByScope(input);
      if (!existing) {
        throw new Error('RUNTIME_STORE_IDEMPOTENCY_INSERT_RACE');
      }
      if (existing.requestHash !== input.requestHash) {
        return { outcome: 'conflict', record: existing };
      }
      if (existing.status === 'completed') {
        return { outcome: 'replay', record: existing };
      }
      if (input.recoverLockedBefore) {
        const recovered = await database.query<Row>(
          `update module_idempotency_keys
           set locked_at = now(),
               metadata = metadata || $3::jsonb,
               updated_at = now()
           where id = $1
             and status = 'in_progress'
             and locked_at <= $2::timestamptz
           returning *`,
          [existing.id, input.recoverLockedBefore, json(input.metadata ?? {})]
        );
        if (recovered.rows[0]) {
          return { outcome: 'started', record: mapIdempotencyKey(recovered.rows[0]) };
        }
      }
      return { outcome: 'in_progress', record: existing };
    },
    async completeIdempotencyKey(input) {
      const result = await database.query<Row>(
        `update module_idempotency_keys
         set status = 'completed',
             response_status = $2,
             response_headers = $3::jsonb,
             response_body_base64 = $4,
             metadata = metadata || $5::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          input.id,
          input.responseStatus,
          json(input.responseHeaders ?? {}),
          input.responseBodyBase64 ?? null,
          json(input.metadata ?? {}),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_IDEMPOTENCY_NOT_FOUND: ${input.id}`);
      }
      return mapIdempotencyKey(result.rows[0]);
    },
    async getIdempotencyKey(id) {
      const result = await database.query<Row>(
        'select * from module_idempotency_keys where id = $1',
        [id]
      );
      return result.rows[0] ? mapIdempotencyKey(result.rows[0]) : null;
    },
    async listIdempotencyKeys(query = {}) {
      const result = await database.query<Row>(
        `select * from module_idempotency_keys
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(environment_id, ''::text) = $2)
           and ($3::text is null or coalesce(workspace_id, ''::text) = $3)
           and ($4::text is null or namespace = $4)
           and ($5::text is null or status = $5)
           and ($6::timestamptz is null or expires_at <= $6)
         order by created_at asc`,
        [
          query.productId ?? null,
          query.environmentId === undefined ? null : (query.environmentId ?? ''),
          runtimeWorkspaceFilter(query.workspaceId),
          query.namespace ?? null,
          query.status ?? null,
          query.expiresBefore ?? null,
        ]
      );
      return result.rows.map(mapIdempotencyKey);
    },
    async deleteExpiredIdempotencyKeys(query = {}) {
      const result = await database.query<{ id: string }>(
        `with deleted as (
          delete from module_idempotency_keys
          where id in (
            select id
            from module_idempotency_keys
            where ($1::text is null or product_id = $1)
              and ($2::text is null or coalesce(environment_id, ''::text) = $2)
              and ($3::text is null or coalesce(workspace_id, ''::text) = $3)
              and expires_at <= $4::timestamptz
            order by expires_at asc
            limit $5
          )
          returning id
        )
        select id from deleted`,
        [
          query.productId ?? null,
          query.environmentId === undefined ? null : (query.environmentId ?? ''),
          runtimeWorkspaceFilter(query.workspaceId),
          query.before ?? new Date().toISOString(),
          query.limit ?? 1000,
        ]
      );
      return result.rows.length;
    },
  };
}

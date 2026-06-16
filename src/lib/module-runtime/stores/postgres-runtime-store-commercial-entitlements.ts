import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapEntitlement, type Row } from './postgres-runtime-store-mappers';
import { json, runtimeWorkspaceFilter } from './postgres-runtime-store-utils';

export type PostgresCommercialEntitlementStore = Pick<
  RuntimeStore,
  'grantEntitlement' | 'listEntitlements' | 'revokeEntitlement' | 'overrideEntitlement'
>;

export interface CreatePostgresCommercialEntitlementStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialEntitlementStore(
  options: CreatePostgresCommercialEntitlementStoreOptions
): PostgresCommercialEntitlementStore {
  const { database, createId } = options;

  return {
    async grantEntitlement(input) {
      const result = await database.query<Row>(
        `insert into module_commercial_entitlements (
          id, product_id, workspace_id, user_id, entitlement, plan_id, source, status,
          idempotency_key, expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::jsonb)
        on conflict (product_id, user_id, entitlement, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_commercial_entitlements.metadata
        returning *`,
        [
          createId('entitlement'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.entitlement,
          input.planId ?? null,
          input.source,
          input.status ?? 'active',
          input.idempotencyKey ?? null,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapEntitlement(result.rows[0]!);
    },
    async listEntitlements(query = {}) {
      const result = await database.query<Row>(
        `select * from module_commercial_entitlements
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or entitlement = $4)
           and ($5::text is null or status = $5)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.entitlement ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapEntitlement);
    },
    async revokeEntitlement(id: string, metadata?: Record<string, unknown>) {
      const result = await database.query<Row>(
        `update module_commercial_entitlements
         set status = 'revoked',
             metadata = metadata || $2::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      return mapEntitlement(result.rows[0]);
    },
    async overrideEntitlement(id, input) {
      const result = await database.query<Row>(
        `update module_commercial_entitlements
         set status = $2,
             expires_at = case when $3::boolean then $4::timestamptz else expires_at end,
             metadata = metadata || $5::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [
          id,
          input.status,
          Object.prototype.hasOwnProperty.call(input, 'expiresAt'),
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      return mapEntitlement(result.rows[0]);
    },
  };
}

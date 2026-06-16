import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore, RuntimeStoreCommercialOrderStatus } from './runtime-store-types';
import {
  mapCommercialCatalogItem,
  mapCommercialOrder,
  type Row,
} from './postgres-runtime-store-mappers';
import {
  json,
  orderWorkspaceFilter,
  orderWorkspaceKey,
  runtimeWorkspaceFilter,
} from './postgres-runtime-store-utils';

export type PostgresCommercialOrderStore = Pick<
  RuntimeStore,
  | 'upsertCommercialCatalogItem'
  | 'listCommercialCatalogItems'
  | 'createCommercialOrder'
  | 'getCommercialOrder'
  | 'findCommercialOrderByProviderRef'
  | 'attachCommercialOrderProvider'
  | 'updateCommercialOrderStatus'
  | 'listCommercialOrders'
>;

export interface CreatePostgresCommercialOrderStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialOrderStore(
  options: CreatePostgresCommercialOrderStoreOptions
): PostgresCommercialOrderStore {
  const { database, createId } = options;

  return {
    async upsertCommercialCatalogItem(input) {
      const result = await database.query<Row>(
        `insert into module_commercial_catalog (
          id, product_id, workspace_id, kind, item_id, version, status, value_json, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), kind, item_id, version)
        do update set
          status = excluded.status,
          value_json = excluded.value_json,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('commercial_catalog'),
          input.productId,
          input.workspaceId ?? null,
          input.kind,
          input.itemId,
          input.version ?? 1,
          input.status ?? 'draft',
          json(input.value),
          json(input.metadata ?? {}),
        ]
      );
      return mapCommercialCatalogItem(result.rows[0]!) as never;
    },
    async listCommercialCatalogItems(query = {}) {
      const result = await database.query<Row>(
        `select * from module_commercial_catalog
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or kind = $3)
           and ($4::text is null or status = $4)
           and ($5::text is null or item_id = $5)
         order by item_id asc, version desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.kind ?? null,
          query.status ?? null,
          query.itemId ?? null,
        ]
      );
      return result.rows.map((row) => mapCommercialCatalogItem(row)) as never;
    },
    async createCommercialOrder(input) {
      if (input.provider && input.providerRef) {
        const existingByProvider = await database.query<Row>(
          `select *
           from module_commercial_orders
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and provider = $3
             and provider_ref = $4
           limit 1`,
          [input.productId, orderWorkspaceKey(input.workspaceId), input.provider, input.providerRef]
        );
        if (existingByProvider.rows[0]) {
          return mapCommercialOrder(existingByProvider.rows[0]);
        }
      }
      const result = await database.query<Row>(
        `insert into module_commercial_orders (
          id, product_id, workspace_id, user_id, sku, amount, currency, status,
          provider, provider_ref, idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9, $10, $11::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_commercial_orders.metadata
        returning *`,
        [
          createId('order'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.sku,
          input.amount,
          input.currency,
          input.provider ?? null,
          input.providerRef ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapCommercialOrder(result.rows[0]!);
    },
    async getCommercialOrder(id) {
      const result = await database.query<Row>(
        'select * from module_commercial_orders where id = $1',
        [id]
      );
      return result.rows[0] ? mapCommercialOrder(result.rows[0]) : null;
    },
    async findCommercialOrderByProviderRef(productId, workspaceId, provider, providerRef) {
      const result = await database.query<Row>(
        `select * from module_commercial_orders
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and provider = $3
           and provider_ref = $4`,
        [productId, orderWorkspaceKey(workspaceId), provider, providerRef]
      );
      return result.rows[0] ? mapCommercialOrder(result.rows[0]) : null;
    },
    async attachCommercialOrderProvider(
      id: string,
      provider: string,
      providerRef: string,
      metadata?: Record<string, unknown>
    ) {
      const result = await database.query<Row>(
        `update module_commercial_orders
         set provider = $2,
             provider_ref = $3,
             metadata = metadata || $4::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, provider, providerRef, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_NOT_FOUND: ${id}`);
      }
      return mapCommercialOrder(result.rows[0]);
    },
    async updateCommercialOrderStatus(
      id: string,
      status: RuntimeStoreCommercialOrderStatus,
      metadata?: Record<string, unknown>
    ) {
      const result = await database.query<Row>(
        `update module_commercial_orders
         set status = $2,
             metadata = metadata || $3::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, status, json(metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_NOT_FOUND: ${id}`);
      }
      return mapCommercialOrder(result.rows[0]);
    },
    async listCommercialOrders(query = {}) {
      const result = await database.query<Row>(
        `select * from module_commercial_orders
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or status = $4)
         order by created_at desc`,
        [
          query.productId ?? null,
          orderWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapCommercialOrder);
    },
  };
}

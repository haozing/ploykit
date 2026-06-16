import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapRevenueBucket, mapSettlementBatch, type Row } from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresCommercialRevenueStore = Pick<
  RuntimeStore,
  'upsertRevenueBucket' | 'listRevenueBuckets' | 'upsertSettlementBatch' | 'listSettlementBatches'
>;

export interface CreatePostgresCommercialRevenueStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialRevenueStore(
  options: CreatePostgresCommercialRevenueStoreOptions
): PostgresCommercialRevenueStore {
  const { database, createId } = options;

  return {
    async upsertRevenueBucket(input) {
      const result = await database.query<Row>(
        `insert into module_revenue_buckets (
          id, product_id, workspace_id, bucket_date, currency, gross, discount,
          tax, refund, fee, net, orders, provider, metadata
        )
        values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), bucket_date, currency)
        do update set
          gross = excluded.gross,
          discount = excluded.discount,
          tax = excluded.tax,
          refund = excluded.refund,
          fee = excluded.fee,
          net = excluded.net,
          orders = excluded.orders,
          provider = excluded.provider,
          metadata = module_revenue_buckets.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          createId('revenue_bucket'),
          input.productId,
          input.workspaceId ?? null,
          input.bucketDate,
          input.currency,
          input.gross ?? 0,
          input.discount ?? 0,
          input.tax ?? 0,
          input.refund ?? 0,
          input.fee ?? 0,
          input.net ?? 0,
          input.orders ?? 0,
          input.provider ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapRevenueBucket(result.rows[0]!);
    },
    async listRevenueBuckets(query = {}) {
      const result = await database.query<Row>(
        `select * from module_revenue_buckets
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::date is null or bucket_date >= $3::date)
           and ($4::date is null or bucket_date <= $4::date)
           and ($5::text is null or currency = $5)
         order by bucket_date asc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.from ?? null,
          query.to ?? null,
          query.currency ?? null,
        ]
      );
      return result.rows.map(mapRevenueBucket);
    },
    async upsertSettlementBatch(input) {
      const id =
        input.id ??
        `${input.productId}:${input.workspaceId ?? ''}:${input.provider}:${input.currency}:${input.periodStart}:${input.periodEnd}`;
      const gross = input.gross ?? 0;
      const refund = input.refund ?? 0;
      const fee = input.fee ?? 0;
      const result = await database.query<Row>(
        `insert into module_settlement_batches (
          id, product_id, workspace_id, provider, currency, period_start, period_end,
          status, gross, refund, fee, net, order_count, invoice_count, credit_note_count, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz,
          $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb
        )
        on conflict (id)
        do update set
          status = excluded.status,
          gross = excluded.gross,
          refund = excluded.refund,
          fee = excluded.fee,
          net = excluded.net,
          order_count = excluded.order_count,
          invoice_count = excluded.invoice_count,
          credit_note_count = excluded.credit_note_count,
          metadata = module_settlement_batches.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.provider,
          input.currency,
          input.periodStart,
          input.periodEnd,
          input.status ?? 'draft',
          gross,
          refund,
          fee,
          input.net ?? gross - refund - fee,
          input.orderCount ?? 0,
          input.invoiceCount ?? 0,
          input.creditNoteCount ?? 0,
          json(input.metadata ?? {}),
        ]
      );
      return mapSettlementBatch(result.rows[0]!);
    },
    async listSettlementBatches(query = {}) {
      const result = await database.query<Row>(
        `select * from module_settlement_batches
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or provider = $3)
           and ($4::text is null or currency = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          query.workspaceId === undefined ? null : (query.workspaceId ?? ''),
          query.provider ?? null,
          query.currency ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapSettlementBatch);
    },
  };
}

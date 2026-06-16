import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapRedeemCode, mapRedeemRedemption, type Row } from './postgres-runtime-store-mappers';
import { json } from './postgres-runtime-store-utils';

export type PostgresCommercialRedeemStore = Pick<
  RuntimeStore,
  | 'upsertRedeemCode'
  | 'getRedeemCode'
  | 'updateRedeemCodeStatus'
  | 'listRedeemCodes'
  | 'recordRedeemRedemption'
  | 'listRedeemRedemptions'
>;

export interface CreatePostgresCommercialRedeemStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialRedeemStore(
  options: CreatePostgresCommercialRedeemStoreOptions
): PostgresCommercialRedeemStore {
  const { database, createId } = options;

  return {
    async upsertRedeemCode(input) {
      const result = await database.query<Row>(
        `insert into module_redeem_codes (
          product_id, code, entitlement, credits_amount, credits_unit, max_redemptions,
          expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
        on conflict (product_id, code)
        do update set
          entitlement = excluded.entitlement,
          credits_amount = excluded.credits_amount,
          credits_unit = excluded.credits_unit,
          max_redemptions = excluded.max_redemptions,
          expires_at = excluded.expires_at,
          metadata = excluded.metadata,
          updated_at = now()
        returning *`,
        [
          input.productId,
          input.code,
          input.entitlement ?? null,
          input.creditsAmount ?? null,
          input.creditsUnit,
          input.maxRedemptions,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapRedeemCode(result.rows[0]!);
    },
    async getRedeemCode(productId, code) {
      const result = await database.query<Row>(
        'select * from module_redeem_codes where product_id = $1 and code = $2',
        [productId, code]
      );
      return result.rows[0] ? mapRedeemCode(result.rows[0]) : null;
    },
    async updateRedeemCodeStatus(input) {
      const result = await database.query<Row>(
        `update module_redeem_codes
         set metadata = metadata || $3::jsonb || jsonb_build_object('status', $4::text),
             updated_at = now()
         where product_id = $1 and code = $2
         returning *`,
        [input.productId, input.code, json(input.metadata ?? {}), input.status]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_REDEEM_CODE_NOT_FOUND: ${input.code}`);
      }
      return mapRedeemCode(result.rows[0]);
    },
    async listRedeemCodes(query = {}) {
      const result = await database.query<Row>(
        `select * from module_redeem_codes
         where ($1::text is null or product_id = $1)
           and ($2::text is null or metadata->>'batchId' = $2)
           and ($3::text is null or coalesce(metadata->>'status', 'active') = $3)
         order by created_at desc`,
        [query.productId ?? null, query.batchId ?? null, query.status ?? null]
      );
      return result.rows.map(mapRedeemCode);
    },
    async recordRedeemRedemption(input) {
      const result = await database.query<Row>(
        `insert into module_redeem_redemptions (
          id, product_id, code, user_id, entitlement, credits_amount, credits_unit,
          idempotency_key, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        on conflict (product_id, code, user_id)
        do update set metadata = module_redeem_redemptions.metadata
        returning *`,
        [
          createId('redemption'),
          input.productId,
          input.code,
          input.userId,
          input.entitlement ?? null,
          input.creditsAmount ?? null,
          input.creditsUnit ?? null,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapRedeemRedemption(result.rows[0]!);
    },
    async listRedeemRedemptions(query = {}) {
      const result = await database.query<Row>(
        `select * from module_redeem_redemptions
         where ($1::text is null or product_id = $1)
           and ($2::text is null or code = $2)
           and ($3::text is null or user_id = $3)
         order by created_at desc`,
        [query.productId ?? null, query.code ?? null, query.userId ?? null]
      );
      return result.rows.map(mapRedeemRedemption);
    },
  };
}

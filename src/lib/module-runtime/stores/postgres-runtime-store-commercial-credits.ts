import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import { mapCreditLedger, mapCreditReservation, type Row } from './postgres-runtime-store-mappers';
import { creditWorkspaceFilter, creditWorkspaceKey, json } from './postgres-runtime-store-utils';

export type PostgresCommercialCreditStore = Pick<
  RuntimeStore,
  | 'recordCreditLedger'
  | 'consumeCreditLedger'
  | 'listCreditLedger'
  | 'getCreditBalance'
  | 'createCreditReservation'
  | 'getCreditReservation'
  | 'updateCreditReservation'
  | 'listCreditReservations'
>;

export interface CreatePostgresCommercialCreditStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialCreditStore(
  options: CreatePostgresCommercialCreditStoreOptions
): PostgresCommercialCreditStore {
  const { database, createId } = options;

  return {
    async recordCreditLedger(input) {
      const result = await database.query<Row>(
        `insert into module_credit_ledger (
          id, product_id, workspace_id, user_id, amount, unit, reason, status,
          idempotency_key, expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, unit, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_credit_ledger.metadata
        returning *`,
        [
          createId('credit'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.amount,
          input.unit ?? 'credit',
          input.reason,
          input.status ??
            (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()
              ? 'expired'
              : 'available'),
          input.idempotencyKey ?? null,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapCreditLedger(result.rows[0]!);
    },
    async consumeCreditLedger(input) {
      if (!database.transaction) {
        throw new Error(
          'RUNTIME_STORE_TRANSACTION_REQUIRED: credit consume requires database.transaction'
        );
      }
      const unit = input.unit ?? 'credit';
      const workspaceKey = creditWorkspaceKey(input.workspaceId);
      return database.transaction(async (tx) => {
        await tx.query(
          `select pg_advisory_xact_lock(
            hashtext($1::text),
            hashtext($2::text || ':' || $3::text || ':' || $4::text)
          )`,
          [input.productId, workspaceKey, input.userId, unit]
        );

        if (input.idempotencyKey) {
          const existing = await tx.query<Row>(
            `select *
             from module_credit_ledger
             where product_id = $1
               and coalesce(workspace_id, ''::text) = $2
               and user_id = $3
               and unit = $4
               and idempotency_key = $5
             limit 1`,
            [input.productId, workspaceKey, input.userId, unit, input.idempotencyKey]
          );
          if (existing.rows[0]) {
            return mapCreditLedger(existing.rows[0]);
          }
        }

        const balance = await tx.query<Row>(
          `select coalesce(sum(amount), 0) as balance
           from module_credit_ledger
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and user_id = $3
             and unit = $4
             and status = 'available'
             and (expires_at is null or expires_at > now())`,
          [input.productId, workspaceKey, input.userId, unit]
        );
        if (Number(balance.rows[0]?.balance ?? 0) < input.amount) {
          throw new Error('MODULE_CREDITS_INSUFFICIENT');
        }

        const result = await tx.query<Row>(
          `insert into module_credit_ledger (
            id, product_id, workspace_id, user_id, amount, unit, reason, status,
            idempotency_key, expires_at, metadata
          )
          values ($1, $2, $3, $4, $5, $6, $7, 'available', $8, null, $9::jsonb)
          on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, unit, idempotency_key)
          where idempotency_key is not null
          do update set metadata = module_credit_ledger.metadata
          returning *`,
          [
            createId('credit'),
            input.productId,
            input.workspaceId ?? null,
            input.userId,
            -input.amount,
            unit,
            input.reason,
            input.idempotencyKey ?? null,
            json(input.metadata ?? {}),
          ]
        );
        return mapCreditLedger(result.rows[0]!);
      });
    },
    async listCreditLedger(query = {}) {
      const result = await database.query<Row>(
        `select * from module_credit_ledger
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or unit = $4)
           and (
             $5::text is null
             or case
               when status = 'available' and expires_at is not null and expires_at <= now()
               then 'expired'
               else status
             end = $5
           )
         order by created_at desc`,
        [
          query.productId ?? null,
          creditWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.unit ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapCreditLedger);
    },
    async getCreditBalance(query) {
      const unit = query.unit ?? 'credit';
      const result = await database.query<Row>(
        `select coalesce(sum(amount), 0) as balance
         from module_credit_ledger
         where product_id = $1
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and user_id = $3
           and unit = $4
           and status = 'available'
           and (expires_at is null or expires_at > now())`,
        [query.productId, creditWorkspaceFilter(query.workspaceId), query.userId, unit]
      );
      return { userId: query.userId, unit, balance: Number(result.rows[0]?.balance ?? 0) };
    },
    async createCreditReservation(input) {
      const unit = input.unit ?? 'credit';
      const result = await database.query<Row>(
        `insert into module_credit_reservations (
          id, product_id, workspace_id, user_id, amount_reserved, amount_committed,
          unit, status, reason, source, source_id, idempotency_key, expires_at, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::timestamptz, $14::jsonb)
        on conflict (product_id, (coalesce(workspace_id, ''::text)), user_id, unit, idempotency_key)
        where idempotency_key is not null
        do update set metadata = module_credit_reservations.metadata
        returning *`,
        [
          input.id ?? createId('credit_reservation'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.amountReserved,
          input.amountCommitted ?? 0,
          unit,
          input.status ?? 'reserved',
          input.reason ?? null,
          input.source ?? null,
          input.sourceId ?? null,
          input.idempotencyKey ?? null,
          input.expiresAt ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapCreditReservation(result.rows[0]!);
    },
    async getCreditReservation(id) {
      const result = await database.query<Row>(
        'select * from module_credit_reservations where id = $1',
        [id]
      );
      return result.rows[0] ? mapCreditReservation(result.rows[0]) : null;
    },
    async updateCreditReservation(id, patch) {
      const result = await database.query<Row>(
        `update module_credit_reservations
         set amount_committed = coalesce($2, amount_committed),
             status = coalesce($3, status),
             metadata = metadata || $4::jsonb,
             updated_at = now()
         where id = $1
         returning *`,
        [id, patch.amountCommitted ?? null, patch.status ?? null, json(patch.metadata ?? {})]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_CREDIT_RESERVATION_NOT_FOUND: ${id}`);
      }
      return mapCreditReservation(result.rows[0]);
    },
    async listCreditReservations(query = {}) {
      const result = await database.query<Row>(
        `select * from module_credit_reservations
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or unit = $4)
           and ($5::text is null or status = $5)
           and ($6::text is null or source = $6)
           and ($7::text is null or source_id = $7)
           and ($8::timestamptz is null or expires_at <= $8::timestamptz)
         order by created_at desc`,
        [
          query.productId ?? null,
          creditWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.unit ?? null,
          query.status ?? null,
          query.source ?? null,
          query.sourceId ?? null,
          query.expiresBefore ?? null,
        ]
      );
      return result.rows.map(mapCreditReservation);
    },
  };
}

import type { ModuleDataPostgresExecutor } from '../data';
import { redactSensitive } from '../observability/redaction';
import type { RuntimeStore } from './runtime-store-types';
import { mapSubscription, mapSubscriptionEvent, type Row } from './postgres-runtime-store-mappers';
import { json, orderWorkspaceFilter, orderWorkspaceKey } from './postgres-runtime-store-utils';

export type PostgresCommercialSubscriptionStore = Pick<
  RuntimeStore,
  'upsertSubscription' | 'listSubscriptions' | 'createSubscriptionEvent' | 'listSubscriptionEvents'
>;

export interface CreatePostgresCommercialSubscriptionStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresCommercialSubscriptionStore(
  options: CreatePostgresCommercialSubscriptionStoreOptions
): PostgresCommercialSubscriptionStore {
  const { database, createId } = options;

  return {
    async upsertSubscription(input) {
      const id =
        input.id ?? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.planId}`;
      const result = await database.query<Row>(
        `insert into module_subscriptions (
          id, product_id, workspace_id, user_id, plan_id, status, provider, provider_ref,
          current_period_start, current_period_end, trial_end, cancel_at_period_end,
          renewal_strategy, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9::timestamptz, $10::timestamptz, $11::timestamptz, $12,
          $13, $14::jsonb
        )
        on conflict (id)
        do update set
          status = excluded.status,
          provider = excluded.provider,
          provider_ref = excluded.provider_ref,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          trial_end = excluded.trial_end,
          cancel_at_period_end = excluded.cancel_at_period_end,
          renewal_strategy = excluded.renewal_strategy,
          metadata = module_subscriptions.metadata || excluded.metadata,
          updated_at = now()
        returning *`,
        [
          id,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.planId,
          input.status ?? 'active',
          input.provider ?? null,
          input.providerRef ?? null,
          input.currentPeriodStart ?? new Date().toISOString(),
          input.currentPeriodEnd ?? null,
          input.trialEnd ?? null,
          input.cancelAtPeriodEnd ?? false,
          input.renewalStrategy ?? 'manual',
          json(input.metadata ?? {}),
        ]
      );
      return mapSubscription(result.rows[0]!);
    },
    async listSubscriptions(query = {}) {
      const result = await database.query<Row>(
        `select * from module_subscriptions
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or plan_id = $4)
           and ($5::text is null or status = $5)
         order by updated_at desc`,
        [
          query.productId ?? null,
          orderWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.planId ?? null,
          query.status ?? null,
        ]
      );
      return result.rows.map(mapSubscription);
    },
    async createSubscriptionEvent(input) {
      if (input.idempotencyKey) {
        const existing = await database.query<Row>(
          `select * from module_subscription_events
           where product_id = $1
             and coalesce(workspace_id, ''::text) = $2
             and idempotency_key = $3
           limit 1`,
          [input.productId, orderWorkspaceKey(input.workspaceId), input.idempotencyKey]
        );
        if (existing.rows[0]) {
          return mapSubscriptionEvent(existing.rows[0]);
        }
      }
      const result = await database.query<Row>(
        `insert into module_subscription_events (
          id, product_id, workspace_id, user_id, subscription_id, plan_id,
          type, status, provider, provider_ref, idempotency_key, effective_at, metadata
        )
        values (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12::timestamptz, $13::jsonb
        )
        returning *`,
        [
          createId('subscription_event'),
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.subscriptionId,
          input.planId,
          input.type,
          input.status,
          input.provider ?? null,
          input.providerRef ?? null,
          input.idempotencyKey ?? null,
          input.effectiveAt ?? new Date().toISOString(),
          json(redactSensitive(input.metadata ?? {})),
        ]
      );
      return mapSubscriptionEvent(result.rows[0]!);
    },
    async listSubscriptionEvents(query = {}) {
      const result = await database.query<Row>(
        `select * from module_subscription_events
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, '') = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or subscription_id = $4)
           and ($5::text is null or plan_id = $5)
           and ($6::text is null or type = $6)
         order by created_at desc`,
        [
          query.productId ?? null,
          orderWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.subscriptionId ?? null,
          query.planId ?? null,
          query.type ?? null,
        ]
      );
      return result.rows.map(mapSubscriptionEvent);
    },
  };
}

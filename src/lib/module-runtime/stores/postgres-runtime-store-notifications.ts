import type { ModuleDataPostgresExecutor } from '../data';
import type { RuntimeStore } from './runtime-store-types';
import {
  mapNotification,
  mapNotificationDelivery,
  type Row,
} from './postgres-runtime-store-mappers';
import { errorFrom, json, runtimeWorkspaceFilter } from './postgres-runtime-store-utils';

export type PostgresNotificationStore = Pick<
  RuntimeStore,
  | 'createNotification'
  | 'listNotifications'
  | 'markNotificationRead'
  | 'markNotificationsRead'
  | 'recordNotificationDelivery'
  | 'listNotificationDeliveries'
>;

export interface CreatePostgresNotificationStoreOptions {
  database: ModuleDataPostgresExecutor;
  createId: (prefix: string) => string;
}

export function createPostgresNotificationStore(
  options: CreatePostgresNotificationStoreOptions
): PostgresNotificationStore {
  const { database, createId } = options;

  return {
    async createNotification(input) {
      const deliveryStatus = input.deliveryStatus ?? 'delivered';
      const status = input.status ?? (deliveryStatus === 'delivered' ? 'unread' : 'read');
      const result = await database.query<Row>(
        `insert into module_notifications (
          id, product_id, workspace_id, module_id, user_id, channel, title, body,
          action_url, run_id, source, category, status, delivery_status,
          idempotency_key, metadata, read_at, delivered_at, skipped_at, error
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16::jsonb,
          case when $13 = 'read' then now() else null end,
          case when $14 = 'delivered' then now() else null end,
          case when $14 = 'skipped' then now() else null end,
          $17::jsonb
        )
        on conflict (product_id, user_id, source, idempotency_key)
        where idempotency_key is not null
        do update set updated_at = module_notifications.updated_at
        returning *`,
        [
          createId('notification'),
          input.productId,
          input.workspaceId ?? null,
          input.moduleId ?? '__host__',
          input.userId,
          input.channel ?? 'inApp',
          input.title,
          input.body ?? null,
          input.actionUrl ?? null,
          input.runId ?? null,
          input.source ?? 'host',
          input.category ?? 'system',
          status,
          deliveryStatus,
          input.idempotencyKey ?? null,
          json(input.metadata ?? {}),
          json(errorFrom(input.error)),
        ]
      );
      return mapNotification(result.rows[0]!);
    },
    async listNotifications(query = {}) {
      const result = await database.query<Row>(
        `select * from module_notifications
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or module_id = $3)
           and ($4::text is null or user_id = $4)
           and ($5::text is null or status = $5)
           and ($6::text is null or channel = $6)
           and ($7::text is null or category = $7)
           and ($8::text is null or delivery_status = $8)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.moduleId ?? null,
          query.userId ?? null,
          query.status ?? null,
          query.channel ?? null,
          query.category ?? null,
          query.deliveryStatus ?? null,
        ]
      );
      return result.rows.map(mapNotification);
    },
    async markNotificationRead(id) {
      const result = await database.query<Row>(
        `update module_notifications
         set status = 'read',
             read_at = coalesce(read_at, now()),
             updated_at = now()
         where id = $1
         returning *`,
        [id]
      );
      if (!result.rows[0]) {
        throw new Error(`RUNTIME_STORE_NOTIFICATION_NOT_FOUND: ${id}`);
      }
      return mapNotification(result.rows[0]);
    },
    async markNotificationsRead(query) {
      const result = await database.query<Row>(
        `update module_notifications
         set status = 'read',
             read_at = coalesce(read_at, now()),
             updated_at = now()
         where product_id = $1
           and coalesce(workspace_id, ''::text) = $2
           and user_id = $3
           and ($4::text is null or channel = $4)
           and ($5::text is null or category = $5)
           and delivery_status = 'delivered'
         returning *`,
        [
          query.productId,
          runtimeWorkspaceFilter(query.workspaceId),
          query.userId,
          query.channel ?? null,
          query.category ?? null,
        ]
      );
      return result.rows.map(mapNotification);
    },
    async recordNotificationDelivery(input) {
      const result = await database.query<Row>(
        `insert into module_notification_deliveries (
          id, notification_id, product_id, workspace_id, user_id, channel,
          provider, status, reason, metadata
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        returning *`,
        [
          createId('notification_delivery'),
          input.notificationId ?? null,
          input.productId,
          input.workspaceId ?? null,
          input.userId,
          input.channel,
          input.provider,
          input.status,
          input.reason ?? null,
          json(input.metadata ?? {}),
        ]
      );
      return mapNotificationDelivery(result.rows[0]!);
    },
    async listNotificationDeliveries(query = {}) {
      const result = await database.query<Row>(
        `select * from module_notification_deliveries
         where ($1::text is null or product_id = $1)
           and ($2::text is null or coalesce(workspace_id, ''::text) = $2)
           and ($3::text is null or user_id = $3)
           and ($4::text is null or status = $4)
           and ($5::text is null or provider = $5)
         order by created_at desc`,
        [
          query.productId ?? null,
          runtimeWorkspaceFilter(query.workspaceId),
          query.userId ?? null,
          query.status ?? null,
          query.provider ?? null,
        ]
      );
      return result.rows.map(mapNotificationDelivery);
    },
  };
}

import type {
  CreateRuntimeStoreNotificationInput,
  RuntimeStore,
  RuntimeStoreNotificationDeliveryRecord,
  RuntimeStoreNotificationRecord,
} from './runtime-store-types';

type InMemoryNotificationsRuntimeStore = Pick<
  RuntimeStore,
  | 'createNotification'
  | 'listNotifications'
  | 'markNotificationRead'
  | 'markNotificationsRead'
  | 'recordNotificationDelivery'
  | 'listNotificationDeliveries'
>;

interface CreateInMemoryNotificationsRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeError(error: Error | string): { code: string; message: string } {
  return typeof error === 'string'
    ? { code: 'RUNTIME_STORE_ERROR', message: error }
    : { code: error.name || 'RUNTIME_STORE_ERROR', message: error.message };
}

function notificationKey(input: CreateRuntimeStoreNotificationInput): string | null {
  return input.idempotencyKey
    ? `${input.productId}:${input.userId}:${input.source ?? 'host'}:${input.idempotencyKey}`
    : null;
}

export function createInMemoryNotificationsRuntimeStore({
  now,
  createId,
}: CreateInMemoryNotificationsRuntimeStoreInput): InMemoryNotificationsRuntimeStore {
  const notifications = new Map<string, RuntimeStoreNotificationRecord>();
  const notificationIdempotency = new Map<string, string>();
  const notificationDeliveries = new Map<string, RuntimeStoreNotificationDeliveryRecord>();

  return {
    async createNotification(input) {
      const key = notificationKey(input);
      if (key) {
        const existingId = notificationIdempotency.get(key);
        if (existingId) {
          return clone(notifications.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const deliveryStatus = input.deliveryStatus ?? 'delivered';
      const record: RuntimeStoreNotificationRecord = {
        id: createId('notification'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId ?? '__host__',
        userId: input.userId,
        channel: input.channel ?? 'inApp',
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        runId: input.runId,
        source: input.source ?? 'host',
        category: input.category ?? 'system',
        status: input.status ?? (deliveryStatus === 'delivered' ? 'unread' : 'read'),
        deliveryStatus,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        readAt: input.status === 'read' || deliveryStatus !== 'delivered' ? timestamp : undefined,
        deliveredAt: deliveryStatus === 'delivered' ? timestamp : undefined,
        skippedAt: deliveryStatus === 'skipped' ? timestamp : undefined,
        error: input.error ? normalizeError(input.error) : undefined,
      };
      notifications.set(record.id, record);
      if (key) {
        notificationIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listNotifications(query = {}) {
      return [...notifications.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.channel || record.channel === query.channel)
        .filter((record) => !query.category || record.category === query.category)
        .filter((record) => !query.deliveryStatus || record.deliveryStatus === query.deliveryStatus)
        .sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )
        .map((record) => clone(record));
    },
    async markNotificationRead(id) {
      const previous = notifications.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_NOTIFICATION_NOT_FOUND: ${id}`);
      }
      const timestamp = iso(now);
      const next: RuntimeStoreNotificationRecord = {
        ...previous,
        status: 'read',
        readAt: previous.readAt ?? timestamp,
      };
      notifications.set(id, next);
      return clone(next);
    },
    async markNotificationsRead(query) {
      const matched = [...notifications.values()]
        .filter((record) => record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => record.userId === query.userId)
        .filter((record) => !query.channel || record.channel === query.channel)
        .filter((record) => !query.category || record.category === query.category)
        .filter((record) => record.deliveryStatus === 'delivered');
      const updated: RuntimeStoreNotificationRecord[] = [];
      for (const record of matched) {
        const timestamp = iso(now);
        const next: RuntimeStoreNotificationRecord = {
          ...record,
          status: 'read',
          readAt: record.readAt ?? timestamp,
        };
        notifications.set(record.id, next);
        updated.push(clone(next));
      }
      return updated;
    },
    async recordNotificationDelivery(input) {
      const record: RuntimeStoreNotificationDeliveryRecord = {
        id: createId('notification_delivery'),
        notificationId: input.notificationId ?? null,
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        channel: input.channel,
        provider: input.provider,
        status: input.status,
        reason: input.reason,
        metadata: input.metadata ?? {},
        createdAt: iso(now),
      };
      notificationDeliveries.set(record.id, record);
      return clone(record);
    },
    async listNotificationDeliveries(query = {}) {
      return [...notificationDeliveries.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.provider || record.provider === query.provider)
        .sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )
        .map((record) => clone(record));
    },
  };
}

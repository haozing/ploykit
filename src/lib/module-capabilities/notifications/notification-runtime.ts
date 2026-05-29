import { randomUUID } from 'node:crypto';
import type {
  ModuleNotificationListQuery,
  ModuleNotificationRecord,
  ModuleNotificationsApi,
} from '@ploykit/module-sdk';
import type { RuntimeStore } from '../../module-runtime/stores';

export interface ModuleNotificationRuntime extends ModuleNotificationsApi {
  forModule(moduleId: string): ModuleNotificationsApi;
}

export interface CreateInMemoryModuleNotificationRuntimeOptions {
  now?: () => Date;
  createId?: () => string;
}

export interface CreateRuntimeStoreNotificationRuntimeOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function cloneNotification(notification: ModuleNotificationRecord): ModuleNotificationRecord {
  return {
    ...notification,
    metadata: { ...notification.metadata },
  };
}

export function createInMemoryModuleNotificationRuntime(
  options: CreateInMemoryModuleNotificationRuntimeOptions = {}
): ModuleNotificationRuntime {
  const notifications = new Map<string, ModuleNotificationRecord>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `notification_${randomUUID()}`);

  function scoped(moduleId: string): ModuleNotificationsApi {
    return {
      async send(input) {
        const notification: ModuleNotificationRecord = {
          id: createId(),
          moduleId,
          userId: input.userId,
          channel: input.channel ?? 'inApp',
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          runId: input.runId,
          status: 'unread',
          metadata: input.metadata ?? {},
          createdAt: toIso(now),
        };
        notifications.set(notification.id, notification);
        return cloneNotification(notification);
      },
      async list(query: ModuleNotificationListQuery = {}) {
        return [...notifications.values()]
          .filter((notification) => notification.moduleId === moduleId)
          .filter((notification) => !query.userId || notification.userId === query.userId)
          .filter((notification) => !query.status || notification.status === query.status)
          .filter((notification) => !query.channel || notification.channel === query.channel)
          .filter((notification) => !query.runId || notification.runId === query.runId)
          .map((notification) => cloneNotification(notification));
      },
      async markRead(id) {
        const notification = notifications.get(id);
        if (!notification || notification.moduleId !== moduleId) {
          throw new Error(`MODULE_NOTIFICATION_NOT_FOUND: ${id}`);
        }
        const next: ModuleNotificationRecord = {
          ...notification,
          status: 'read',
          readAt: notification.readAt ?? toIso(now),
        };
        notifications.set(id, next);
        return cloneNotification(next);
      },
    };
  }

  const runtime = scoped('__host__') as ModuleNotificationRuntime;
  runtime.forModule = scoped;
  return runtime;
}

export function createRuntimeStoreNotificationRuntime(
  options: CreateRuntimeStoreNotificationRuntimeOptions
): ModuleNotificationRuntime {
  function scoped(moduleId: string): ModuleNotificationsApi {
    return {
      async send(input) {
        const category =
          typeof input.metadata?.category === 'string' ? input.metadata.category : 'system';
        return options.store.createNotification({
          productId: options.productId,
          workspaceId: options.workspaceId,
          moduleId,
          userId: input.userId,
          channel: input.channel,
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          runId: input.runId,
          source: 'module',
          category:
            category === 'tasks' ||
            category === 'billing' ||
            category === 'files' ||
            category === 'workspace' ||
            category === 'admin'
              ? category
              : 'system',
          idempotencyKey:
            typeof input.metadata?.idempotencyKey === 'string'
              ? input.metadata.idempotencyKey
              : undefined,
          metadata: input.metadata,
        });
      },
      list(query: ModuleNotificationListQuery = {}) {
        return options.store.listNotifications({
          productId: options.productId,
          workspaceId: options.workspaceId,
          moduleId,
          userId: query.userId,
          status: query.status,
          channel: query.channel,
        });
      },
      async markRead(id) {
        const existing = (await options.store.listNotifications({
          productId: options.productId,
          workspaceId: options.workspaceId,
          moduleId,
        })).find((notification) => notification.id === id);
        if (!existing) {
          throw new Error(`MODULE_NOTIFICATION_NOT_FOUND: ${id}`);
        }
        return options.store.markNotificationRead(id) as Promise<ModuleNotificationRecord>;
      },
    };
  }

  const runtime = scoped('__host__') as ModuleNotificationRuntime;
  runtime.forModule = scoped;
  return runtime;
}

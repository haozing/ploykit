import type {
  ModuleHostSession,
  RuntimeStoreHostUser,
  RuntimeStoreNotificationCategory,
  RuntimeStoreNotificationRecord,
} from '@/lib/module-runtime';
import {
  getHostUserProfile,
  updateHostUserPreferences,
  type HostUserPreferences,
} from './user-api';
import { defaultProductId } from './default-scope';
import { sendHostEmail } from './email-provider';
import { getHostRuntimeStore } from './runtime-store';

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function userIdFromSession(session: ModuleHostSession): string {
  const userId = session.userId ?? session.user?.id;
  if (!userId) {
    throw new Error('HOST_USER_REQUIRED');
  }
  return userId;
}

async function currentUser(session: ModuleHostSession) {
  const runtimeStore = await getHostRuntimeStore();
  const user = await runtimeStore.store.getHostUser(userIdFromSession(session));
  if (!user) {
    throw new Error('HOST_USER_NOT_FOUND');
  }
  return { runtimeStore, user };
}

function notificationPreferences(user: RuntimeStoreHostUser): HostUserPreferences['notifications'] {
  const preferences = metadataRecord(user.metadata.preferences);
  const notifications = metadataRecord(preferences.notifications);
  return {
    inApp: typeof notifications.inApp === 'boolean' ? notifications.inApp : true,
    email: typeof notifications.email === 'boolean' ? notifications.email : false,
    billing: typeof notifications.billing === 'boolean' ? notifications.billing : true,
    files: typeof notifications.files === 'boolean' ? notifications.files : true,
    admin: typeof notifications.admin === 'boolean' ? notifications.admin : true,
  };
}

function categoryEnabled(
  preferences: HostUserPreferences['notifications'],
  category: RuntimeStoreNotificationCategory
): boolean {
  if (category === 'billing') {
    return preferences.billing;
  }
  if (category === 'files') {
    return preferences.files;
  }
  if (category === 'admin' || category === 'workspace') {
    return preferences.admin;
  }
  return true;
}

async function createHostNotification(
  session: ModuleHostSession,
  input: {
    title: string;
    body?: string;
    actionUrl?: string;
    runId?: string;
    source: string;
    category: RuntimeStoreNotificationCategory;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }
): Promise<RuntimeStoreNotificationRecord> {
  const { runtimeStore, user } = await currentUser(session);
  const preferences = notificationPreferences(user);
  const categoryAllowed = categoryEnabled(preferences, input.category);
  const deliver = preferences.inApp && categoryAllowed;
  const emailDeliver = preferences.email && categoryAllowed;
  const existing = (
    await runtimeStore.store.listNotifications({
      productId: session.productId ?? user.productId,
      workspaceId: session.workspaceId ?? user.workspaceId,
      userId: user.id,
    })
  ).find((item) => item.source === input.source && item.idempotencyKey === input.idempotencyKey);
  if (existing) {
    return existing;
  }
  const notification = await runtimeStore.store.createNotification({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
    moduleId: '__host__',
    userId: user.id,
    channel: 'inApp',
    title: input.title,
    body: input.body,
    actionUrl: input.actionUrl,
    runId: input.runId,
    source: input.source,
    category: input.category,
    deliveryStatus: deliver ? 'delivered' : 'skipped',
    idempotencyKey: input.idempotencyKey,
    metadata: input.metadata,
  });
  await runtimeStore.store.recordNotificationDelivery({
    notificationId: notification.id,
    productId: notification.productId,
    workspaceId: notification.workspaceId,
    userId: notification.userId,
    channel: notification.channel,
    provider: 'in-app',
    status: notification.deliveryStatus,
    reason: deliver ? undefined : 'disabled_by_preferences',
    metadata: { source: notification.source, category: notification.category },
  });
  if (emailDeliver) {
    const emailResult = await sendHostEmail({
      to: user.email,
      subject: input.title,
      text: [input.body, input.actionUrl].filter(Boolean).join('\n\n'),
      metadata: {
        notificationId: notification.id,
        source: notification.source,
        category: notification.category,
        runId: notification.runId,
      },
    });
    await runtimeStore.store.recordNotificationDelivery({
      notificationId: notification.id,
      productId: notification.productId,
      workspaceId: notification.workspaceId,
      userId: notification.userId,
      channel: 'email',
      provider: emailResult.provider,
      status: emailResult.status,
      reason: emailResult.reason,
      metadata: {
        source: notification.source,
        category: notification.category,
        providerRef: emailResult.providerRef,
        ...(emailResult.metadata ?? {}),
      },
    });
  }
  return notification;
}

async function syncRunNotifications(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  const runs = await runtimeStore.store.listRuns({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
  });
  for (const run of runs.filter((item) => ['succeeded', 'failed', 'canceled'].includes(item.status))) {
    const taskName = run.name === 'public tools export' ? 'Public tools export' : run.name;
    await createHostNotification(session, {
      title: run.status === 'failed' ? `${taskName} failed` : `${taskName} completed`,
      body:
        run.status === 'failed'
          ? 'The task did not complete. Open the task center for details.'
          : 'The task is ready. Open the task center to view the result.',
      actionUrl: `/dashboard/tasks/${run.id}`,
      runId: run.id,
      source: 'task',
      category: 'tasks',
      idempotencyKey: `run:${run.id}:${run.status}`,
      metadata: { moduleId: run.moduleId, status: run.status },
    });
  }
}

async function syncBillingNotifications(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  const orders = await runtimeStore.store.listCommercialOrders({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
    userId: user.id,
  });
  for (const order of orders.filter((item) => item.status === 'paid' || item.status === 'failed')) {
    await createHostNotification(session, {
      title: order.status === 'paid' ? 'Payment completed' : 'Payment failed',
      body: order.amount === 0 ? 'Free demo order.' : `${order.currency} ${order.amount}`,
      actionUrl: '/dashboard/orders',
      source: 'billing',
      category: 'billing',
      idempotencyKey: `order:${order.id}:${order.status}`,
      metadata: { orderId: order.id, sku: order.sku, status: order.status },
    });
  }
}

async function syncFileNotifications(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  const files = await runtimeStore.store.listFiles({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
    ownerId: user.id,
    includeDeleted: true,
  });
  for (const file of files.filter((item) => item.status === 'ready' || item.status === 'quarantined')) {
    await createHostNotification(session, {
      title: `File ${file.status}: ${file.name}`,
      body: file.status === 'ready' ? 'The file is ready.' : 'The file needs review.',
      actionUrl: `/dashboard/files?file=${encodeURIComponent(file.id)}`,
      source: 'file',
      category: 'files',
      idempotencyKey: `file:${file.id}:${file.status}`,
      metadata: { fileId: file.id, status: file.status },
    });
  }
}

async function syncWorkspaceNotifications(session: ModuleHostSession) {
  const { user } = await currentUser(session);
  const notifications = metadataRecord(user.metadata.productScopeNotifications);
  const events = Array.isArray(notifications.events) ? notifications.events : [];
  for (const event of events) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      continue;
    }
    const record = event as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : undefined;
    const type = typeof record.type === 'string' ? record.type : 'workspace.event';
    if (!id) {
      continue;
    }
    await createHostNotification(session, {
      title: 'Workspace updated',
      body: type === 'workspace.member' ? 'Workspace member access changed.' : 'Workspace information changed.',
      actionUrl: '/dashboard/workspaces',
      source: 'workspace',
      category: 'workspace',
      idempotencyKey: id,
      metadata: record,
    });
  }
}

async function syncHostNotifications(session: ModuleHostSession) {
  await syncRunNotifications(session);
  await syncBillingNotifications(session);
  await syncFileNotifications(session);
  await syncWorkspaceNotifications(session);
}

export async function listHostNotifications(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  await syncHostNotifications(session);
  return runtimeStore.store.listNotifications({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
    userId: user.id,
    deliveryStatus: 'delivered',
  });
}

export async function getHostUnreadNotificationCount(session: ModuleHostSession) {
  const notifications = await listHostNotifications(session);
  return notifications.filter((notification) => notification.status === 'unread').length;
}

export async function markHostNotificationRead(session: ModuleHostSession, notificationId: string) {
  const { runtimeStore, user } = await currentUser(session);
  const existing = (
    await runtimeStore.store.listNotifications({
      productId: session.productId ?? user.productId,
      workspaceId: session.workspaceId ?? user.workspaceId,
      userId: user.id,
      deliveryStatus: 'delivered',
    })
  ).find((item) => item.id === notificationId);
  if (!existing) {
    throw new Error('HOST_NOTIFICATION_NOT_FOUND');
  }
  const notification = await runtimeStore.store.markNotificationRead(notificationId);
  await runtimeStore.store.recordAudit({
    productId: notification.productId,
    workspaceId: notification.workspaceId,
    actorId: session.actorId ?? user.id,
    type: 'host.notifications.read',
    metadata: { notificationId },
  });
  return notification;
}

export async function markHostNotificationsRead(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  const notifications = await runtimeStore.store.markNotificationsRead({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
    userId: user.id,
  });
  await runtimeStore.store.recordAudit({
    productId: session.productId ?? user.productId,
    workspaceId: session.workspaceId ?? user.workspaceId,
    actorId: session.actorId ?? user.id,
    type: 'host.notifications.read_all',
    metadata: { count: notifications.length },
  });
  return {
    readAllAt: new Date().toISOString(),
    count: notifications.length,
  };
}

export async function getHostNotificationPreferences(session: ModuleHostSession) {
  return (await getHostUserProfile(session)).preferences;
}

export async function updateHostNotificationPreferences(
  session: ModuleHostSession,
  input: {
    inApp?: boolean;
    email?: boolean;
    billing?: boolean;
    files?: boolean;
    admin?: boolean;
  }
) {
  return updateHostUserPreferences(session, input);
}

export async function listHostNotificationDeliveries(query: { productId?: string } = {}) {
  const runtimeStore = await getHostRuntimeStore();
  return runtimeStore.store.listNotificationDeliveries({
    productId: defaultProductId(query.productId),
  });
}

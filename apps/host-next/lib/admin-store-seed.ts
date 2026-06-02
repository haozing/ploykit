import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import { getDefaultModuleCatalogSeed, getDefaultRequiredModuleId } from './default-module-catalog';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from './default-scope';

const seedPromises = new WeakMap<RuntimeStore, Promise<void>>();

async function seedAdminCatalog(store: RuntimeStore, moduleIds: readonly string[]) {
  const existingStates = await store.listCatalogStates({ productId: DEFAULT_HOST_PRODUCT_ID });
  const existingModuleIds = new Set(existingStates.map((state) => state.moduleId));
  for (const moduleId of moduleIds) {
    if (existingModuleIds.has(moduleId)) {
      continue;
    }
    await store.upsertCatalogState({
      productId: DEFAULT_HOST_PRODUCT_ID,
      moduleId,
      status: 'enabled',
      ...getDefaultModuleCatalogSeed(moduleId),
    });
  }

  await store.upsertMembership({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    userId: 'demo-admin',
    role: 'owner',
    status: 'active',
  });
}

async function seedAdminStore(store: RuntimeStore, moduleIds: readonly string[]) {
  await seedAdminCatalog(store, moduleIds);
  const seedModuleId = getDefaultRequiredModuleId(moduleIds) ?? moduleIds[0] ?? '__host__';

  const existingAudit = await store.listAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    type: 'admin.snapshot.seeded',
  });
  if (existingAudit.length > 0) {
    return;
  }

  const run = await store.createRun({
    id: 'run_admin_smoke',
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    kind: 'manual',
    name: 'admin-smoke',
    idempotencyKey: 'admin-smoke-run',
  });
  await store.appendRunLog(run.id, 'info', 'Admin operation center bootstrapped.');
  await store.enqueueOutbox({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    name: 'admin.snapshot.created',
    payload: { ok: true },
    idempotencyKey: 'admin-smoke-outbox',
  });
  await store.createWebhookReceipt({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    webhookName: 'admin-smoke',
    path: '/admin-smoke-webhook',
    method: 'POST',
    idempotencyKey: 'admin-smoke-webhook',
  });
  await store.recordAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    actorId: 'demo-admin',
    type: 'admin.snapshot.seeded',
  });
  await store.recordUsage({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    meter: 'admin.snapshot',
    idempotencyKey: 'admin-smoke-usage',
  });
  const notification = await store.createNotification({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: '__host__',
    userId: 'demo-admin',
    channel: 'inApp',
    title: 'Admin operations seeded',
    body: 'Delivery log is backed by runtime store.',
    source: 'admin',
    category: 'admin',
    idempotencyKey: 'admin-smoke-notification',
  });
  await store.recordNotificationDelivery({
    notificationId: notification.id,
    productId: notification.productId,
    workspaceId: notification.workspaceId,
    userId: notification.userId,
    channel: notification.channel,
    provider: 'in-app',
    status: notification.deliveryStatus,
    metadata: { seed: true },
  });
}

export async function ensureAdminStoreSeeded(
  store: RuntimeStore,
  moduleIds: readonly string[]
): Promise<void> {
  let promise = seedPromises.get(store);
  if (!promise) {
    promise = seedAdminStore(store, moduleIds).catch((error) => {
      seedPromises.delete(store);
      throw error;
    });
    seedPromises.set(store, promise);
  }

  await promise;
}

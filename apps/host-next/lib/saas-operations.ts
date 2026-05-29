import type {
  ModuleHostSession,
  ModuleRunRecord,
  RuntimeStore,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreNotificationRecord,
} from '@/lib/module-runtime';
import { getHostRuntimeStore, type HostRuntimeStoreStatus } from './runtime-store';
import { normalizeRuntimeStoreEntitlementGrant } from '@/lib/module-capabilities/commercial/commercial-ledger';

export interface UserSaasSnapshot {
  userId: string;
  productId: string;
  workspaceId: string | null;
  store: HostRuntimeStoreStatus;
  creditBalance: { userId: string; unit: string; balance: number };
  credits: RuntimeStoreCreditLedgerEntry[];
  entitlements: RuntimeStoreEntitlementGrant[];
  orders: RuntimeStoreCommercialOrder[];
  tasks: ModuleRunRecord[];
  notifications: RuntimeStoreNotificationRecord[];
}

const seedPromises = new WeakMap<RuntimeStore, Map<string, Promise<void>>>();

function requireUserScope(session: ModuleHostSession) {
  const userId = session.userId ?? session.user?.id;
  const productId = session.productId;
  if (!userId || !productId) {
    throw new Error('SAAS_SESSION_SCOPE_REQUIRED');
  }

  return {
    userId,
    productId,
    workspaceId: session.workspaceId ?? null,
  };
}

async function seedUserSaasStore(store: RuntimeStore, session: ModuleHostSession) {
  const scope = requireUserScope(session);

  await store.recordCreditLedger({
    productId: scope.productId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    amount: 120,
    unit: 'credit',
    reason: 'welcome_bonus',
    idempotencyKey: 'host-welcome-credit',
  });
  await store.recordCreditLedger({
    productId: scope.productId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    amount: -3,
    unit: 'credit',
    reason: 'public_tool_usage',
    idempotencyKey: 'host-public-tool-usage',
  });
  await store.grantEntitlement({
    productId: scope.productId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    entitlement: 'public-tools.pro',
    planId: 'demo-pro',
    source: 'host-seed',
    idempotencyKey: 'host-public-tools-pro',
  });

  const order = await store.createCommercialOrder({
    productId: scope.productId,
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    sku: 'demo-pro-monthly',
    amount: 0,
    currency: 'USD',
    provider: 'local',
    providerRef: `local:${scope.userId}:demo-pro-monthly`,
    idempotencyKey: 'demo-pro-order',
  });
  if (order.status !== 'paid') {
    await store.updateCommercialOrderStatus(order.id, 'paid', { seeded: true });
  }

  const existingTask = await store.listRuns({
    productId: scope.productId,
    moduleId: 'web-shell',
    idempotencyKey: `host-task:${scope.userId}:public-tools-export`,
  });
  if (existingTask.length === 0) {
    const run = await store.createRun({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      moduleId: 'web-shell',
      kind: 'manual',
      name: 'public tools export',
      input: { format: 'json' },
      idempotencyKey: `host-task:${scope.userId}:public-tools-export`,
    });
    await store.updateRunStatus(run.id, 'succeeded', {
      progress: 100,
      result: { exportedRows: 1 },
    });
  }
}

async function ensureUserSaasSeeded(store: RuntimeStore, session: ModuleHostSession) {
  const scope = requireUserScope(session);
  const key = `${scope.productId}:${scope.workspaceId ?? 'default'}:${scope.userId}`;
  let storeSeeds = seedPromises.get(store);
  if (!storeSeeds) {
    storeSeeds = new Map();
    seedPromises.set(store, storeSeeds);
  }

  let promise = storeSeeds.get(key);
  if (!promise) {
    promise = seedUserSaasStore(store, session).catch((error) => {
      storeSeeds?.delete(key);
      throw error;
    });
    storeSeeds.set(key, promise);
  }

  await promise;
}

export async function getUserSaasSnapshot(
  session: ModuleHostSession
): Promise<UserSaasSnapshot> {
  const scope = requireUserScope(session);
  const runtimeStore = await getHostRuntimeStore();
  await ensureUserSaasSeeded(runtimeStore.store, session);

  const [creditBalance, credits, entitlements, orders, tasks, notifications] = await Promise.all([
    runtimeStore.store.getCreditBalance({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      unit: 'credit',
    }),
    runtimeStore.store.listCreditLedger({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      unit: 'credit',
    }),
    runtimeStore.store.listEntitlements({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
    }),
    runtimeStore.store.listCommercialOrders({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
    }),
    runtimeStore.store.listRuns({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
    }),
    runtimeStore.store.listNotifications({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      deliveryStatus: 'delivered',
    }),
  ]);
  const normalizedEntitlements = entitlements.map((grant) => normalizeRuntimeStoreEntitlementGrant(grant));

  return {
    userId: scope.userId,
    productId: scope.productId,
    workspaceId: scope.workspaceId,
    store: runtimeStore.status,
    creditBalance,
    credits,
    entitlements: normalizedEntitlements,
    orders,
    tasks,
    notifications,
  };
}

export async function getUserTaskDetail(
  session: ModuleHostSession,
  runId: string
): Promise<ModuleRunRecord | null> {
  const scope = requireUserScope(session);
  const runtimeStore = await getHostRuntimeStore();
  await ensureUserSaasSeeded(runtimeStore.store, session);
  const runs = await runtimeStore.store.listRuns({
    productId: scope.productId,
    workspaceId: scope.workspaceId,
  });
  return runs.find((run) => run.id === runId) ?? null;
}

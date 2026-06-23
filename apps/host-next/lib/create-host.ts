import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';
import type { RuntimeStoreCommercialRuntime } from '@/lib/module-capabilities/commercial/commercial-ledger';
import type { StorageBackedModuleFileRuntime } from '@/lib/module-capabilities/files/storage-file-runtime';
import { createModuleHost, type ModuleHost } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract';
import { loadModuleRuntimeContracts } from '@/lib/module-runtime/loader/load-module-contracts';
import {
  createModuleRouteManifest,
  findModuleRouteMatch,
  type ModuleRuntimeRouteEntry,
} from '@/lib/module-runtime/routes';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import {
  createMemoryModuleDataApi,
  createMemoryModuleDataStore,
  type MemoryModuleDataStore,
} from '@/lib/module-runtime/data';
import {
  createInMemoryRateLimiter,
  createPostgresSlidingWindowRateLimiter,
} from '@/lib/module-runtime/security/rate-limit';
import type { PermissionValue } from '@ploykit/module-sdk';
import {
  createHostCommercialRuntimeFromStore,
  getHostBillingProviderStatus,
  loadHostBillingCatalog,
  type HostBillingCatalog,
} from './commercial-provider';
import { getHostAiProviderStatus } from './ai-provider';
import { getEffectiveHostEmailProviderStatus } from './email-provider';
import {
  createHostCapabilityProviders,
  createHostModuleApiKeyVerifier,
} from './capability-providers';
import {
  createHostFileRuntimeFromParts,
  getHostFileStorage,
  type HostFileStorageHandle,
} from './files';
import { getHostAuthStatus, getHostSecurityStatus } from './host-config';
import { createHostRuntimeHealth, type HostRuntimeHealth } from './host-health';
import { getHostRagProviderStatus } from './rag-provider';
import { getHostRuntimeStore, type HostRuntimeStoreHandle } from './runtime-store';
import {
  applyHostDevRuntimeSeed,
  applyHostDevRuntimeSeedIfChanged,
} from './dev-runtime-seed';
import {
  DEFAULT_HOST_ADMIN_USER_ID,
  DEFAULT_HOST_ENVIRONMENT_ID,
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from './default-scope';
import { getDefaultModuleCatalogSeed } from './default-module-catalog';
import { invalidateDashboardShellCache } from './dashboard-shell-cache';
import { setHostSecurityRateLimiterForRuntime } from './security';

function sessionWithPermissions(
  session: ModuleHostSession,
  permissions: readonly PermissionValue[]
): ModuleHostSession {
  if (!session.user || session.user.role === 'admin' || session.system) {
    return session;
  }

  const merged = new Set([...(session.permissions ?? []), ...permissions]);
  return {
    ...session,
    permissions: [...merged],
  };
}

function moduleIdForHostRequest(input: {
  operation: 'api' | 'action' | 'page';
  pathname?: string;
  routeKind?: 'site' | 'dashboard' | 'admin';
  moduleId?: string;
}, routes: readonly ModuleRuntimeRouteEntry[]): string | null {
  if (input.moduleId) {
    return input.moduleId;
  }
  if (!input.pathname) {
    return null;
  }
  const routeKind = input.operation === 'api' ? 'api' : input.routeKind;
  if (!routeKind) {
    return null;
  }
  return findModuleRouteMatch(routes, routeKind, input.pathname)?.entry.moduleId ?? null;
}

export function applyModuleSelfServiceSessionPermissions(
  session: ModuleHostSession,
  input: {
    operation: 'api' | 'action' | 'page';
    pathname?: string;
    routeKind?: 'site' | 'dashboard' | 'admin';
    moduleId?: string;
  },
  contracts: readonly ModuleRuntimeContract[],
  routes: readonly ModuleRuntimeRouteEntry[] = createModuleRouteManifest(contracts)
): ModuleHostSession {
  const moduleId = moduleIdForHostRequest(input, routes);
  const contract = moduleId ? contracts.find((candidate) => candidate.id === moduleId) : null;
  return contract ? sessionWithPermissions(session, contract.permissions) : session;
}

async function ensureHostCatalogSeeded(runtimeStore: HostRuntimeStoreHandle): Promise<void> {
  const moduleIds = Object.keys(MODULE_MAP_ARTIFACT.modules);
  const existing = await runtimeStore.store.listCatalogStates({
    productId: DEFAULT_HOST_PRODUCT_ID,
  });
  const existingModuleIds = new Set(existing.map((state) => state.moduleId));
  for (const moduleId of moduleIds) {
    if (existingModuleIds.has(moduleId)) {
      continue;
    }
    const seed = getDefaultModuleCatalogSeed(moduleId);
    await runtimeStore.store.upsertCatalogState({
      productId: DEFAULT_HOST_PRODUCT_ID,
      moduleId,
      status: 'enabled',
      bundleId: seed.bundleId,
      required: seed.required,
      scopeProfile: seed.scopeProfile,
    });
    existingModuleIds.add(moduleId);
  }
}

async function ensureHostDemoCreditsSeeded(runtimeStore: HostRuntimeStoreHandle): Promise<void> {
  await runtimeStore.store.recordCreditLedger({
    productId: DEFAULT_HOST_PRODUCT_ID,
    environmentId: DEFAULT_HOST_ENVIRONMENT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    userId: DEFAULT_HOST_ADMIN_USER_ID,
    amount: 1000,
    unit: 'ai-credit',
    reason: 'demo.admin_ai_credit_grant',
    idempotencyKey: 'demo-admin-ai-credit-grant',
  });
}

function configureHostSecurityRateLimiter(runtimeStore: HostRuntimeStoreHandle): void {
  setHostSecurityRateLimiterForRuntime(
    runtimeStore.database
      ? createPostgresSlidingWindowRateLimiter({ database: runtimeStore.database })
      : createInMemoryRateLimiter()
  );
}

export interface HostRuntime {
  runtimeStore: HostRuntimeStoreHandle;
  fileStorage: HostFileStorageHandle;
  moduleHost: ModuleHost;
  health: HostRuntimeHealth;
  createFileRuntime(session: ModuleHostSession): StorageBackedModuleFileRuntime;
  createCommercialRuntime(session?: ModuleHostSession): RuntimeStoreCommercialRuntime;
}

let hostRuntimePromise: Promise<HostRuntime> | null = null;
const MEMORY_MODULE_DATA_STORE_KEY = Symbol.for('ploykit.host.memoryModuleDataStore');

type HostMemoryModuleDataStoreGlobal = typeof globalThis & {
  [MEMORY_MODULE_DATA_STORE_KEY]?: MemoryModuleDataStore;
};

function getHostMemoryModuleDataStore(): MemoryModuleDataStore {
  const state = globalThis as HostMemoryModuleDataStoreGlobal;
  state[MEMORY_MODULE_DATA_STORE_KEY] ??= createMemoryModuleDataStore();
  return state[MEMORY_MODULE_DATA_STORE_KEY]!;
}

async function resolveScopedHostRequestSession(request: Request): Promise<ModuleHostSession> {
  const { createScopedDemoHostSession } = await import('./product-scope');
  return createScopedDemoHostSession(request);
}

async function createModuleHostForRuntime(input: {
  runtimeStore: HostRuntimeStoreHandle;
  fileStorage: HostFileStorageHandle;
  billingCatalog: HostBillingCatalog;
}): Promise<ModuleHost> {
  const catalogStates = await input.runtimeStore.store.listCatalogStates({
    productId: DEFAULT_HOST_PRODUCT_ID,
  });
  const contracts = await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT);
  const routes = createModuleRouteManifest(contracts);
  const memoryDataStore = input.runtimeStore.database ? null : getHostMemoryModuleDataStore();
  return createModuleHost({
    artifact: MODULE_MAP_ARTIFACT,
    catalog: {
      productId: DEFAULT_HOST_PRODUCT_ID,
      moduleStates: catalogStates,
    },
    async resolveSession(requestInput) {
      await applyHostDevRuntimeSeedIfChanged(input.runtimeStore);
      const scopedSession = await resolveScopedHostRequestSession(requestInput.request);
      return applyModuleSelfServiceSessionPermissions(scopedSession, requestInput, contracts, routes);
    },
    verifyApiKey: createHostModuleApiKeyVerifier({
      store: input.runtimeStore.store,
    }),
    runtimeStore: input.runtimeStore.store,
    data: input.runtimeStore.database
      ? {
          database: input.runtimeStore.database,
          session({ hostSession }) {
            const productId = hostSession.productId;
            if (!productId) {
              return null;
            }

            return {
              productId,
              workspaceId: hostSession.workspaceId ?? null,
              scopeId: hostSession.workspaceId ?? productId,
              userId: hostSession.userId ?? hostSession.user?.id ?? null,
              actorId: hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id ?? null,
            };
          },
        }
      : undefined,
    createDataApi: memoryDataStore
      ? ({ contract, session }) => {
          const productId = session?.productId;
          if (!productId) {
            throw new Error(`MODULE_HOST_MEMORY_DATA_SESSION_REQUIRED: ${contract.id}`);
          }

          return createMemoryModuleDataApi({
            contract,
            store: memoryDataStore,
            session: {
              productId,
              workspaceId: session.workspaceId ?? null,
              scopeId: session.workspaceId ?? productId,
              userId: session.userId ?? session.user?.id ?? null,
              actorId: session.actorId ?? session.userId ?? session.user?.id ?? null,
            },
          });
        }
      : undefined,
    capabilities: createHostCapabilityProviders(input),
  });
}

export async function createHostRuntime(): Promise<HostRuntime> {
  const [runtimeStore, fileStorage] = await Promise.all([
    getHostRuntimeStore(),
    getHostFileStorage(),
  ]);
  configureHostSecurityRateLimiter(runtimeStore);
  await ensureHostCatalogSeeded(runtimeStore);
  await ensureHostDemoCreditsSeeded(runtimeStore);
  await applyHostDevRuntimeSeed(runtimeStore);
  const billingCatalog = await loadHostBillingCatalog(runtimeStore.store, DEFAULT_HOST_PRODUCT_ID);
  const moduleHost = await createModuleHostForRuntime({
    runtimeStore,
    fileStorage,
    billingCatalog,
  });
  const emailStatus = await getEffectiveHostEmailProviderStatus();
  const health = createHostRuntimeHealth({
    store: runtimeStore.status,
    auth: getHostAuthStatus(runtimeStore.durable),
    files: fileStorage.status,
    billing: getHostBillingProviderStatus(),
    ai: getHostAiProviderStatus(),
    rag: getHostRagProviderStatus(
      {
        PLOYKIT_RAG_PROVIDER: process.env.PLOYKIT_RAG_PROVIDER,
        PLOYKIT_RAG_CHUNK_SIZE: process.env.PLOYKIT_RAG_CHUNK_SIZE,
      },
      runtimeStore.status
    ),
    email: emailStatus,
    security: getHostSecurityStatus(),
  });

  return {
    runtimeStore,
    fileStorage,
    moduleHost,
    health,
    createFileRuntime(session) {
      return createHostFileRuntimeFromParts({
        store: runtimeStore.store,
        storage: fileStorage.storage,
        session,
      });
    },
    createCommercialRuntime(session) {
      return createHostCommercialRuntimeFromStore({
        store: runtimeStore.store,
        productId: session?.productId,
        environmentId: session?.environmentId ?? null,
        workspaceId: session?.workspaceId ?? null,
        catalog: billingCatalog,
      });
    },
  };
}

export function getHostRuntime(): Promise<HostRuntime> {
  hostRuntimePromise ??= createHostRuntime();
  return hostRuntimePromise;
}

export async function getHostModuleHost(): Promise<ModuleHost> {
  return (await getHostRuntime()).moduleHost;
}

export async function getHostRuntimeHealth(): Promise<HostRuntimeHealth> {
  return (await getHostRuntime()).health;
}

export function resetHostRuntimeForTests(): void {
  hostRuntimePromise = null;
}

export function invalidateHostRuntime(): void {
  hostRuntimePromise = null;
  invalidateDashboardShellCache();
}

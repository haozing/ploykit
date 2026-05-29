import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';
import type { RuntimeStoreCommercialRuntime } from '@/lib/module-capabilities/commercial/commercial-ledger';
import type { StorageBackedModuleFileRuntime } from '@/lib/module-capabilities/files/storage-file-runtime';
import { createModuleHost, type ModuleHost } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
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
import { resolveHostRequestSession } from './auth-session';
import { getHostRuntimeStore, type HostRuntimeStoreHandle } from './runtime-store';
import {
  DEFAULT_HOST_ADMIN_USER_ID,
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from './default-scope';
import { getDefaultModuleCatalogSeed } from './default-module-catalog';

async function ensureHostCatalogSeeded(runtimeStore: HostRuntimeStoreHandle): Promise<void> {
  const moduleIds = Object.keys(MODULE_MAP_ARTIFACT.modules);
  for (const moduleId of moduleIds) {
    const existing = await runtimeStore.store.listCatalogStates({
      productId: DEFAULT_HOST_PRODUCT_ID,
    });
    if (existing.some((state) => state.moduleId === moduleId)) {
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
  }
}

async function ensureHostDemoCreditsSeeded(runtimeStore: HostRuntimeStoreHandle): Promise<void> {
  await runtimeStore.store.recordCreditLedger({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    userId: DEFAULT_HOST_ADMIN_USER_ID,
    amount: 1000,
    unit: 'ai-credit',
    reason: 'demo.admin_ai_credit_grant',
    idempotencyKey: 'demo-admin-ai-credit-grant',
  });
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

async function createModuleHostForRuntime(input: {
  runtimeStore: HostRuntimeStoreHandle;
  fileStorage: HostFileStorageHandle;
  billingCatalog: HostBillingCatalog;
}): Promise<ModuleHost> {
  const catalogStates = await input.runtimeStore.store.listCatalogStates({
    productId: DEFAULT_HOST_PRODUCT_ID,
  });
  return createModuleHost({
    artifact: MODULE_MAP_ARTIFACT,
    catalog: {
      productId: DEFAULT_HOST_PRODUCT_ID,
      moduleStates: catalogStates,
    },
    async resolveSession({ request }) {
      return (await resolveHostRequestSession(request)).session;
    },
    verifyApiKey: createHostModuleApiKeyVerifier({
      store: input.runtimeStore.store,
    }),
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
    capabilities: createHostCapabilityProviders(input),
  });
}

export async function createHostRuntime(): Promise<HostRuntime> {
  const [runtimeStore, fileStorage] = await Promise.all([
    getHostRuntimeStore(),
    getHostFileStorage(),
  ]);
  await ensureHostCatalogSeeded(runtimeStore);
  await ensureHostDemoCreditsSeeded(runtimeStore);
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
}

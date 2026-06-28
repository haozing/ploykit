import { createRuntimeStoreModuleResourceBindingsApi } from '@/lib/module-runtime/capabilities/resource-bindings';
import type { CreateModuleHostCapabilitiesOptions } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { createModuleHttpApi } from '@/lib/module-capabilities/http/http-runtime';
import {
  createHostAuditWriter,
  createHostModuleAuditApi,
} from './capabilities/audit';
import {
  createHostModuleAiApiForSession,
  createHostModuleRagApiForSession,
} from './capabilities/ai-rag';
import {
  createHostModuleArtifactsApi,
  createHostModuleFilesApi,
} from './capabilities/files';
import { createHostModuleNotificationsApi } from './capabilities/notifications';
import {
  createHostCommercialForSession,
  createHostModuleBillingApi,
  createHostModuleCommerceApi,
  createHostModuleCreditsApi,
  createHostModuleEntitlementsApi,
  createHostModuleMeteringApi,
  createHostModuleRedeemCodesApi,
  createHostModuleRiskApi,
  createHostModuleUsageApi,
} from './capabilities/commercial';
import {
  createScopedEventsApi,
  createScopedJobsApi,
  createScopedRunsApi,
  createScopedWebhooksApi,
} from './capabilities/background';
import {
  createHostServiceConnectionsApi,
  createHostServiceInvocationApi,
} from './capabilities/services';
import { createHostModuleApiKeysApi } from './capability-api-keys';
import type { HostBillingCatalog } from './commercial-provider';
import type { HostFileStorageHandle } from './files';
import type { HostRuntimeStoreHandle } from './runtime-store';
import { defaultProductId } from './default-scope';

export { createHostModuleApiKeyVerifier, createHostModuleApiKeysApi } from './capability-api-keys';
export {
  createScopedEventsApi,
  createScopedJobsApi,
  createScopedRunsApi,
  createScopedWebhooksApi,
} from './capabilities/background';
export { createHostAuditWriter, createHostModuleAuditApi } from './capabilities/audit';
export { createHostModuleAiApiForSession, createHostModuleRagApiForSession } from './capabilities/ai-rag';
export { createHostModuleArtifactsApi, createHostModuleFilesApi } from './capabilities/files';
export { createHostModuleNotificationsApi } from './capabilities/notifications';
export {
  createHostCommercialForSession,
  createHostModuleBillingApi,
  createHostModuleCommerceApi,
  createHostModuleCreditsApi,
  createHostModuleEntitlementsApi,
  createHostModuleMeteringApi,
  createHostModuleRedeemCodesApi,
  createHostModuleRiskApi,
  createHostModuleUsageApi,
} from './capabilities/commercial';
export { createHostServiceConnectionsApi } from './capabilities/services';

function normalizeEgressOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

export function createHostCapabilityProviders(input: {
  runtimeStore: HostRuntimeStoreHandle;
  fileStorage: HostFileStorageHandle;
  billingCatalog?: HostBillingCatalog;
}): CreateModuleHostCapabilitiesOptions {
  const commercialForSession = createHostCommercialForSession({
    runtimeStore: input.runtimeStore,
    billingCatalog: input.billingCatalog,
  });

  function auditForSession(hostSession: ModuleHostSession) {
    return createHostAuditWriter({
      store: input.runtimeStore.store,
      hostSession,
    });
  }

  return {
    audit: ({ contract, hostSession }) =>
      createHostModuleAuditApi({
        moduleId: contract.id,
        writeAudit: auditForSession(hostSession),
      }),
    ai: ({ contract, hostSession }) =>
      createHostModuleAiApiForSession({
        contract,
        hostSession,
        commercialForSession,
        audit: auditForSession(hostSession),
      }),
    rag: ({ contract, hostSession }) => {
      const audit = auditForSession(hostSession);
      const ai = createHostModuleAiApiForSession({
        contract,
        hostSession,
        commercialForSession,
        audit,
      });
      return createHostModuleRagApiForSession({
        contract,
        hostSession,
        runtimeStore: input.runtimeStore,
        ai,
        audit,
      });
    },
    notifications: ({ contract, hostSession }) =>
      createHostModuleNotificationsApi({
        contract,
        hostSession,
        runtimeStore: input.runtimeStore,
      }),
    files: ({ contract, hostSession }) =>
      createHostModuleFilesApi({
        contract,
        hostSession,
        runtimeStore: input.runtimeStore,
        fileStorage: input.fileStorage,
      }),
    artifacts: ({ contract }) => createHostModuleArtifactsApi({ contract }),
    connectors: ({ contract, hostSession }) =>
      createHostServiceConnectionsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    services: ({ contract, hostSession, request }) =>
      createHostServiceInvocationApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
        request,
      }),
    resourceBindings: ({ contract, hostSession }) =>
      createRuntimeStoreModuleResourceBindingsApi({
        store: input.runtimeStore.store,
        productId: defaultProductId(hostSession.productId),
        workspaceId: hostSession.workspaceId ?? null,
        moduleId: contract.id,
        actorId: hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id ?? null,
      }),
    runs: ({ contract, hostSession }) =>
      createScopedRunsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    http: ({ contract, hostSession }) =>
      createModuleHttpApi({
        moduleId: contract.id,
        allowedOrigins: contract.egress.map(normalizeEgressOrigin),
        maxBodyBytes: 1024 * 1024,
        audit: async (event) => {
          await input.runtimeStore.store.recordAudit({
            productId: defaultProductId(hostSession.productId),
            workspaceId: hostSession.workspaceId ?? null,
            actorId: hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id,
            moduleId: contract.id,
            type: 'module.http.fetch',
            metadata: {
              method: event.method,
              origin: event.origin,
              path: event.path,
              ok: event.ok,
              status: event.status,
              durationMs: event.durationMs,
              errorCode: event.errorCode,
            },
          });
        },
      }),
    jobs: ({ contract, hostSession }) =>
      createScopedJobsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    events: ({ contract, hostSession }) =>
      createScopedEventsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    webhooks: ({ contract, hostSession }) =>
      createScopedWebhooksApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
    usage: ({ contract, hostSession }) =>
      createHostModuleUsageApi({ contract, hostSession, commercialForSession }),
    metering: ({ contract, hostSession }) =>
      createHostModuleMeteringApi({ contract, hostSession, commercialForSession }),
    credits: ({ contract, hostSession }) =>
      createHostModuleCreditsApi({ contract, hostSession, commercialForSession }),
    billing: ({ contract, hostSession }) =>
      createHostModuleBillingApi({ contract, hostSession, commercialForSession }),
    entitlements: ({ contract, hostSession }) =>
      createHostModuleEntitlementsApi({ contract, hostSession, commercialForSession }),
    commerce: ({ contract, hostSession }) =>
      createHostModuleCommerceApi({ contract, hostSession, commercialForSession }),
    redeemCodes: ({ contract, hostSession }) =>
      createHostModuleRedeemCodesApi({ contract, hostSession, commercialForSession }),
    risk: ({ contract, hostSession }) =>
      createHostModuleRiskApi({ contract, hostSession, commercialForSession }),
    apiKeys: ({ contract, hostSession }) =>
      createHostModuleApiKeysApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
  };
}

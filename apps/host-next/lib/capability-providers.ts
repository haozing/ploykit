import type { CreateModuleHostCapabilitiesOptions } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import {
  createHostAuditWriter,
  createHostModuleAuditApi,
} from './capabilities/audit';
import {
  createHostModuleAiApiForSession,
  createHostModuleRagApiForSession,
} from './capabilities/ai-rag';
import { createHostModuleFilesApi } from './capabilities/files';
import { createHostModuleNotificationsApi } from './capabilities/notifications';
import {
  createHostCommercialForSession,
  createHostModuleCommercialApi,
} from './capabilities/commercial';
import {
  createScopedEventsApi,
  createScopedJobsApi,
  createScopedRunsApi,
  createScopedWebhooksApi,
} from './capabilities/background';
import { createHostServiceInvocationApi } from './capabilities/services';
export { createHostModuleApiKeyVerifier } from './capability-api-keys';
export { createHostServiceConnectionsApi } from './capabilities/services';
import type { HostBillingCatalog } from './commercial-provider';
import type { HostFileStorageHandle } from './files';
import type { HostRuntimeStoreHandle } from './runtime-store';

export {
  createScopedEventsApi,
  createScopedJobsApi,
  createScopedRunsApi,
  createScopedWebhooksApi,
} from './capabilities/background';
export { createHostAuditWriter, createHostModuleAuditApi } from './capabilities/audit';
export { createHostModuleAiApiForSession, createHostModuleRagApiForSession } from './capabilities/ai-rag';
export { createHostModuleFilesApi } from './capabilities/files';
export { createHostModuleNotificationsApi } from './capabilities/notifications';
export {
  createHostCommercialForSession,
  createHostModuleCommercialApi,
} from './capabilities/commercial';

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
    services: ({ contract, hostSession, request }) =>
      createHostServiceInvocationApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
        request,
      }),
    runs: ({ contract, hostSession }) =>
      createScopedRunsApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
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
    commercial: ({ contract, hostSession }) =>
      createHostModuleCommercialApi({ contract, hostSession, commercialForSession }),
  };
}

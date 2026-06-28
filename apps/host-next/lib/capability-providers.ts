import { createInMemoryModuleArtifactRuntime } from '@/lib/module-capabilities/artifacts/artifact-runtime';
import { createRuntimeStoreModuleResourceBindingsApi } from '@/lib/module-runtime/capabilities/resource-bindings';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { CreateModuleHostCapabilitiesOptions } from '@/lib/module-runtime/host/create-module-host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { createModuleHttpApi } from '@/lib/module-capabilities/http/http-runtime';
import { createRuntimeStoreNotificationRuntime } from '@/lib/module-capabilities/notifications/notification-runtime';
import type { ModuleAuditRecordInput } from '@ploykit/module-sdk';
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
import { createHostModuleAiApi } from './ai-provider';
import { createHostModuleApiKeysApi } from './capability-api-keys';
import {
  createHostCommercialRuntimeFromStore,
  type HostBillingCatalog,
} from './commercial-provider';
import { createHostFileRuntimeFromParts, type HostFileStorageHandle } from './files';
import { createHostModuleRagApi } from './rag-provider';
import type { HostRuntimeStoreHandle } from './runtime-store';
import {
  DEFAULT_HOST_PRODUCT_ID,
  defaultProductId,
} from './default-scope';

export { createHostModuleApiKeyVerifier, createHostModuleApiKeysApi } from './capability-api-keys';
export {
  createScopedEventsApi,
  createScopedJobsApi,
  createScopedRunsApi,
  createScopedWebhooksApi,
} from './capabilities/background';
export { createHostServiceConnectionsApi } from './capabilities/services';

const artifactRuntime = createInMemoryModuleArtifactRuntime();
const DEFAULT_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

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
  function commercialForSession(hostSession: ModuleHostSession) {
    return createHostCommercialRuntimeFromStore({
      store: input.runtimeStore.store,
      productId: hostSession.productId,
      environmentId: hostSession.environmentId ?? null,
      workspaceId: hostSession.workspaceId ?? null,
      catalog: input.billingCatalog,
    });
  }

  function auditForSession(hostSession: ModuleHostSession) {
    return async (record: {
      moduleId: string;
      type: string;
      actorId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      await input.runtimeStore.store.recordAudit({
        productId: hostSession.productId ?? DEFAULT_PRODUCT_ID,
        workspaceId: hostSession.workspaceId ?? null,
        moduleId: record.moduleId,
        actorId: record.actorId ?? hostSession.actorId ?? hostSession.userId ?? hostSession.user?.id,
        type: record.type,
        metadata: record.metadata,
      });
    };
  }

  function normalizeModuleAuditInput(
    typeOrInput: string | ModuleAuditRecordInput,
    metadata?: Record<string, unknown>
  ): { type: string; actorId?: string; metadata?: Record<string, unknown> } {
    if (typeof typeOrInput === 'string') {
      return { type: typeOrInput, metadata };
    }
    return {
      type: typeOrInput.action,
      actorId: typeOrInput.actorId,
      metadata: {
        ...(typeOrInput.metadata ?? {}),
        actorKind: typeOrInput.actorKind,
        action: typeOrInput.action,
        category: typeOrInput.category,
        targetKind: typeOrInput.targetKind,
        targetId: typeOrInput.targetId,
        decision: typeOrInput.decision,
        reasonCode: typeOrInput.reasonCode,
        requestId: typeOrInput.requestId,
        traceId: typeOrInput.traceId,
        beforeHash: typeOrInput.beforeHash,
        afterHash: typeOrInput.afterHash,
        sync: typeOrInput.sync,
      },
    };
  }

  function aiForSession(contract: ModuleRuntimeContract, hostSession: ModuleHostSession) {
    return createHostModuleAiApi({
      moduleId: contract.id,
      session: hostSession,
      commercialForModule(moduleId) {
        return commercialForSession(hostSession).forModule(moduleId);
      },
      audit: auditForSession(hostSession),
    });
  }

  return {
    audit: ({ contract, hostSession }) => ({
      async record(type, metadata) {
        const normalized = normalizeModuleAuditInput(type, metadata);
        await auditForSession(hostSession)({
          moduleId: contract.id,
          type: normalized.type,
          actorId: normalized.actorId,
          metadata: normalized.metadata,
        });
      },
    }),
    ai: ({ contract, hostSession }) => aiForSession(contract, hostSession),
    rag: ({ contract, hostSession }) =>
      createHostModuleRagApi({
        moduleId: contract.id,
        session: hostSession,
        ai: aiForSession(contract, hostSession),
        store: input.runtimeStore.store,
        durable: input.runtimeStore.durable,
        audit: auditForSession(hostSession),
      }),
    notifications: ({ contract, hostSession }) =>
      createRuntimeStoreNotificationRuntime({
        store: input.runtimeStore.store,
        productId: defaultProductId(hostSession.productId),
        workspaceId: hostSession.workspaceId ?? null,
      }).forModule(contract.id),
    files: ({ contract, hostSession }) =>
      createHostFileRuntimeFromParts({
        store: input.runtimeStore.store,
        storage: input.fileStorage.storage,
        session: hostSession,
      }).forModule(contract.id),
    artifacts: ({ contract }) => artifactRuntime.forModule(contract.id),
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
      commercialForSession(hostSession).forModule(contract.id).usage,
    metering: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).metering,
    credits: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).credits,
    billing: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).billing,
    entitlements: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).entitlements,
    commerce: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).commerce,
    redeemCodes: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).redeemCodes,
    risk: ({ contract, hostSession }) =>
      commercialForSession(hostSession).forModule(contract.id).risk,
    apiKeys: ({ contract, hostSession }) =>
      createHostModuleApiKeysApi({
        contract,
        store: input.runtimeStore.store,
        session: hostSession,
      }),
  };
}

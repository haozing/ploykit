import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  ModuleCommercialApi,
} from '@ploykit/module-sdk';
import {
  createHostCommercialRuntimeFromStore,
  type HostBillingCatalog,
} from '../commercial-provider';
import type { HostRuntimeStoreHandle } from '../runtime-store';

export function createHostCommercialForSession(input: {
  runtimeStore: HostRuntimeStoreHandle;
  billingCatalog?: HostBillingCatalog;
}) {
  return (hostSession: ModuleHostSession) =>
    createHostCommercialRuntimeFromStore({
      store: input.runtimeStore.store,
      productId: hostSession.productId,
      environmentId: hostSession.environmentId ?? null,
      workspaceId: hostSession.workspaceId ?? null,
      catalog: input.billingCatalog,
    });
}

export type HostCommercialForSession = ReturnType<typeof createHostCommercialForSession>;

function commercialModuleRuntime(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}) {
  return input.commercialForSession(input.hostSession).forModule(input.contract.id);
}
export function createHostModuleCommercialApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleCommercialApi {
  const runtime = commercialModuleRuntime(input);
  const userId = input.hostSession.user?.id ?? input.hostSession.actorId ?? '';
  return {
    async read<T = unknown>(query = {}) {
      const normalizedQuery = query as Record<string, unknown>;
      const kind = typeof normalizedQuery.kind === 'string' ? normalizedQuery.kind : 'summary';
      if (kind === 'plan') {
        return (await runtime.billing.getCurrentPlan(userId)) as T;
      }
      if (kind === 'entitlements') {
        return (await runtime.entitlements.list({ userId })) as T;
      }
      if (kind === 'balance') {
        return (await runtime.credits.balance((normalizedQuery as never) || userId)) as T;
      }
      return (await Promise.all([
        runtime.billing.getCurrentPlan(userId),
        runtime.entitlements.list({ userId }),
      ]).then(([plan, entitlements]) => ({ plan, entitlements }))) as T;
    },
    async charge<T = unknown>(charge: Record<string, unknown>) {
      return (await runtime.metering.charge(charge as never)) as T;
    },
    async checkout<T = unknown>(checkout: Record<string, unknown>) {
      return (await runtime.commerce.createCheckout(checkout as never)) as T;
    },
  };
}

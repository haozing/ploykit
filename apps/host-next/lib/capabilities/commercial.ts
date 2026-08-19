import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  ModuleBillingApi,
  ModuleCommerceApi,
  ModuleCreditsApi,
  ModuleEntitlementsApi,
  ModuleMeteringApi,
  ModuleRedeemCodesApi,
  ModuleRiskApi,
  ModuleUsageApi,
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

export function createHostModuleUsageApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleUsageApi {
  return commercialModuleRuntime(input).usage;
}

export function createHostModuleMeteringApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleMeteringApi {
  return commercialModuleRuntime(input).metering;
}

export function createHostModuleCreditsApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleCreditsApi {
  return commercialModuleRuntime(input).credits;
}

export function createHostModuleBillingApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleBillingApi {
  return commercialModuleRuntime(input).billing;
}

export function createHostModuleEntitlementsApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleEntitlementsApi {
  return commercialModuleRuntime(input).entitlements;
}

export function createHostModuleCommerceApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleCommerceApi {
  return commercialModuleRuntime(input).commerce;
}

export function createHostModuleRedeemCodesApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleRedeemCodesApi {
  return commercialModuleRuntime(input).redeemCodes;
}

export function createHostModuleRiskApi(input: {
  contract: ModuleRuntimeContract;
  hostSession: ModuleHostSession;
  commercialForSession: HostCommercialForSession;
}): ModuleRiskApi {
  return commercialModuleRuntime(input).risk;
}

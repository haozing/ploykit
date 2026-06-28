import type { ModuleDiagnostic, ModuleProductScopeProfile } from '@ploykit/module-sdk';

export type ModuleCatalogModuleStatus = 'enabled' | 'disabled' | 'error' | 'maintenance';
export type ModuleRuntimeTrust = 'product' | 'trusted' | 'system';

export interface ModuleCatalogProduct {
  id: string;
  name: string;
  scopeProfile: ModuleProductScopeProfile;
  defaultBundleId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModuleCatalogSuite {
  id: string;
  name: string;
  productIds: readonly string[];
}

export interface ModuleCatalogBundleModule {
  moduleId: string;
  status?: ModuleCatalogModuleStatus;
  required?: boolean;
  scopeProfile?: ModuleProductScopeProfile;
  trust?: ModuleRuntimeTrust;
  allowedProvides?: readonly string[];
}

export interface ModuleCatalogPlanCapability {
  planId: string;
  capabilities: readonly string[];
  moduleIds?: readonly string[];
}

export interface ModuleCatalogBundle {
  id: string;
  name: string;
  description?: string;
  modules: readonly ModuleCatalogBundleModule[];
  requiredModuleIds?: readonly string[];
  planCapabilities?: readonly ModuleCatalogPlanCapability[];
}

export interface ModuleCatalogModuleState {
  productId: string;
  moduleId: string;
  status: ModuleCatalogModuleStatus;
  bundleId?: string;
  required?: boolean;
  scopeProfile?: ModuleProductScopeProfile;
  trust?: ModuleRuntimeTrust;
  allowedProvides?: readonly string[];
  diagnostics?: readonly ModuleDiagnostic[];
  updatedAt?: string;
}

export interface ModuleCatalogSnapshot {
  version: 1;
  products: readonly ModuleCatalogProduct[];
  suites?: readonly ModuleCatalogSuite[];
  bundles: readonly ModuleCatalogBundle[];
  moduleStates: readonly ModuleCatalogModuleState[];
}

export interface ModuleCatalogRuntimeFilter {
  productId?: string;
  moduleStates?: readonly ModuleCatalogModuleState[];
  enabledModuleIds?: readonly string[];
  includeMaintenance?: boolean;
}

export interface ModuleCatalogOperation {
  type: 'enable' | 'disable' | 'update' | 'noop';
  productId: string;
  moduleId: string;
  previousStatus?: ModuleCatalogModuleStatus;
  nextStatus: ModuleCatalogModuleStatus;
  required?: boolean;
  bundleId?: string;
}

export interface ModuleCatalogApplyPlan {
  productId: string;
  bundleId: string;
  operations: readonly ModuleCatalogOperation[];
  desiredStates: readonly ModuleCatalogModuleState[];
  diagnostics: readonly ModuleDiagnostic[];
}

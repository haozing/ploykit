import defaultCatalog from '../../../catalog/default.catalog.json';
import type { ModuleProductScopeProfile } from '@ploykit/module-sdk';
import type { ModuleCatalogSnapshot } from '@/lib/module-runtime/catalog';

import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_PRODUCT_SCOPE_PROFILE,
} from './default-scope';

const DEFAULT_MODULE_CATALOG = defaultCatalog as ModuleCatalogSnapshot;

function defaultProduct() {
  return (
    DEFAULT_MODULE_CATALOG.products.find((product) => product.id === DEFAULT_HOST_PRODUCT_ID) ??
    DEFAULT_MODULE_CATALOG.products[0]
  );
}

function defaultBundle() {
  const product = defaultProduct();
  return (
    DEFAULT_MODULE_CATALOG.bundles.find((bundle) => bundle.id === product?.defaultBundleId) ??
    DEFAULT_MODULE_CATALOG.bundles[0]
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function getDefaultCatalogModuleOrder(availableModuleIds: readonly string[]): string[] {
  const available = new Set(availableModuleIds);
  const bundle = defaultBundle();
  const ordered = unique([
    ...(bundle?.requiredModuleIds ?? []),
    ...(bundle?.modules ?? []).map((module) => module.moduleId),
    ...DEFAULT_MODULE_CATALOG.moduleStates.map((state) => state.moduleId),
    ...[...availableModuleIds].sort(),
  ]);

  return ordered.filter((moduleId) => available.has(moduleId));
}

export function getDefaultRequiredModuleId(availableModuleIds: readonly string[]): string | null {
  const available = new Set(availableModuleIds);
  const bundle = defaultBundle();
  const candidates = unique([
    ...(bundle?.requiredModuleIds ?? []),
    ...(bundle?.modules ?? [])
      .filter((module) => module.required === true)
      .map((module) => module.moduleId),
    ...DEFAULT_MODULE_CATALOG.moduleStates
      .filter((state) => state.required === true)
      .map((state) => state.moduleId),
  ]);

  return candidates.find((moduleId) => available.has(moduleId)) ?? availableModuleIds[0] ?? null;
}

export function getDefaultModuleCatalogSeed(moduleId: string): {
  bundleId: string | undefined;
  required: boolean;
  scopeProfile: ModuleProductScopeProfile;
} {
  const bundle = defaultBundle();
  const bundleModule = bundle?.modules.find((module) => module.moduleId === moduleId);
  const state = DEFAULT_MODULE_CATALOG.moduleStates.find(
    (candidate) =>
      candidate.productId === DEFAULT_HOST_PRODUCT_ID && candidate.moduleId === moduleId
  );
  const required =
    bundleModule?.required ?? bundle?.requiredModuleIds?.includes(moduleId) ?? state?.required ?? false;
  const fallbackScope = required ? DEFAULT_HOST_PRODUCT_SCOPE_PROFILE : 'explicit-workspace';

  return {
    bundleId: bundleModule ? bundle?.id : state?.bundleId ?? bundle?.id,
    required,
    scopeProfile: bundleModule?.scopeProfile ?? state?.scopeProfile ?? fallbackScope,
  };
}

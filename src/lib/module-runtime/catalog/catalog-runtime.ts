import type { ModuleRuntimeContract } from '../contract';
import type { ModuleMapArtifact } from '../loader';
import type { ModuleCatalogModuleState, ModuleCatalogRuntimeFilter } from './catalog-types';

function moduleStateKey(productId: string | undefined, moduleId: string): string {
  return `${productId ?? '*'}:${moduleId}`;
}

function stateAppliesToProduct(
  state: ModuleCatalogModuleState,
  productId: string | undefined
): boolean {
  return !productId || state.productId === productId;
}

export function isModuleCatalogStateEnabled(
  state: ModuleCatalogModuleState,
  includeMaintenance = false
): boolean {
  return state.status === 'enabled' || (includeMaintenance && state.status === 'maintenance');
}

export function resolveCatalogEnabledModuleIds(
  filter: ModuleCatalogRuntimeFilter | undefined
): Set<string> | null {
  if (!filter) {
    return null;
  }

  const explicit = new Set(filter.enabledModuleIds ?? []);
  const states = filter.moduleStates ?? [];
  for (const state of states) {
    if (!stateAppliesToProduct(state, filter.productId)) {
      continue;
    }
    if (isModuleCatalogStateEnabled(state, filter.includeMaintenance)) {
      explicit.add(state.moduleId);
    }
  }

  return explicit;
}

export function filterModuleMapArtifactByCatalog(
  artifact: ModuleMapArtifact,
  filter: ModuleCatalogRuntimeFilter | undefined
): ModuleMapArtifact {
  const enabled = resolveCatalogEnabledModuleIds(filter);
  if (!enabled) {
    return artifact;
  }

  return {
    ...artifact,
    modules: Object.fromEntries(
      Object.entries(artifact.modules).filter(([moduleId]) => enabled.has(moduleId))
    ),
  };
}

export function filterModuleContractsByCatalog(
  contracts: readonly ModuleRuntimeContract[],
  filter: ModuleCatalogRuntimeFilter | undefined
): ModuleRuntimeContract[] {
  const enabled = resolveCatalogEnabledModuleIds(filter);
  if (!enabled) {
    return [...contracts];
  }

  return contracts.filter((contract) => enabled.has(contract.id));
}

export function createCatalogStateLookup(
  states: readonly ModuleCatalogModuleState[],
  productId?: string
): Map<string, ModuleCatalogModuleState> {
  const lookup = new Map<string, ModuleCatalogModuleState>();
  for (const state of states) {
    if (!stateAppliesToProduct(state, productId)) {
      continue;
    }
    lookup.set(moduleStateKey(productId, state.moduleId), state);
    lookup.set(moduleStateKey(undefined, state.moduleId), state);
  }
  return lookup;
}

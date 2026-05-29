import type { ModuleDataApi, ModuleUser } from '@ploykit/module-sdk';
import { createModuleActionRegistry, type ModuleActionRegistry } from '../actions';
import {
  filterModuleContractsByCatalog,
  filterModuleMapArtifactByCatalog,
  type ModuleCatalogRuntimeFilter,
} from '../catalog';
import type { ModuleRuntimeContract } from '../contract';
import {
  loadModuleRuntimeContracts,
  type ModuleMapArtifact,
  type ModuleRuntimeMapEntry,
} from '../loader';
import { ModuleRuntimeRegistry } from '../registry/module-runtime-registry';
import { createModuleRouteManifest, type ModuleRuntimeRouteEntry } from '../routes';
import { createModuleSurfaceRegistry, type ModuleSurfaceRegistry } from '../surfaces';
import type { ModuleRuntimeAccessSession } from '../security';

export interface ModuleRuntimeHost {
  artifact: ModuleMapArtifact;
  contracts: readonly ModuleRuntimeContract[];
  registry: ModuleRuntimeRegistry;
  routes: readonly ModuleRuntimeRouteEntry[];
  actions: ModuleActionRegistry;
  surfaces: ModuleSurfaceRegistry;
  createDataApi?: ModuleRuntimeDataApiFactory;
  getMapEntry(moduleId: string): ModuleRuntimeMapEntry | null;
  getContract(moduleId: string): ModuleRuntimeContract | null;
}

export interface CreateModuleRuntimeDataApiInput {
  contract: ModuleRuntimeContract;
  request: Request;
  user: ModuleUser | null;
  params: Record<string, string>;
  session?: ModuleRuntimeAccessSession;
}

export type ModuleRuntimeDataApiFactory = (input: CreateModuleRuntimeDataApiInput) => ModuleDataApi;

export interface CreateModuleRuntimeHostOptions {
  contracts?: readonly ModuleRuntimeContract[];
  createDataApi?: ModuleRuntimeDataApiFactory;
  catalog?: ModuleCatalogRuntimeFilter;
}

export async function createModuleRuntimeHost(
  artifact: ModuleMapArtifact,
  options: CreateModuleRuntimeHostOptions = {}
): Promise<ModuleRuntimeHost> {
  const runtimeArtifact = filterModuleMapArtifactByCatalog(artifact, options.catalog);
  const loadedContracts = options.contracts ?? (await loadModuleRuntimeContracts(runtimeArtifact));
  const contracts = filterModuleContractsByCatalog(loadedContracts, options.catalog);
  const registry = new ModuleRuntimeRegistry();

  for (const contract of contracts) {
    registry.registerContract(contract);
  }

  return {
    artifact: runtimeArtifact,
    contracts,
    registry,
    routes: createModuleRouteManifest(contracts),
    actions: createModuleActionRegistry(contracts),
    surfaces: createModuleSurfaceRegistry(contracts),
    createDataApi: options.createDataApi,
    getMapEntry(moduleId) {
      return runtimeArtifact.modules[moduleId] ?? null;
    },
    getContract(moduleId) {
      return registry.get(moduleId);
    },
  };
}

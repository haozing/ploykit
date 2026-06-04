import type { ModuleRuntimeContract } from '../contract';
import type { ModuleMapArtifact } from '../loader';

export interface ModuleBundleManifestModule {
  id: string;
  name?: string;
  version?: string;
  rootDir?: string;
  files: {
    pages: readonly string[];
    apis: readonly string[];
    loaders: readonly string[];
    actions: readonly string[];
    surfaces: readonly string[];
    lifecycle: readonly string[];
    jobs: readonly string[];
    events: readonly string[];
    webhooks: readonly string[];
    assets: readonly string[];
  };
  capabilities?: {
    routes: number;
    actions: number;
    jobs: number;
    events: number;
    webhooks: number;
    data: number;
  };
}

export interface ModuleBundleManifest {
  version: 1;
  generatedAt: string;
  modules: readonly ModuleBundleManifestModule[];
}

export interface CreateModuleBundleManifestInput {
  artifact: ModuleMapArtifact;
  contracts?: readonly ModuleRuntimeContract[];
  enabledModules?: readonly string[];
  now?: () => Date;
}

function keys(value: Record<string, unknown> | undefined): string[] {
  return Object.keys(value ?? {}).sort();
}

function contractCapabilities(contract: ModuleRuntimeContract) {
  return {
    routes:
      contract.routes.site.length +
      contract.routes.dashboard.length +
      contract.routes.admin.length +
      contract.routes.api.length,
    actions: Object.keys(contract.actions).length,
    jobs: Object.keys(contract.jobs).length,
    events: contract.events.publishes.length + Object.keys(contract.events.subscribes).length,
    webhooks: Object.keys(contract.webhooks).length,
    data:
      Object.keys(contract.definition.data?.documents ?? {}).length +
      Object.keys(contract.definition.data?.tables ?? {}).length,
  };
}

export function createModuleBundleManifest(
  input: CreateModuleBundleManifestInput
): ModuleBundleManifest {
  const enabled = input.enabledModules ? new Set(input.enabledModules) : null;
  const contracts = new Map((input.contracts ?? []).map((contract) => [contract.id, contract]));
  const modules = Object.entries(input.artifact.modules)
    .filter(([moduleId]) => !enabled || enabled.has(moduleId))
    .map(([moduleId, entry]) => {
      const contract = contracts.get(moduleId) ?? entry.runtimeContract;
      return {
        id: moduleId,
        name: contract?.name,
        version: contract?.version,
        rootDir: entry.rootDir,
        files: {
          pages: keys(entry.pages),
          apis: keys(entry.apis),
          loaders: keys(entry.loaders),
          actions: keys(entry.actions),
          surfaces: keys(entry.surfaces),
          lifecycle: keys(entry.lifecycle),
          jobs: keys(entry.jobs),
          events: keys(entry.events),
          webhooks: keys(entry.webhooks),
          assets: [...(entry.assets ?? [])].sort(),
        },
        capabilities: contract ? contractCapabilities(contract) : undefined,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    version: 1,
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    modules,
  };
}

import type { ModuleDiagnostic } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleMapArtifact } from '../loader';

export interface ModuleDevConsoleCapabilitySummary {
  routes: number;
  actions: number;
  jobs: number;
  events: {
    publishes: number;
    subscribes: number;
  };
  webhooks: number;
  surfaces: number;
  data: {
    documents: number;
    tables: number;
  };
  resources: {
    locales: number;
    assets: number;
  };
  lifecycle: number;
}

export interface ModuleDevConsoleModule {
  id: string;
  name?: string;
  version?: string;
  rootDir?: string;
  map: {
    pages: number;
    apis: number;
    loaders: number;
    actions: number;
    surfaces: number;
    lifecycle: number;
    jobs: number;
    events: number;
    webhooks: number;
    assets: number;
  };
  capabilities?: ModuleDevConsoleCapabilitySummary;
  diagnostics: readonly ModuleDiagnostic[];
  status: 'ready' | 'warning' | 'error' | 'unloaded';
}

export interface ModuleDevConsoleSnapshot {
  generatedAt: string;
  moduleCount: number;
  modules: readonly ModuleDevConsoleModule[];
}

export interface CreateModuleDevConsoleSnapshotInput {
  artifact: ModuleMapArtifact;
  contracts?: readonly ModuleRuntimeContract[];
  diagnosticsByModule?: Record<string, readonly ModuleDiagnostic[]>;
  now?: () => Date;
}

function countRecord(value: Record<string, unknown> | undefined): number {
  return Object.keys(value ?? {}).length;
}

function countArray(value: readonly unknown[] | undefined): number {
  return value?.length ?? 0;
}

function summarizeContract(contract: ModuleRuntimeContract): ModuleDevConsoleCapabilitySummary {
  return {
    routes:
      countArray(contract.routes.site) +
      countArray(contract.routes.dashboard) +
      countArray(contract.routes.admin) +
      countArray(contract.routes.api),
    actions: countRecord(contract.actions),
    jobs: countRecord(contract.jobs),
    events: {
      publishes: countArray(contract.events.publishes),
      subscribes: countRecord(contract.events.subscribes),
    },
    webhooks: countRecord(contract.webhooks),
    surfaces: countRecord(contract.surfaces),
    data: {
      documents: countRecord(contract.definition.data?.documents),
      tables: countRecord(contract.definition.data?.tables),
    },
    resources: {
      locales: countRecord(contract.resources.locales),
      assets: countArray(contract.resources.assets),
    },
    lifecycle: Object.values(contract.lifecycle).filter(Boolean).length,
  };
}

function statusFor(diagnostics: readonly ModuleDiagnostic[], contract?: ModuleRuntimeContract) {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return 'error' as const;
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'warning')) {
    return 'warning' as const;
  }
  return contract ? ('ready' as const) : ('unloaded' as const);
}

export function createModuleDevConsoleSnapshot(
  input: CreateModuleDevConsoleSnapshotInput
): ModuleDevConsoleSnapshot {
  const contracts = new Map((input.contracts ?? []).map((contract) => [contract.id, contract]));
  const modules = Object.entries(input.artifact.modules)
    .map(([moduleId, entry]) => {
      const contract = contracts.get(moduleId) ?? entry.runtimeContract;
      const diagnostics = input.diagnosticsByModule?.[moduleId] ?? [];
      return {
        id: moduleId,
        name: contract?.name,
        version: contract?.version,
        rootDir: entry.rootDir,
        map: {
          pages: countRecord(entry.pages),
          apis: countRecord(entry.apis),
          loaders: countRecord(entry.loaders),
          actions: countRecord(entry.actions),
          surfaces: countRecord(entry.surfaces),
          lifecycle: countRecord(entry.lifecycle),
          jobs: countRecord(entry.jobs),
          events: countRecord(entry.events),
          webhooks: countRecord(entry.webhooks),
          assets: countArray(entry.assets),
        },
        capabilities: contract ? summarizeContract(contract) : undefined,
        diagnostics,
        status: statusFor(diagnostics, contract),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    moduleCount: modules.length,
    modules,
  };
}

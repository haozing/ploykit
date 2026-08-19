import { validateModuleDefinition } from '@ploykit/module-sdk';
import {
  createAdminOperationsCenter,
  type AdminOperationsSnapshot,
} from '@host/lib/admin/operations-center';
import {
  diagnoseModuleCatalog,
  type ModuleCatalogModuleStatus,
} from '@/lib/module-runtime/catalog';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import {
  presentModuleDiagnostics,
  type PresentedModuleDiagnostics,
} from '@/lib/module-runtime/dev-console/diagnostics-presenter';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import {
  createModuleRuntimeHostSnapshot,
  type ModuleRuntimeHostSnapshot,
} from '@/lib/module-runtime/host/runtime-host-snapshot';
import { loadModuleRuntimeContracts } from '@/lib/module-runtime/loader/load-module-contracts';
import type { ModuleMapHealthReport } from '@/lib/module-runtime/loader/module-map-health';
import type { ModuleMapReleaseMetadata } from '@/lib/module-runtime/loader/module-map-types';
import { createModuleRouteManifest } from '@/lib/module-runtime/routes/route-manifest';
import type { ModuleRunRecord } from '@/lib/module-runtime/runs/run-runtime';
import type {
  RuntimeStoreFileRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreUsageRecord,
  RuntimeStoreWebhookReceipt,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';
import { getHostRuntime, invalidateHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from './default-scope';
import type { HostRuntimeStoreStatus } from './runtime-store';
import { ensureAdminStoreSeeded } from './admin-store-seed';
import {
  buildAdminModuleRows,
  moduleDiagnostics,
  moduleRiskSummary,
  type AdminModuleCapabilitySummary,
  type AdminModuleOperationsRow,
  type AdminModuleProductSummary,
  type AdminModuleRiskSummary,
  type AdminModuleRuntimeState,
} from './admin-module-operation-model';
export type {
  AdminModuleCapabilitySummary,
  AdminModuleOperationsRow,
  AdminModuleProductSummary,
  AdminModuleRiskSummary,
  AdminModuleRuntimeState,
} from './admin-module-operation-model';

const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

export interface AdminOperationsView {
  snapshot: AdminOperationsViewSnapshot;
  store: HostRuntimeStoreStatus;
}

export interface AdminOperationsViewSnapshot extends Omit<AdminOperationsSnapshot, 'modules'> {
  modules: AdminModuleOperationsRow[];
  records: {
    runs: ModuleRunRecord[];
  };
  moduleMapHealth: ModuleMapHealthReport;
  hostSnapshot: ModuleRuntimeHostSnapshot;
}

export interface AdminModuleDetailView {
  module: AdminModuleOperationsRow | null;
  routes: AdminOperationsSnapshot['routes'];
  catalogState: AdminOperationsSnapshot['recent']['catalogStates'][number] | null;
  diagnostics: ReturnType<typeof diagnoseModuleCatalog>;
  presentedDiagnostics: PresentedModuleDiagnostics;
  contract: {
    rootDir?: string;
    navigation: readonly { location: string; label: string; path: string }[];
    actions: readonly { name: string; handler: string; auth: string; timeoutMs?: number }[];
    jobs: readonly { name: string; handler: string; schedule?: string; retries?: number }[];
    events: {
      publishes: readonly string[];
      subscribes: readonly { name: string; handler: string }[];
    };
    webhooks: readonly {
      name: string;
      path: string;
      handler: string;
      methods: readonly string[];
      signature: string;
    }[];
    surfaces: readonly { id: string; mode: string; component: string }[];
    data: {
      tables: readonly string[];
      documents: readonly string[];
      views: readonly string[];
      grants: readonly string[];
      checks: readonly string[];
      migrationMode?: string;
    };
    resources: {
      locales: readonly string[];
      assets: readonly string[];
    };
    requirements: readonly {
      kind: 'service' | 'resource';
      name: string;
      required: boolean;
      provider?: string;
      description?: string;
    }[];
    meters: readonly { name: string; unit?: string; description?: string }[];
    config: readonly { name: string; type: string; required: boolean; secret: boolean }[];
    lifecycle: readonly { hook: string; handler: string }[];
    egress: readonly string[];
    dependencies: readonly string[];
    parts: readonly { name: string; path: string }[];
    capabilitySummary: ModuleRuntimeContract['capabilitySummary'];
    risk: AdminModuleRiskSummary;
    release?: ModuleMapReleaseMetadata;
  } | null;
  recent: {
    runs: ModuleRunRecord[];
    outbox: RuntimeStoreOutboxRecord[];
    webhookReceipts: RuntimeStoreWebhookReceipt[];
    usageRecords: RuntimeStoreUsageRecord[];
    files: RuntimeStoreFileRecord[];
  };
}

export async function getAdminOperationsView(): Promise<AdminOperationsView> {
  const hostRuntime = await getHostRuntime();
  const allContracts = await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT);
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    allContracts.map((contract) => contract.id)
  );
  const admin = createAdminOperationsCenter({
    host: hostRuntime.moduleHost.runtime,
    store: hostRuntime.runtimeStore.store,
  });
  const [
    snapshot,
    catalogStates,
    runs,
    outbox,
    webhookReceipts,
    usageRecords,
    files,
    serviceConnections,
    resourceBindings,
  ] = await Promise.all([
    admin.snapshot({
      productId: DEMO_PRODUCT_ID,
    }),
    hostRuntime.runtimeStore.store.listCatalogStates({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listRuns({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listOutbox({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listWebhookReceipts({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listUsage({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listFiles({ productId: DEMO_PRODUCT_ID, includeDeleted: true }),
    hostRuntime.runtimeStore.store.listServiceConnections({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listResourceBindings({ productId: DEMO_PRODUCT_ID }),
  ]);
  const diagnostics = diagnoseModuleCatalog({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: allContracts,
    moduleStates: catalogStates,
  });
  const { checkModuleMapHealth } = await import('@/lib/module-runtime/loader/module-map-health');
  const moduleMapHealth = checkModuleMapHealth({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: allContracts,
  });
  const hostSnapshot = createModuleRuntimeHostSnapshot(hostRuntime.moduleHost.runtime, {
    productScope: {
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      profile: 'default',
    },
  });
  const routes = createModuleRouteManifest(allContracts).map((route) => ({
    moduleId: route.moduleId,
    kind: route.kind,
    path: route.path,
    auth: route.auth,
  }));

  return {
    snapshot: {
      ...snapshot,
      modules: buildAdminModuleRows({
        contracts: allContracts,
        catalogStates,
        diagnostics,
        runs,
        outbox,
        receipts: webhookReceipts,
        usageRecords,
        files,
        serviceConnections,
        resourceBindings,
      }),
      routes,
      counts: {
        ...snapshot.counts,
        modules: allContracts.length,
        routes: routes.length,
        catalogStates: catalogStates.length,
      },
      recent: {
        ...snapshot.recent,
        catalogStates: catalogStates.slice(0, 10),
      },
      records: {
        runs: [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      },
      moduleMapHealth,
      hostSnapshot,
    },
    store: hostRuntime.runtimeStore.status,
  };
}

export async function getAdminOperationsSnapshot(): Promise<AdminOperationsSnapshot> {
  return (await getAdminOperationsView()).snapshot;
}

async function getAdminOperationsCenter() {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );

  return createAdminOperationsCenter({
    host: hostRuntime.moduleHost.runtime,
    store: hostRuntime.runtimeStore.store,
  });
}

export async function setAdminModuleStatus(
  session: ModuleHostSession,
  moduleId: string,
  status: ModuleCatalogModuleStatus,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  const result = await admin.setModuleStatus(session, DEMO_PRODUCT_ID, moduleId, status, reason);
  invalidateHostRuntime();
  return result;
}

export async function getAdminModuleDetail(moduleId: string): Promise<AdminModuleDetailView> {
  const hostRuntime = await getHostRuntime();
  const allContracts = await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT);
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    allContracts.map((contract) => contract.id)
  );
  const [
    catalogStates,
    runs,
    outbox,
    webhookReceipts,
    usageRecords,
    files,
    serviceConnections,
    resourceBindings,
  ] = await Promise.all([
    hostRuntime.runtimeStore.store.listCatalogStates({
      productId: DEMO_PRODUCT_ID,
    }),
    hostRuntime.runtimeStore.store.listRuns({ productId: DEMO_PRODUCT_ID, moduleId }),
    hostRuntime.runtimeStore.store.listOutbox({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listWebhookReceipts({
      productId: DEMO_PRODUCT_ID,
      moduleId,
    }),
    hostRuntime.runtimeStore.store.listUsage({ productId: DEMO_PRODUCT_ID, moduleId }),
    hostRuntime.runtimeStore.store.listFiles({
      productId: DEMO_PRODUCT_ID,
      moduleId,
      includeDeleted: true,
    }),
    hostRuntime.runtimeStore.store.listServiceConnections({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listResourceBindings({ productId: DEMO_PRODUCT_ID }),
  ]);
  const contract = allContracts.find((item) => item.id === moduleId);
  const allDiagnostics = diagnoseModuleCatalog({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: allContracts,
    moduleStates: catalogStates,
  });
  const diagnostics = contract
    ? [
        ...validateModuleDefinition(contract.definition),
        ...moduleDiagnostics(allDiagnostics, contract.id),
      ]
    : moduleDiagnostics(allDiagnostics, moduleId);
  const catalogState = catalogStates.find((state) => state.moduleId === moduleId) ?? null;
  const moduleRows = contract
    ? buildAdminModuleRows({
        contracts: [contract],
        catalogStates,
        diagnostics: allDiagnostics,
        runs,
        outbox,
        receipts: webhookReceipts,
        usageRecords,
        files,
        serviceConnections,
        resourceBindings,
      })
    : [];
  const entry = MODULE_MAP_ARTIFACT.modules[moduleId];
  const routes = contract
    ? createModuleRouteManifest([contract]).map((route) => ({
        moduleId: route.moduleId,
        kind: route.kind,
        path: route.path,
        auth: route.auth,
      }))
    : [];

  return {
    module: moduleRows[0] ?? null,
    routes,
    catalogState,
    diagnostics,
    presentedDiagnostics: presentModuleDiagnostics({ moduleId, diagnostics }),
    contract: contract
      ? {
          rootDir: entry?.rootDir,
          navigation: contract.navigation.map((item) => ({
            location: item.location,
            label: item.labelKey ?? item.path,
            path: item.path,
          })),
          actions: Object.entries(contract.actions).map(([name, definition]) => ({
            name,
            handler: definition.handler,
            auth: definition.auth ?? 'auth',
            timeoutMs: definition.timeoutMs,
          })),
          jobs: Object.entries(contract.jobs).map(([name, definition]) => ({
            name,
            handler: definition.handler,
            schedule: definition.schedule,
            retries: definition.retries,
          })),
          events: {
            publishes: contract.events.publishes,
            subscribes: Object.entries(contract.events.subscribes).map(([name, handler]) => ({
              name,
              handler,
            })),
          },
          webhooks: Object.entries(contract.webhooks).map(([name, definition]) => ({
            name,
            path: definition.path,
            handler: definition.handler,
            methods: definition.methods ?? ['POST'],
            signature: definition.signature ?? 'none',
          })),
          surfaces: Object.entries(contract.surfaces).map(([id, definition]) => ({
            id,
            mode: definition.mode ?? 'append',
            component: definition.component,
          })),
          data: {
            tables: Object.keys(contract.definition.data?.tables ?? {}),
            documents: Object.keys(contract.definition.data?.documents ?? {}),
            views: Object.keys(contract.definition.data?.views ?? {}),
            grants: Object.keys(contract.definition.data?.grants ?? {}),
            checks: Object.keys(contract.definition.data?.checks ?? {}),
            migrationMode: contract.definition.data?.migrations?.mode,
          },
          resources: {
            locales: Object.keys(contract.assets.locales ?? {}),
            assets: (contract.assets.assets ?? []).map((asset) => asset.path),
          },
          requirements: [
            ...Object.entries(contract.serviceRequirements).map(([name, definition]) => ({
              kind: 'service' as const,
              name,
              required: Boolean(definition.required),
              provider: definition.provider,
              description: definition.description,
            })),
            ...Object.entries(contract.resourceBindings).map(([name, definition]) => ({
              kind: 'resource' as const,
              name,
              required: Boolean(definition.required),
              description: definition.description,
            })),
          ],
          meters: Object.entries(contract.meters).map(([name, definition]) => ({
            name,
            unit: definition.unit,
            description: definition.description,
          })),
          config: Object.entries(contract.config).map(([name, definition]) => ({
            name,
            type: definition.type,
            required: Boolean(definition.required),
            secret: Boolean(definition.secret),
          })),
          lifecycle: Object.entries(contract.lifecycle)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([hook, handler]) => ({ hook, handler })),
          egress: contract.egress,
          dependencies: Array.isArray(contract.dependencies.npm)
            ? contract.dependencies.npm
            : Object.entries(contract.dependencies.npm ?? {}).map(
                ([name, version]) => `${name}@${version}`
              ),
          parts: Object.entries(contract.parts ?? {})
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([name, partPath]) => ({ name, path: partPath })),
          capabilitySummary: contract.capabilitySummary,
          risk: moduleRiskSummary(contract),
          release: entry?.release,
        }
      : null,
    recent: {
      runs: runs.slice(0, 10),
      outbox: outbox.filter((record) => record.moduleId === moduleId).slice(0, 10),
      webhookReceipts: webhookReceipts.slice(0, 10),
      usageRecords: usageRecords.slice(0, 10),
      files: files.slice(0, 10),
    },
  };
}

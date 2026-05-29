import fs from 'node:fs';
import path from 'node:path';
import {
  PermissionRegistry,
  SystemOnlyPermissions,
  validateModuleDefinition,
  type ModuleArtifactRecord,
  type ModuleDiagnostic,
  type ModuleServiceOperationDefinition,
} from '@ploykit/module-sdk';
import {
  countMissingRequiredModuleRequirements,
  createAdminOperationsCenter,
  type AdminOperationsSnapshot,
} from '@/lib/module-runtime/admin/admin-operations';
import {
  diagnoseModuleCatalog,
  type ModuleCatalogModuleState,
  type ModuleCatalogModuleStatus,
} from '@/lib/module-runtime/catalog';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import {
  createDeveloperPlatformReport,
  type DeveloperPlatformReport,
} from '@/lib/module-runtime/dev-console/developer-platform';
import {
  createModuleDevConsoleSnapshot,
  type ModuleDevConsoleSnapshot,
} from '@/lib/module-runtime/dev-console/dev-console';
import {
  presentModuleDiagnostics,
  type PresentedModuleDiagnostics,
} from '@/lib/module-runtime/dev-console/diagnostics-presenter';
import type { ModuleFileStorageHead } from '@/lib/module-capabilities/files/storage-adapter';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import {
  createModuleRuntimeHostSnapshot,
  type ModuleRuntimeHostSnapshot,
} from '@/lib/module-runtime/host/runtime-host-snapshot';
import { loadModuleRuntimeContracts } from '@/lib/module-runtime/loader/load-module-contracts';
import {
  checkModuleMapHealth,
  type ModuleMapHealthReport,
} from '@/lib/module-runtime/loader/module-map-health';
import type { ModuleMapArtifact, ModuleMapReleaseMetadata } from '@/lib/module-runtime/loader/module-map-types';
import {
  createModuleBundleManifest,
  type ModuleBundleManifest,
} from '@/lib/module-runtime/packaging/module-bundle';
import { createModuleRouteManifest } from '@/lib/module-runtime/routes/route-manifest';
import type { ModuleRunRecord } from '@/lib/module-runtime/runs/run-runtime';
import { createServiceInvocationRuntime } from '@/lib/module-capabilities/services';
import type {
  RuntimeStore,
  RuntimeStoreAuditRecord,
  RuntimeStoreApiKeyRecord,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
  RuntimeStoreFileRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreRiskBlock,
  RuntimeStoreRiskEvent,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreUsageRecord,
  RuntimeStoreWebhookReceipt,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';
import { getHostRuntime, invalidateHostRuntime } from './create-host';
import {
  getDefaultModuleCatalogSeed,
  getDefaultRequiredModuleId,
} from './default-module-catalog';
import {
  getHostFileRuntime,
  getHostFileStorage,
  getHostFileStorageStatus,
  type HostFileStorageStatus,
} from './files';
import {
  getHostCommercialRuntime,
  loadHostBillingCatalog,
  type HostBillingCatalog,
} from './commercial-provider';
import { normalizeRuntimeStoreEntitlementGrant } from '@/lib/module-capabilities/commercial/commercial-ledger';
import { runHostConfigDoctor, type HostProviderReadiness } from './config-doctor';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from './default-scope';
import {
  HOST_SETTINGS_SCHEMA,
  readHostSettingsView,
  writeHostSettings,
  type HostRuntimeSettings,
  type HostSettingKey,
  type HostSettingRisk,
  type HostSettingValueSource,
} from './host-settings';
import { isSupportedLanguage } from './i18n';
import type { HostRuntimeStoreStatus } from './runtime-store';
import { listHostWorkerArtifactsForRun } from './worker';

const seedPromises = new WeakMap<RuntimeStore, Promise<void>>();
const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

function countRecord(value: Record<string, unknown> | undefined): number {
  return Object.keys(value ?? {}).length;
}

function countArray(value: readonly unknown[] | undefined): number {
  return value?.length ?? 0;
}

function lifecycleCount(contract: ModuleRuntimeContract): number {
  return Object.values(contract.lifecycle).filter(Boolean).length;
}

function moduleRouteCount(contract: ModuleRuntimeContract): number {
  return (
    countArray(contract.routes.site) +
    countArray(contract.routes.dashboard) +
    countArray(contract.routes.admin) +
    countArray(contract.routes.api)
  );
}

function moduleCapabilitySummary(contract: ModuleRuntimeContract): AdminModuleCapabilitySummary {
  return {
    routes: moduleRouteCount(contract),
    siteRoutes: countArray(contract.routes.site),
    dashboardRoutes: countArray(contract.routes.dashboard),
    adminRoutes: countArray(contract.routes.admin),
    apiRoutes: countArray(contract.routes.api),
    actions: countRecord(contract.actions),
    jobs: countRecord(contract.jobs),
    events:
      countArray(contract.events.publishes) +
      countRecord(contract.events.subscribes as Record<string, unknown>),
    webhooks: countRecord(contract.webhooks),
    surfaces: countRecord(contract.surfaces),
    dataTables: countRecord(contract.definition.data?.tables),
    dataDocuments: countRecord(contract.definition.data?.documents),
    meters: countRecord(contract.meters),
    config: countRecord(contract.config),
    serviceRequirements: countRecord(contract.serviceRequirements),
    resourceBindings: countRecord(contract.resourceBindings),
    lifecycle: lifecycleCount(contract),
  };
}

function routeCountForShell(contract: ModuleRuntimeContract, shell: 'site' | 'dashboard' | 'admin') {
  return contract.routes[shell].length;
}

function hasNavigationForShell(
  contract: ModuleRuntimeContract,
  shell: 'site' | 'dashboard' | 'admin'
) {
  const locations =
    shell === 'site'
      ? ['site.header', 'site.footer']
      : shell === 'dashboard'
        ? ['dashboard.sidebar']
        : ['admin.sidebar'];
  return contract.navigation.some((item) => locations.includes(item.location));
}

function moduleProductSummary(contract: ModuleRuntimeContract): AdminModuleProductSummary | null {
  const product = contract.definition.product;
  if (!product) {
    return null;
  }
  const requiredShells = [...(product.requiredShells ?? [])];
  return {
    kind: product.kind,
    audiences: [...(product.audiences ?? [])],
    requiredShells,
    pages: (product.pages ?? []).map((page) => ({
      shell: page.shell,
      path: page.path,
      title: page.title,
      audience: page.audience,
      userQuestion: page.userQuestion,
      primaryActions: [...page.primaryActions],
      required: page.required !== false,
    })),
    pageCounts: {
      site: (product.pages ?? []).filter((page) => page.shell === 'site').length,
      dashboard: (product.pages ?? []).filter((page) => page.shell === 'dashboard').length,
      admin: (product.pages ?? []).filter((page) => page.shell === 'admin').length,
    },
    missingShells: requiredShells.filter((shell) => routeCountForShell(contract, shell) === 0),
    missingNavigationShells: requiredShells.filter((shell) => !hasNavigationForShell(contract, shell)),
  };
}

function moduleRiskSummary(contract: ModuleRuntimeContract): AdminModuleRiskSummary {
  const highRiskPermissions = contract.capabilitySummary.permissions
    .filter((permission) => permission.risk === 'high' || permission.risk === 'critical')
    .map((permission) => ({
      value: permission.value,
      risk: permission.risk,
      group: permission.group,
      scope: permission.scope,
      ctxCapability: permission.ctxCapability,
    }));
  const systemPermissions = contract.permissions
    .filter((permission) => SystemOnlyPermissions.has(permission))
    .map(String);
  const publicApis = contract.routes.api
    .filter((route) => (route.auth ?? 'auth') === 'public')
    .map((route) => ({
      path: route.path,
      methods: route.methods ?? ['GET'],
      anonymousPolicy: Boolean(route.anonymousPolicy),
    }));
  const webhooks = Object.entries(contract.webhooks).map(([name, definition]) => ({
    name,
    path: definition.path,
    signature: definition.signature ?? 'none',
  }));
  const presentationOverrides = [
    ...Object.entries(contract.surfaces)
      .filter(([, definition]) => definition.mode === 'replace')
      .map(([id]) => `surface:${id}`),
    ...contract.capabilitySummary.presentationContribution.replaces.map((id) => `page:${id}`),
    ...contract.permissions
      .filter((permission) => PermissionRegistry[permission]?.group === 'presentation')
      .filter((permission) => PermissionRegistry[permission]?.risk === 'high' || PermissionRegistry[permission]?.risk === 'critical')
      .map(String),
  ];
  const secretConfig = Object.entries(contract.config)
    .filter(([, definition]) => definition.secret)
    .map(([name, definition]) => `${name}${definition.required ? ':required' : ':optional'}`);
  const requiredRequirements = [
    ...Object.entries(contract.serviceRequirements)
      .filter(([, definition]) => definition.required)
      .map(([name, definition]) => `service:${name}${definition.provider ? `:${definition.provider}` : ''}`),
    ...Object.entries(contract.resourceBindings)
      .filter(([, definition]) => definition.required)
      .map(([name, definition]) => `resource:${name}:${definition.kind}`),
  ];
  const dataWriteSurfaces = highRiskPermissions
    .filter((permission) => permission.group === 'data')
    .map((permission) => permission.value);
  const score =
    highRiskPermissions.length * 2 +
    systemPermissions.length * 4 +
    publicApis.length +
    webhooks.length * 2 +
    contract.egress.length * 2 +
    presentationOverrides.length * 2 +
    secretConfig.filter((item) => item.endsWith(':required')).length * 2 +
    requiredRequirements.length;

  return {
    highRiskPermissions,
    systemPermissions,
    externalEgress: contract.egress,
    publicApis,
    webhooks,
    presentationOverrides: [...new Set(presentationOverrides)],
    secretConfig,
    requiredRequirements,
    dataWriteSurfaces,
    score,
  };
}

function lastTimestamp(values: readonly (string | undefined | null)[]): string | null {
  const sorted = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left));
  return sorted[0] ?? null;
}

function moduleDiagnostics(
  diagnostics: readonly ModuleDiagnostic[],
  moduleId: string
): ModuleDiagnostic[] {
  return diagnostics.filter(
    (item) => (item.path ?? '').includes(moduleId) || item.message.includes(moduleId)
  );
}

function runtimeStateForModule(input: {
  state: ModuleCatalogModuleState | null;
  diagnostics: readonly ModuleDiagnostic[];
  requiredGaps: number;
}): AdminModuleRuntimeState {
  if (!input.state) {
    return 'not_installed';
  }
  if (input.diagnostics.some((item) => item.severity === 'error')) {
    return 'error';
  }
  if (input.state.status === 'enabled' && input.requiredGaps > 0) {
    return 'blocked';
  }
  return input.state.status;
}

function buildAdminModuleRows(input: {
  contracts: readonly ModuleRuntimeContract[];
  catalogStates: readonly ModuleCatalogModuleState[];
  diagnostics: readonly ModuleDiagnostic[];
  runs: readonly ModuleRunRecord[];
  outbox: readonly RuntimeStoreOutboxRecord[];
  receipts: readonly RuntimeStoreWebhookReceipt[];
  usageRecords: readonly RuntimeStoreUsageRecord[];
  files: readonly RuntimeStoreFileRecord[];
  serviceConnections: readonly RuntimeStoreServiceConnectionRecord[];
  resourceBindings: readonly RuntimeStoreResourceBindingRecord[];
}): AdminModuleOperationsRow[] {
  const stateByModule = new Map(input.catalogStates.map((state) => [state.moduleId, state]));
  return input.contracts
    .map((contract) => {
      const state = stateByModule.get(contract.id) ?? null;
      const diagnostics = [
        ...validateModuleDefinition(contract.definition),
        ...moduleDiagnostics(input.diagnostics, contract.id),
      ];
      const requiredGaps = countMissingRequiredModuleRequirements({
        contract,
        serviceConnections: input.serviceConnections,
        resourceBindings: input.resourceBindings,
      });
      const runs = input.runs.filter((record) => record.moduleId === contract.id);
      const outbox = input.outbox.filter((record) => record.moduleId === contract.id);
      const receipts = input.receipts.filter((record) => record.moduleId === contract.id);
      const usageRecords = input.usageRecords.filter((record) => record.moduleId === contract.id);
      const files = input.files.filter((record) => record.moduleId === contract.id);
      const failedRuns = runs.filter((record) =>
        ['failed', 'cancel_requested', 'canceled'].includes(record.status)
      ).length;
      const failedOutbox = outbox.filter((record) =>
        ['failed', 'dead_letter'].includes(record.status)
      ).length;
      const failedReceipts = receipts.filter((record) =>
        ['failed', 'rejected'].includes(record.status)
      ).length;
      const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
      const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
      const runtimeState = runtimeStateForModule({ state, diagnostics, requiredGaps });
      const status: AdminModuleOperationsRow['status'] = state?.status ?? 'not_installed';
      const health: AdminModuleOperationsRow['health']['status'] =
        runtimeState === 'error'
          ? 'error'
          : runtimeState === 'blocked'
            ? 'blocked'
            : failedRuns + failedOutbox + failedReceipts > 0
              ? 'degraded'
              : runtimeState === 'enabled'
                ? 'ready'
              : runtimeState;
      const lastFailureAt = lastTimestamp([
        ...runs.filter((record) => record.error).map((record) => record.updatedAt),
        ...outbox.filter((record) => record.error).map((record) => record.updatedAt),
        ...receipts.filter((record) => record.error).map((record) => record.updatedAt),
      ]);
      const mapEntry = MODULE_MAP_ARTIFACT.modules[contract.id];
      const release = mapEntry?.release;
      return {
        id: contract.id,
        name: contract.name,
        version: contract.version,
        description: contract.description,
        permissions: contract.permissions.map(String),
        status,
        installed: Boolean(state),
        required: Boolean(state?.required),
        runtimeState,
        catalogState: state,
        product: moduleProductSummary(contract),
        capabilities: moduleCapabilitySummary(contract),
        activity: {
          runs: runs.length,
          failedRuns,
          outbox: outbox.length,
          failedOutbox,
          webhookReceipts: receipts.length,
          failedWebhookReceipts: failedReceipts,
          usageRecords: usageRecords.length,
          files: files.length,
          lastActivityAt: lastTimestamp([
            ...runs.map((record) => record.updatedAt),
            ...outbox.map((record) => record.updatedAt),
            ...receipts.map((record) => record.updatedAt),
            ...usageRecords.map((record) => record.createdAt),
            ...files.map((record) => record.updatedAt),
          ]),
        },
        health: {
          status: health,
          errors: errorCount,
          warnings: warningCount,
          requiredGaps,
          lastFailureAt,
        },
        contractMeta: {
          rootDir: mapEntry?.rootDir,
          sourceId: mapEntry?.sourceId,
          sourceDir: mapEntry?.sourceDir,
          sourceKind: mapEntry?.sourceKind,
          sourceHash: release?.sourceHash,
          contractDigest: release?.contractDigest,
          buildId: release?.buildId,
          sourceFiles: release?.sourceFiles.length ?? 0,
          capabilitySummary: release?.capabilitySummary ?? null,
        },
        runtimeSummary: contract.capabilitySummary,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function seedAdminCatalog(store: RuntimeStore, moduleIds: readonly string[]) {
  const existingStates = await store.listCatalogStates({ productId: DEMO_PRODUCT_ID });
  const existingModuleIds = new Set(existingStates.map((state) => state.moduleId));
  for (const moduleId of moduleIds) {
    if (existingModuleIds.has(moduleId)) {
      continue;
    }
    await store.upsertCatalogState({
      productId: DEMO_PRODUCT_ID,
      moduleId,
      status: 'enabled',
      ...getDefaultModuleCatalogSeed(moduleId),
    });
  }

  await store.upsertMembership({
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    userId: 'demo-admin',
    role: 'owner',
    status: 'active',
  });
}

async function seedAdminStore(store: RuntimeStore, moduleIds: readonly string[]) {
  await seedAdminCatalog(store, moduleIds);
  const seedModuleId = getDefaultRequiredModuleId(moduleIds) ?? moduleIds[0] ?? '__host__';

  const existingAudit = await store.listAudit({
    productId: DEMO_PRODUCT_ID,
    type: 'admin.snapshot.seeded',
  });
  if (existingAudit.length > 0) {
    return;
  }

  const run = await store.createRun({
    id: 'run_admin_smoke',
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    kind: 'manual',
    name: 'admin-smoke',
    idempotencyKey: 'admin-smoke-run',
  });
  await store.appendRunLog(run.id, 'info', 'Admin operation center bootstrapped.');
  await store.enqueueOutbox({
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    name: 'admin.snapshot.created',
    payload: { ok: true },
    idempotencyKey: 'admin-smoke-outbox',
  });
  await store.createWebhookReceipt({
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    webhookName: 'admin-smoke',
    path: '/admin-smoke-webhook',
    method: 'POST',
    idempotencyKey: 'admin-smoke-webhook',
  });
  await store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    actorId: 'demo-admin',
    type: 'admin.snapshot.seeded',
  });
  await store.recordUsage({
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: seedModuleId,
    meter: 'admin.snapshot',
    idempotencyKey: 'admin-smoke-usage',
  });
  const notification = await store.createNotification({
    productId: DEMO_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    moduleId: '__host__',
    userId: 'demo-admin',
    channel: 'inApp',
    title: 'Admin operations seeded',
    body: 'Delivery log is backed by runtime store.',
    source: 'admin',
    category: 'admin',
    idempotencyKey: 'admin-smoke-notification',
  });
  await store.recordNotificationDelivery({
    notificationId: notification.id,
    productId: notification.productId,
    workspaceId: notification.workspaceId,
    userId: notification.userId,
    channel: notification.channel,
    provider: 'in-app',
    status: notification.deliveryStatus,
    metadata: { seed: true },
  });
}

async function ensureAdminStoreSeeded(
  store: RuntimeStore,
  moduleIds: readonly string[]
): Promise<void> {
  let promise = seedPromises.get(store);
  if (!promise) {
    promise = seedAdminStore(store, moduleIds).catch((error) => {
      seedPromises.delete(store);
      throw error;
    });
    seedPromises.set(store, promise);
  }

  await promise;
}

export interface AdminOperationsView {
  snapshot: AdminOperationsViewSnapshot;
  store: HostRuntimeStoreStatus;
}

export type AdminModuleRuntimeState =
  | ModuleCatalogModuleStatus
  | 'blocked'
  | 'not_installed';

export interface AdminModuleCapabilitySummary {
  routes: number;
  siteRoutes: number;
  dashboardRoutes: number;
  adminRoutes: number;
  apiRoutes: number;
  actions: number;
  jobs: number;
  events: number;
  webhooks: number;
  surfaces: number;
  dataTables: number;
  dataDocuments: number;
  meters: number;
  config: number;
  serviceRequirements: number;
  resourceBindings: number;
  lifecycle: number;
}

export interface AdminModuleRiskSummary {
  highRiskPermissions: readonly {
    value: string;
    risk: string;
    group: string;
    scope: string;
    ctxCapability?: string;
  }[];
  systemPermissions: readonly string[];
  externalEgress: readonly string[];
  publicApis: readonly {
    path: string;
    methods: readonly string[];
    anonymousPolicy: boolean;
  }[];
  webhooks: readonly {
    name: string;
    path: string;
    signature: string;
  }[];
  presentationOverrides: readonly string[];
  secretConfig: readonly string[];
  requiredRequirements: readonly string[];
  dataWriteSurfaces: readonly string[];
  score: number;
}

export interface AdminModuleProductSummary {
  kind: string;
  audiences: readonly string[];
  requiredShells: readonly ('site' | 'dashboard' | 'admin')[];
  pages: readonly {
    shell: 'site' | 'dashboard' | 'admin';
    path: string;
    title?: string;
    audience: string;
    userQuestion: string;
    primaryActions: readonly string[];
    required: boolean;
  }[];
  pageCounts: {
    site: number;
    dashboard: number;
    admin: number;
  };
  missingShells: readonly ('site' | 'dashboard' | 'admin')[];
  missingNavigationShells: readonly ('site' | 'dashboard' | 'admin')[];
}

export interface AdminModuleOperationsRow {
  id: string;
  name: string;
  version: string;
  description?: string;
  permissions: readonly string[];
  status: ModuleCatalogModuleStatus | 'not_installed';
  installed: boolean;
  required: boolean;
  runtimeState: AdminModuleRuntimeState | 'error';
  catalogState: ModuleCatalogModuleState | null;
  product: AdminModuleProductSummary | null;
  capabilities: AdminModuleCapabilitySummary;
  activity: {
    runs: number;
    failedRuns: number;
    outbox: number;
    failedOutbox: number;
    webhookReceipts: number;
    failedWebhookReceipts: number;
    usageRecords: number;
    files: number;
    lastActivityAt: string | null;
  };
  health: {
    status: AdminModuleRuntimeState | 'ready' | 'degraded' | 'error';
    errors: number;
    warnings: number;
    requiredGaps: number;
    lastFailureAt: string | null;
  };
  contractMeta: {
    rootDir?: string;
    sourceId?: string;
    sourceDir?: string;
    sourceKind?: string;
    sourceHash?: string;
    contractDigest?: string;
    buildId?: string;
    sourceFiles: number;
    capabilitySummary: ModuleMapReleaseMetadata['capabilitySummary'] | null;
  };
  runtimeSummary: ModuleRuntimeContract['capabilitySummary'];
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
  contract:
    | {
        rootDir?: string;
        sourceId?: string;
        sourceDir?: string;
        sourceKind?: string;
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
      }
    | null;
  recent: {
    runs: ModuleRunRecord[];
    outbox: RuntimeStoreOutboxRecord[];
    webhookReceipts: RuntimeStoreWebhookReceipt[];
    usageRecords: RuntimeStoreUsageRecord[];
    files: RuntimeStoreFileRecord[];
  };
}

export interface AdminModuleTestReport {
  moduleId: string;
  moduleRoot: string;
  success: boolean;
  mode: string;
  checkedAt: string;
  reportFile: string;
  steps: {
    name: string;
    ok: boolean;
    command: string;
    files?: string[];
  }[];
}

export interface AdminModuleDevEnvironmentView {
  currentEnvironment: string;
  nodeEnvironment: string;
  targetEnvironment: string;
  moduleMapKind: ModuleMapArtifact['kind'];
  moduleMapGeneratedAt: string | null;
  moduleMapBuildId: string | null;
}

export interface AdminModuleDevConsoleView {
  snapshot: ModuleDevConsoleSnapshot;
  report: DeveloperPlatformReport;
  bundle: ModuleBundleManifest;
  environment: AdminModuleDevEnvironmentView;
  diagnosticsByModule: Record<string, readonly ModuleDiagnostic[]>;
  testReports: AdminModuleTestReport[];
}

export interface AdminRunDetailView {
  run: ModuleRunRecord | null;
  outbox: RuntimeStoreOutboxRecord[];
  deliveries: RuntimeStoreDeliveryRecord[];
  usage: RuntimeStoreUsageRecord[];
  files: RuntimeStoreFileRecord[];
  artifacts: ModuleArtifactRecord[];
  audit: RuntimeStoreAuditRecord[];
}

export interface AdminOutboxDetailView {
  outbox: RuntimeStoreOutboxRecord | null;
  receipts: RuntimeStoreWebhookReceipt[];
  deliveries: RuntimeStoreDeliveryRecord[];
  audit: RuntimeStoreAuditRecord[];
}

export interface AdminFilesView {
  files: RuntimeStoreFileRecord[];
  storage: HostFileStorageStatus;
  reconcile: AdminFileStorageReconcileReport;
}

export interface AdminFileDetailView {
  file: RuntimeStoreFileRecord | null;
  audit: RuntimeStoreAuditRecord[];
  storage: HostFileStorageStatus;
  storageObject: AdminFileStorageObjectView | null;
  access: AdminFileAccessView | null;
  cleanup: AdminFileCleanupView | null;
}

export interface AdminFileStorageObjectView {
  status: 'present' | 'missing' | 'error';
  key: string;
  checkedAt: string;
  sizeBytes: number | null;
  checksum: string | null;
  contentType: string | null;
  metadata: Record<string, string>;
  error?: string;
}

export interface AdminFileAccessView {
  openUrl: string | null;
  downloadUrl: string | null;
  mediaGateway: 'public' | 'signed' | 'blocked';
  reason: string;
}

export interface AdminFileCleanupView {
  eligible: boolean;
  physicalObjectPresent: boolean | null;
  latestCleanupAt: string | null;
  command: string;
  reason: string;
}

export type AdminFileStorageReconcileIssue =
  | 'none'
  | 'missing-object'
  | 'deleted-object-present'
  | 'size-mismatch'
  | 'checksum-mismatch'
  | 'storage-error';

export interface AdminFileStorageReconcileItem {
  fileId: string;
  name: string;
  moduleId: string;
  status: RuntimeStoreFileRecord['status'];
  storageKey: string;
  issue: AdminFileStorageReconcileIssue;
  objectStatus: AdminFileStorageObjectView['status'];
  metadataSizeBytes: number;
  objectSizeBytes: number | null;
  metadataChecksum: string | null;
  objectChecksum: string | null;
  cleanupCandidate: boolean;
  error?: string;
}

export interface AdminFileStorageOrphanObject {
  key: string;
  sizeBytes: number;
  checksum: string;
  contentType: string | null;
  metadata: Record<string, string>;
}

export interface AdminFileStorageReconcileReport {
  checkedAt: string;
  totalFiles: number;
  checkedFiles: number;
  limit: number;
  orphanScanSupported: boolean;
  issues: number;
  presentObjects: number;
  missingObjects: number;
  orphanObjects: number;
  deletedObjectsPresent: number;
  missingActiveObjects: number;
  sizeMismatches: number;
  checksumMismatches: number;
  metadataBytes: number;
  physicalBytes: number;
  orphanBytes: number;
  command: string;
  items: AdminFileStorageReconcileItem[];
  orphans: AdminFileStorageOrphanObject[];
}

export interface AdminCommercialSubjectView {
  type: 'user' | 'workspace' | 'organization' | 'apiKey';
  id: string;
  label: string;
}

export type AdminCommercialEntitlementGrant = RuntimeStoreEntitlementGrant & {
  subject: AdminCommercialSubjectView;
};

export type AdminCommercialCreditLedgerEntry = RuntimeStoreCreditLedgerEntry & {
  subject: AdminCommercialSubjectView;
  orderId?: string;
  reservationId?: string;
};

export type AdminCommercialCreditReservation = RuntimeStoreCreditReservation & {
  subject: AdminCommercialSubjectView;
};

export type AdminCommercialApiKey = Omit<RuntimeStoreApiKeyRecord, 'keyHash'> & {
  owner?: AdminCommercialSubjectView;
};

export interface AdminCommercialRedeemCode {
  id: string;
  productId: string;
  codeHashPrefix: string;
  batchId?: string;
  prefix?: string;
  maskedCode?: string;
  entitlement?: string;
  creditsAmount?: number;
  creditsUnit: string;
  maxRedemptions: number;
  status: 'active' | 'frozen' | 'revoked' | 'expired';
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCommercialRedeemRedemption {
  id: string;
  productId: string;
  codeHashPrefix: string;
  codeId?: string;
  subject: AdminCommercialSubjectView;
  entitlement?: string;
  creditsAmount?: number;
  creditsUnit?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminCommercialRedeemAttempt {
  id: string;
  productId: string;
  codeHashPrefix?: string;
  subject?: AdminCommercialSubjectView;
  ok: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AdminCommercialRiskEvent = RuntimeStoreRiskEvent & {
  subject?: AdminCommercialSubjectView;
};

export type AdminCommercialRiskBlock = RuntimeStoreRiskBlock & {
  subject: AdminCommercialSubjectView;
};

export interface AdminCommercialView {
  orders: RuntimeStoreCommercialOrder[];
  entitlements: AdminCommercialEntitlementGrant[];
  credits: AdminCommercialCreditLedgerEntry[];
  creditReservations: AdminCommercialCreditReservation[];
  redeemCodes: AdminCommercialRedeemCode[];
  redeemRedemptions: AdminCommercialRedeemRedemption[];
  redeemAttempts: AdminCommercialRedeemAttempt[];
  apiKeys: AdminCommercialApiKey[];
  riskEvents: AdminCommercialRiskEvent[];
  riskBlocks: AdminCommercialRiskBlock[];
  catalog: HostBillingCatalog;
  planSubscribers: Record<string, number>;
  planUsage: Record<string, number>;
  featureMatrix: {
    capability: string;
    plans: Record<string, boolean | number | string>;
  }[];
  invoices: {
    id: string;
    orderId: string;
    status: string;
    amount: number;
    currency: string;
    hostedUrl: string;
    createdAt: string;
  }[];
  subscriptions: {
    id: string;
    userId: string;
    planId: string;
    entitlement: string;
    status: string;
    source: string;
    currentPeriodEnd?: string;
  }[];
  paymentMethods: {
    id: string;
    provider: string;
    type: string;
    label: string;
    status: string;
    last4?: string;
    userId?: string;
  }[];
  taxProfiles: {
    userId: string;
    company?: string;
    country?: string;
    taxIdMasked?: string;
  }[];
}

export type AdminHostSettingSource = 'env' | 'admin-override' | 'default';
export type AdminHostSettingsSource = AdminHostSettingSource | 'mixed';

export interface AdminHostSettingsFieldView {
  key: HostSettingKey;
  value: string | boolean | number;
  defaultValue: string | boolean | number;
  source: AdminHostSettingSource;
  editable: boolean;
  requiresRestart: boolean;
  secret: boolean;
  secretRef: boolean;
  risk: HostSettingRisk;
  scope: 'product' | 'system';
  envKeys: string[];
  description: string;
}

export interface AdminHostSettingsView extends HostRuntimeSettings {
  source: AdminHostSettingsSource;
  fieldSources: Record<HostSettingKey, AdminHostSettingSource>;
  fields: AdminHostSettingsFieldView[];
  version?: number;
  updatedAt?: string;
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

export async function requeueAdminRun(session: ModuleHostSession, runId: string) {
  const admin = await getAdminOperationsCenter();
  return admin.requeueRun(session, runId);
}

export async function cancelAdminRun(session: ModuleHostSession, runId: string, reason?: string) {
  const admin = await getAdminOperationsCenter();
  return admin.cancelRun(session, runId, reason);
}

export async function getAdminServiceConnectionsView(): Promise<AdminServiceConnectionsView> {
  const [configDoctor, hostRuntime, contracts] = await Promise.all([
    runHostConfigDoctor({ projectRoot: process.cwd() }),
    getHostRuntime(),
    loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT),
  ]);
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    contracts.map((contract) => contract.id)
  );
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEMO_PRODUCT_ID,
  });
  const storedConnections = await hostRuntime.runtimeStore.store.listServiceConnections({
    productId: DEMO_PRODUCT_ID,
  });
  const storedResourceBindings = await hostRuntime.runtimeStore.store.listResourceBindings({
    productId: DEMO_PRODUCT_ID,
  });
  const retainedCallLogs = applyConnectionCallLogRetention(auditLogs);
  const callLogs = retainedCallLogs.visibleLogs
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 50);
  const connections = buildServiceConnectionRows({
    contracts,
    providerReadiness: configDoctor.providerReadiness,
    storedConnections,
    storedResourceBindings,
  });

  return {
    ...createServiceConnectionsHealth(configDoctor),
    configDoctor,
    summary: connectionSummary(connections),
    connections,
    retention: retainedCallLogs.retention,
    callLogs,
  };
}

async function findAdminServiceConnection(connectionId: string) {
  const view = await getAdminServiceConnectionsView();
  const connection = view.connections.find((item) => item.id === connectionId);
  if (!connection) {
    throw new Error(`ADMIN_CONNECTION_NOT_FOUND: ${connectionId}`);
  }
  return { view, connection };
}

export async function setAdminServiceConnectionStatus(
  session: ModuleHostSession,
  connectionId: string,
  status: 'active' | 'disabled',
  reason = 'Admin connection status update'
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(connectionId);
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection(
    serviceConnectionStoreInput(session, connection, status)
  );
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: status === 'disabled' ? 'admin.connection.disabled' : 'admin.connection.enabled',
    metadata: {
      connectionId,
      service: connection.service,
      provider: connection.provider,
      previousStatus: connection.status,
      nextStatus: status,
      connectionStoreId: saved.connectionId,
      reason,
    },
  });
}

export async function testAdminServiceConnection(
  session: ModuleHostSession,
  connectionId: string,
  reason = 'Admin connection test',
  options: { fetchImpl?: typeof fetch } = {}
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(connectionId);
  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.upsertServiceConnection(serviceConnectionStoreInput(session, connection));
  const contracts = connection.moduleId ? await loadModuleRuntimeContracts(MODULE_MAP_ARTIFACT) : [];
  const contract = contracts.find((item) => item.id === connection.moduleId);
  const signedHealthCheck = contract
    ? await runAdminSignedServiceConnectionHealthCheck({
        session,
        connection,
        contract,
        fetchImpl: options.fetchImpl ?? fetch,
        store: hostRuntime.runtimeStore.store,
      })
    : null;
  const healthCheck =
    signedHealthCheck ??
    (await runAdminServiceConnectionHealthCheck(connection, options.fetchImpl ?? fetch));
  await hostRuntime.runtimeStore.store.touchServiceConnection(DEMO_PRODUCT_ID, connectionId, {
    health: {
      status: healthCheck.status,
      result: healthCheck.result,
      latencyMs: healthCheck.latencyMs,
      lastTestAt: new Date().toISOString(),
      lastError: healthCheck.error,
      responseStatus: healthCheck.responseStatus,
      target: healthCheck.target,
    },
  });
  await hostRuntime.runtimeStore.store.recordProviderInvocation({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId ?? null,
    moduleId: connection.moduleId ?? null,
    providerId: connection.provider,
    kind: 'connector',
    operation: 'healthcheck',
    status: healthCheck.result === 'succeeded' ? 'succeeded' : 'failed',
    target: healthCheck.target ?? connection.baseUrl,
    serviceConnectionId: connectionId,
    usage: {
      responseStatus: healthCheck.responseStatus,
    },
    latencyMs: healthCheck.latencyMs,
    error:
      healthCheck.result === 'failed'
        ? {
            code: 'ADMIN_CONNECTION_HEALTHCHECK_FAILED',
            message: healthCheck.error ?? 'Service connection health check failed.',
          }
        : undefined,
    metadata: {
      service: connection.service,
      healthCheck: connection.healthCheck,
      authType: connection.authType,
    },
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.tested',
    metadata: {
      connectionId,
      service: connection.service,
      provider: connection.provider,
      status: connection.status,
      result: healthCheck.result,
      latencyMs: healthCheck.latencyMs,
      reason,
      request: {
        method: 'HEALTHCHECK',
        baseUrl: connection.baseUrl,
        healthCheck: connection.healthCheck,
        timeoutMs: connection.timeoutMs,
        target: healthCheck.target,
      },
      responseStatus: healthCheck.responseStatus,
      error: healthCheck.error,
    },
  });
}

export async function rotateAdminServiceConnectionSecret(
  session: ModuleHostSession,
  connectionId: string,
  secretSource = 'env:ROTATED_SOURCE',
  reason = 'Admin secret source rotation'
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(connectionId);
  const namedSecretRefs = Object.keys(connection.secretRefs).filter((name) => name !== 'credential');
  if (namedSecretRefs.length > 0 && !connection.secretRefs.credential) {
    throw new Error('ADMIN_CONNECTION_NAMED_SECRET_REFS_REQUIRE_POLICY_UPDATE');
  }
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection({
    ...serviceConnectionStoreInput(session, {
      ...connection,
      secretSource,
      secretRefs: {
        ...connection.secretRefs,
        credential: secretSource,
      },
    }),
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.secret_rotated',
    metadata: {
      connectionId,
      service: connection.service,
      provider: connection.provider,
      authType: connection.authType,
      previousSecretSource: connection.secretSource,
      nextSecretSource: secretSource,
      connectionStoreId: saved.connectionId,
      reason,
    },
  });
}

export interface AdminServiceConnectionPolicyInput {
  connectionId: string;
  service?: string;
  provider?: string;
  moduleId?: string;
  workspaceId?: string | null;
  environment?: string;
  ownerType?: AdminServiceConnectionRow['ownerType'];
  scopeType?: AdminServiceConnectionRow['scopeType'];
  authType?: AdminServiceConnectionRow['authType'];
  secretSource?: string;
  secretRefs?: Record<string, string>;
  baseUrl?: string;
  timeoutMs?: number;
  retry?: string;
  maxResponseBytes?: number;
  healthCheck?: string;
  actorClaims?: string;
  reason?: string;
}

export async function createAdminServiceConnection(
  session: ModuleHostSession,
  input: AdminServiceConnectionPolicyInput
) {
  assertAdminSession(session);
  const connectionId = normalizeCustomConnectionId(input.connectionId);
  const view = await getAdminServiceConnectionsView();
  if (view.connections.some((connection) => connection.id === connectionId)) {
    throw new Error(`ADMIN_CONNECTION_ALREADY_EXISTS: ${connectionId}`);
  }
  const policy = normalizeConnectionPolicyInput({
    ...input,
    connectionId,
    service: input.service ?? connectionId.replace(/^custom:/, ''),
    provider: input.provider ?? 'custom',
  });
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection({
    productId: DEMO_PRODUCT_ID,
    workspaceId: policy.workspaceId,
    moduleId: policy.moduleId ?? null,
    actorId: session.actorId ?? session.user?.id ?? null,
    connectionId,
    service: policy.service,
    provider: policy.provider,
    status: 'active',
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    authType: policy.authType,
    config: {
      baseUrl: policy.baseUrl,
      timeoutMs: policy.timeoutMs,
      retry: policy.retry,
      maxResponseBytes: policy.maxResponseBytes,
      healthCheck: policy.healthCheck,
      actorClaims: policy.actorClaims,
      detail: 'Custom service connection created from Admin operations.',
    },
    secretRefs: policy.secretRefs,
    health: {
      status: 'warning',
      required: false,
    },
    metadata: {
      source: 'custom',
    },
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: policy.workspaceId,
    moduleId: policy.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.created',
    metadata: {
      connectionId,
      connectionStoreId: saved.connectionId,
      policy,
      reason: input.reason ?? 'Admin service connection created',
    },
  });
}

export async function updateAdminServiceConnectionPolicy(
  session: ModuleHostSession,
  input: AdminServiceConnectionPolicyInput
) {
  assertAdminSession(session);
  const { connection } = await findAdminServiceConnection(input.connectionId);
  const policy = normalizeConnectionPolicyInput({
    ...input,
    connectionId: connection.id,
    service: input.service ?? connection.service,
    provider: input.provider ?? connection.provider,
    moduleId: input.moduleId ?? connection.moduleId,
    workspaceId: input.workspaceId ?? connection.workspaceId,
    environment: input.environment ?? connection.environment,
    ownerType: input.ownerType ?? connection.ownerType,
    scopeType: input.scopeType ?? connection.scopeType,
    authType: input.authType ?? connection.authType,
    secretSource: input.secretSource ?? connection.secretSource,
    secretRefs: input.secretRefs ?? connection.secretRefs,
    baseUrl: input.baseUrl ?? connection.baseUrl,
    timeoutMs: input.timeoutMs ?? connection.timeoutMs,
    retry: input.retry ?? connection.retry,
    maxResponseBytes: input.maxResponseBytes ?? connection.maxResponseBytes,
    healthCheck: input.healthCheck ?? connection.healthCheck,
    actorClaims: input.actorClaims ?? connection.actorClaims,
  });
  const hostRuntime = await getHostRuntime();
  const saved = await hostRuntime.runtimeStore.store.upsertServiceConnection({
    productId: DEMO_PRODUCT_ID,
    workspaceId: policy.workspaceId,
    moduleId: policy.moduleId ?? null,
    actorId: session.actorId ?? session.user?.id ?? null,
    connectionId: connection.id,
    service: policy.service,
    provider: policy.provider,
    status: connection.status === 'disabled' ? 'disabled' : 'active',
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    authType: policy.authType,
    config: {
      baseUrl: policy.baseUrl,
      timeoutMs: policy.timeoutMs,
      retry: policy.retry,
      maxResponseBytes: policy.maxResponseBytes,
      healthCheck: policy.healthCheck,
      actorClaims: policy.actorClaims,
      detail: 'Service connection policy updated from Admin operations.',
    },
    secretRefs: policy.secretRefs,
    health: {
      status: connection.status === 'ready' ? 'ready' : 'warning',
      required: connection.required,
      lastTestAt: connection.lastTestAt,
      lastError: connection.lastError,
    },
    metadata: {
      source: connection.source,
    },
  });
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: connection.workspaceId,
    moduleId: connection.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.updated',
    metadata: {
      connectionId: connection.id,
      connectionStoreId: saved.connectionId,
      service: connection.service,
      provider: connection.provider,
      policy,
      reason: input.reason ?? 'Admin service connection policy updated',
    },
  });
}

export async function applyAdminServiceConnectionLogRetention(
  session: ModuleHostSession,
  input: {
    retentionDays?: number;
    reason?: string;
  } = {}
) {
  assertAdminSession(session);
  const retentionDays = boundedConnectionNumber(input.retentionDays, 30, 0, 3650);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const hostRuntime = await getHostRuntime();
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEMO_PRODUCT_ID,
  });
  const matched = auditLogs.filter(
    (record) =>
      record.type.startsWith('admin.connection.') &&
      record.type !== 'admin.connection.retention_applied' &&
      record.createdAt <= cutoff
  ).length;

  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.connection.retention_applied',
    metadata: {
      retentionDays,
      cutoff,
      mode: 'hide-before-cutoff',
      matched,
      reason: input.reason ?? 'Admin connection call log retention applied',
    },
  });
}

export async function applyAdminAuditRetention(
  session: ModuleHostSession,
  input: {
    retentionDays?: number;
    mode?: 'archive' | 'delete' | 'hide-before-cutoff';
    reason?: string;
  } = {}
) {
  assertAdminSession(session);
  const retentionDays = boundedConnectionNumber(input.retentionDays, 90, 0, 3650);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const mode = input.mode ?? 'archive';
  const hostRuntime = await getHostRuntime();
  const auditLogs = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEMO_PRODUCT_ID,
  });
  const matched = auditLogs.filter((record) => record.createdAt <= cutoff).length;
  return hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.audit.retention_applied',
    metadata: {
      retentionDays,
      cutoff,
      mode,
      matched,
      reason: input.reason ?? 'Admin audit retention policy applied',
    },
  });
}

export async function retryAdminOutbox(
  session: ModuleHostSession,
  outboxId: string,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  return admin.retryOutbox(session, outboxId, reason);
}

export async function discardAdminOutbox(
  session: ModuleHostSession,
  outboxId: string,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  return admin.discardOutbox(session, outboxId, reason);
}

export async function archiveAdminOutbox(
  session: ModuleHostSession,
  outboxId: string,
  reason?: string
) {
  const admin = await getAdminOperationsCenter();
  return admin.archiveOutbox(session, outboxId, reason);
}

export async function bulkReplayAdminDeadLetters(
  session: ModuleHostSession,
  input: {
    outboxIds?: readonly string[];
    namePrefix?: string;
    limit?: number;
    reason?: string;
  } = {}
) {
  const admin = await getAdminOperationsCenter();
  return admin.bulkRetryOutbox(session, {
    productId: DEMO_PRODUCT_ID,
    status: 'dead_letter',
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
    reason: input.reason,
  });
}

export async function previewAdminOutboxBulkAction(
  session: ModuleHostSession,
  input: {
    action: 'replay' | 'discard' | 'archive';
    outboxIds?: readonly string[];
    status?: 'queued' | 'failed' | 'dead_letter' | 'processed';
    namePrefix?: string;
    limit?: number;
  }
) {
  const admin = await getAdminOperationsCenter();
  return admin.previewBulkOutbox(session, {
    action: input.action,
    productId: DEMO_PRODUCT_ID,
    status: input.status,
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
  });
}

export async function bulkDiscardAdminOutbox(
  session: ModuleHostSession,
  input: {
    outboxIds?: readonly string[];
    status?: 'failed' | 'queued' | 'dead_letter';
    namePrefix?: string;
    limit?: number;
    reason?: string;
  } = {}
) {
  const admin = await getAdminOperationsCenter();
  return admin.bulkDiscardOutbox(session, {
    productId: DEMO_PRODUCT_ID,
    status: input.status ?? 'failed',
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
    reason: input.reason,
  });
}

export async function bulkArchiveAdminOutbox(
  session: ModuleHostSession,
  input: {
    outboxIds?: readonly string[];
    status?: 'processed' | 'dead_letter' | 'failed';
    namePrefix?: string;
    limit?: number;
    reason?: string;
  } = {}
) {
  const admin = await getAdminOperationsCenter();
  return admin.bulkArchiveOutbox(session, {
    productId: DEMO_PRODUCT_ID,
    status: input.status ?? 'processed',
    ids: input.outboxIds,
    namePrefix: input.namePrefix,
    limit: input.limit,
    reason: input.reason,
  });
}

export async function retryAdminWebhookReceipt(
  session: ModuleHostSession,
  receiptId: string,
  reason = 'Webhook receipt replayed by admin'
) {
  assertAdminSession(session);
  const hostRuntime = await getHostRuntime();
  const receipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: DEMO_PRODUCT_ID,
  });
  const receipt = receipts.find((candidate) => candidate.id === receiptId);
  if (!receipt) {
    throw new Error(`ADMIN_WEBHOOK_RECEIPT_NOT_FOUND: ${receiptId}`);
  }
  const replayed = await hostRuntime.runtimeStore.store.markWebhookReceipt(receipt.id, 'received');
  const outbox = await hostRuntime.runtimeStore.store.enqueueOutbox({
    productId: receipt.productId,
    workspaceId: receipt.workspaceId,
    moduleId: receipt.moduleId,
    name: `webhook:${receipt.moduleId}:${receipt.webhookName}`,
    idempotencyKey: `admin-webhook-replay:${receipt.id}:${Date.now()}`,
    payload: {
      receiptId: receipt.id,
      moduleId: receipt.moduleId,
      webhookName: receipt.webhookName,
      path: receipt.path,
      method: receipt.method,
      bodyText: receipt.bodyText,
      bodyDigest: receipt.bodyDigest,
      headers: receipt.headers,
      replay: true,
    },
    metadata: {
      maxAttempts: 3,
      source: 'admin-webhook-replay',
      previousReceiptStatus: receipt.status,
    },
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: receipt.productId,
    workspaceId: receipt.workspaceId,
    moduleId: receipt.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.webhook.receipt_replayed',
    metadata: {
      receiptId: receipt.id,
      outboxId: outbox.id,
      webhookName: receipt.webhookName,
      method: receipt.method,
      path: receipt.path,
      bodyDigest: receipt.bodyDigest,
      previousStatus: receipt.status,
      nextStatus: replayed.status,
      reason,
    },
  });
  return { receipt: replayed, outbox };
}

export async function bulkRetryAdminWebhookReceipts(
  session: ModuleHostSession,
  input: {
    receiptIds?: readonly string[];
    status?: 'failed' | 'rejected' | 'duplicate';
    limit?: number;
    reason?: string;
  } = {}
) {
  assertAdminSession(session);
  const hostRuntime = await getHostRuntime();
  const idSet = input.receiptIds ? new Set(input.receiptIds) : null;
  const receipts = await hostRuntime.runtimeStore.store.listWebhookReceipts({
    productId: DEMO_PRODUCT_ID,
    status: input.status ?? 'failed',
  });
  const matched = idSet ? receipts.filter((receipt) => idSet.has(receipt.id)) : receipts;
  const records: Awaited<ReturnType<typeof retryAdminWebhookReceipt>>[] = [];
  for (const receipt of matched.slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200))) {
    records.push(await retryAdminWebhookReceipt(session, receipt.id, input.reason));
  }
  return {
    matched: matched.length,
    processed: records.length,
    records,
  };
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
          sourceId: entry?.sourceId,
          sourceDir: entry?.sourceDir,
          sourceKind: entry?.sourceKind,
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
            locales: Object.keys(contract.resources.locales ?? {}),
            assets: (contract.resources.assets ?? []).map((asset) => asset.path),
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

function addDiagnostic(
  target: Record<string, ModuleDiagnostic[]>,
  moduleId: string,
  diagnostic: ModuleDiagnostic
) {
  target[moduleId] ??= [];
  target[moduleId].push(diagnostic);
}

function readModuleTestReports(): AdminModuleTestReport[] {
  const reportsDir = path.join(process.cwd(), '.runtime', 'module-test-reports');
  if (!fs.existsSync(reportsDir)) {
    return [];
  }

  return fs
    .readdirSync(reportsDir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      const reportFile = path.join(reportsDir, entry);
      const parsed = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as Omit<
        AdminModuleTestReport,
        'moduleId'
      > & { moduleId?: string };
      return {
        moduleId: parsed.moduleId ?? path.basename(entry, '.json'),
        moduleRoot: parsed.moduleRoot,
        success: Boolean(parsed.success),
        mode: parsed.mode,
        checkedAt: parsed.checkedAt,
        reportFile: parsed.reportFile ?? reportFile,
        steps: parsed.steps ?? [],
      };
    })
    .sort((left, right) => left.moduleId.localeCompare(right.moduleId));
}

export async function getAdminModuleDevConsoleView(): Promise<AdminModuleDevConsoleView> {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );
  const catalogStates = await hostRuntime.runtimeStore.store.listCatalogStates({
    productId: DEMO_PRODUCT_ID,
  });
  const diagnosticsByModule: Record<string, ModuleDiagnostic[]> = {};

  for (const contract of hostRuntime.moduleHost.runtime.contracts) {
    for (const diagnostic of validateModuleDefinition(contract.definition)) {
      addDiagnostic(diagnosticsByModule, contract.id, diagnostic);
    }
  }

  for (const diagnostic of diagnoseModuleCatalog({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: hostRuntime.moduleHost.runtime.contracts,
    moduleStates: catalogStates,
  })) {
    const matched =
      hostRuntime.moduleHost.runtime.contracts.find(
        (contract) =>
          diagnostic.message.includes(contract.id) || (diagnostic.path ?? '').includes(contract.id)
      )?.id ?? '__catalog__';
    addDiagnostic(diagnosticsByModule, matched, diagnostic);
  }

  const snapshot = createModuleDevConsoleSnapshot({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: hostRuntime.moduleHost.runtime.contracts,
    diagnosticsByModule,
  });
  const report = createDeveloperPlatformReport({
    snapshot,
    diagnosticsByModule,
  });
  const bundle = createModuleBundleManifest({
    artifact: MODULE_MAP_ARTIFACT,
    contracts: hostRuntime.moduleHost.runtime.contracts,
  });

  return {
    snapshot,
    report,
    bundle,
    environment: {
      currentEnvironment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
      nodeEnvironment: process.env.NODE_ENV ?? 'development',
      targetEnvironment: process.env.PLOYKIT_TARGET_ENV ?? 'production',
      moduleMapKind: MODULE_MAP_ARTIFACT.kind,
      moduleMapGeneratedAt: MODULE_MAP_ARTIFACT.generatedAt ?? null,
      moduleMapBuildId: MODULE_MAP_ARTIFACT.buildId ?? null,
    },
    diagnosticsByModule,
    testReports: readModuleTestReports(),
  };
}

function valueHasRunId(value: unknown, runId: string): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.runId === runId || record.correlationId === runId || record.causationId === runId;
}

function valueHasReceiptId(value: unknown, receiptId: string): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.receiptId === receiptId || record.correlationId === receiptId || record.causationId === receiptId;
}

function outboxRunId(record: RuntimeStoreOutboxRecord): string | undefined {
  return stringMetadata(metadataRecord(record.payload).runId);
}

function outboxReceiptId(record: RuntimeStoreOutboxRecord): string | undefined {
  return stringMetadata(metadataRecord(record.payload).receiptId);
}

function uniqueById<TRecord extends { id: string }>(records: readonly TRecord[]): TRecord[] {
  const seen = new Set<string>();
  const unique: TRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    unique.push(record);
  }
  return unique;
}

export type AdminServiceConnectionStatus = 'ready' | 'warning' | 'blocked' | 'disabled';

export interface AdminServiceConnectionRow {
  id: string;
  source: 'host' | 'module' | 'custom';
  moduleId?: string;
  service: string;
  provider: string;
  status: AdminServiceConnectionStatus;
  required: boolean;
  environment: string;
  ownerType: 'system' | 'module' | 'workspace' | 'user';
  scopeType: 'global' | 'workspace' | 'user';
  workspaceId?: string | null;
  authType: 'none' | 'apiKey' | 'basic' | 'oauth' | 'webhook' | 'env';
  secretSource: string;
  secretRefs: Record<string, string>;
  baseUrl: string;
  timeoutMs: number;
  retry: string;
  maxResponseBytes: number;
  healthCheck: string;
  detail: string;
  actorClaims?: string;
  policyUpdatedAt?: string;
  lastTestAt?: string;
  lastError?: string;
}

export interface AdminConnectionLogRetentionView {
  retentionDays?: number;
  cutoff?: string;
  appliedAt?: string;
  hiddenCount: number;
  visibleCount: number;
}

export interface AdminServiceConnectionsView {
  runtimeStore: ReturnType<typeof createServiceConnectionsHealth>['runtimeStore'];
  files: ReturnType<typeof createServiceConnectionsHealth>['files'];
  billing: ReturnType<typeof createServiceConnectionsHealth>['billing'];
  auth: ReturnType<typeof createServiceConnectionsHealth>['auth'];
  providers: ReturnType<typeof createServiceConnectionsHealth>['providers'];
  security: ReturnType<typeof createServiceConnectionsHealth>['security'];
  configDoctor: Awaited<ReturnType<typeof runHostConfigDoctor>>;
  summary: Record<AdminServiceConnectionStatus, number>;
  connections: AdminServiceConnectionRow[];
  retention: AdminConnectionLogRetentionView;
  callLogs: RuntimeStoreAuditRecord[];
}

function createServiceConnectionsHealth(configDoctor: Awaited<ReturnType<typeof runHostConfigDoctor>>) {
  return {
    runtimeStore: configDoctor.health.store,
    files: configDoctor.health.files,
    billing: configDoctor.health.billing,
    auth: configDoctor.health.auth,
    providers: configDoctor.health.providers,
    security: configDoctor.health.security,
  };
}

interface AdminServiceConnectionHealthCheckResult {
  result: 'succeeded' | 'failed';
  status: AdminServiceConnectionStatus;
  latencyMs: number;
  target?: string;
  responseStatus?: number;
  error?: string;
}

function deterministicConnectionLatency(connectionId: string): number {
  return (
    20 +
    Math.abs(Array.from(connectionId).reduce((acc, char) => acc + char.charCodeAt(0), 0) % 90)
  );
}

function resolveAdminServiceSecretRef(ref: string): string | null {
  if (ref.startsWith('env:')) {
    return process.env[ref.slice(4)] ?? null;
  }
  return null;
}

function isPrivateServiceConnectionHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function serviceConnectionBasePath(base: URL): string {
  if (!base.pathname || base.pathname === '/') {
    return '';
  }
  return base.pathname.replace(/\/+$/, '');
}

function serviceConnectionPathWithinBase(pathname: string, basePath: string): boolean {
  return !basePath || pathname === basePath || pathname.startsWith(`${basePath}/`);
}

function joinServiceConnectionPath(basePath: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!basePath || serviceConnectionPathWithinBase(normalizedPath, basePath)) {
    return normalizedPath;
  }
  return `${basePath}${normalizedPath}`;
}

function normalizeHealthCheckPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'provider readiness' || trimmed === 'declaration only') {
    return '/';
  }
  return trimmed;
}

function serviceHealthOperationInput(connection: AdminServiceConnectionRow): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const healthPath = normalizeHealthCheckPath(connection.healthCheck);
  if (healthPath !== '/') {
    input.path = healthPath;
  }
  return input;
}

function serviceHealthProbeOperation(
  sourceOperation: ModuleServiceOperationDefinition
): ModuleServiceOperationDefinition {
  return {
    method: 'GET',
    input: {
      allow: ['path', 'query'],
      claimsAllow: sourceOperation.input?.claimsAllow,
    },
    auth: sourceOperation.auth,
    signing: sourceOperation.signing,
    request: {
      body: 'none',
    },
    response: {
      body: 'text',
      maxBytes: 16 * 1024,
    },
    redaction: sourceOperation.redaction,
  };
}

async function runAdminSignedServiceConnectionHealthCheck(input: {
  session: ModuleHostSession;
  connection: AdminServiceConnectionRow;
  contract: ModuleRuntimeContract;
  fetchImpl: typeof fetch;
  store: RuntimeStore;
}): Promise<AdminServiceConnectionHealthCheckResult | null> {
  const requirement = input.contract.serviceRequirements[input.connection.service];
  if (requirement?.kind !== 'signed-http') {
    return null;
  }
  const sourceOperation = Object.values(requirement.operations ?? {})[0];
  if (!sourceOperation) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: deterministicConnectionLatency(input.connection.id),
      target: input.connection.baseUrl,
      error: 'MODULE_SERVICE_OPERATION_MISSING',
    };
  }
  const probeOperationName = 'admin.healthcheck';
  const probeContract: ModuleRuntimeContract = {
    ...input.contract,
    serviceRequirements: {
      ...input.contract.serviceRequirements,
      [input.connection.service]: {
        ...requirement,
        operations: {
          ...requirement.operations,
          [probeOperationName]: serviceHealthProbeOperation(sourceOperation),
        },
      },
    },
  };
  const startedAt = Date.now();
  const services = createServiceInvocationRuntime({
    contract: probeContract,
    store: input.store,
    session: {
      ...input.session,
      productId: DEMO_PRODUCT_ID,
      workspaceId: input.connection.workspaceId ?? input.session.workspaceId ?? DEFAULT_HOST_WORKSPACE_ID,
    },
    request: {
      id: `admin-service-test:${input.connection.id}:${Date.now()}`,
      correlationId: `admin-service-test:${input.connection.id}`,
      method: 'POST',
      path: '/admin/service-connections/test',
    },
    fetchImpl: input.fetchImpl,
    readinessProbe: true,
    secretResolver: resolveAdminServiceSecretRef,
  });
  try {
    const result = (await services.invoke(input.connection.service, probeOperationName, serviceHealthOperationInput(input.connection), {
      correlationId: `admin-service-test:${input.connection.id}`,
    })) as { ok?: boolean; status?: number; url?: string };
    const succeeded = result.ok !== false;
    return {
      result: succeeded ? 'succeeded' : 'failed',
      status: succeeded ? 'ready' : 'warning',
      latencyMs: Date.now() - startedAt,
      target: result.url ?? input.connection.baseUrl,
      responseStatus: result.status,
      error: succeeded ? undefined : `HTTP ${result.status ?? 'unknown'}`,
    };
  } catch (error) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: Date.now() - startedAt,
      target: input.connection.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveAdminServiceConnectionHealthUrl(
  connection: AdminServiceConnectionRow
): URL | null {
  let base: URL;
  try {
    base = new URL(connection.baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return null;
  }
  const healthPath = normalizeHealthCheckPath(connection.healthCheck);
  let target: URL;
  if (/^https?:\/\//i.test(healthPath)) {
    target = new URL(healthPath);
  } else if (healthPath.startsWith('/')) {
    target = new URL(
      joinServiceConnectionPath(serviceConnectionBasePath(base), healthPath),
      base.origin
    );
  } else {
    const baseHref = connection.baseUrl.endsWith('/')
      ? connection.baseUrl
      : `${connection.baseUrl}/`;
    target = new URL(healthPath, baseHref);
  }
  if (target.origin !== base.origin) {
    throw new Error(`ADMIN_CONNECTION_HEALTHCHECK_EGRESS_DENIED: ${target.origin}`);
  }
  if (isPrivateServiceConnectionHostname(target.hostname)) {
    throw new Error(`ADMIN_CONNECTION_HEALTHCHECK_PRIVATE_NETWORK_DENIED: ${target.hostname}`);
  }
  if (!serviceConnectionPathWithinBase(target.pathname, serviceConnectionBasePath(base))) {
    throw new Error(`ADMIN_CONNECTION_HEALTHCHECK_PATH_DENIED: ${target.pathname}`);
  }
  return target;
}

async function fetchAdminServiceConnectionHealth(
  fetchImpl: typeof fetch,
  url: URL,
  timeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runAdminServiceConnectionHealthCheck(
  connection: AdminServiceConnectionRow,
  fetchImpl: typeof fetch
): Promise<AdminServiceConnectionHealthCheckResult> {
  const startedAt = Date.now();
  if (connection.status === 'disabled') {
    return {
      result: 'failed',
      status: 'blocked',
      latencyMs: deterministicConnectionLatency(connection.id),
      target: connection.baseUrl,
      error: connection.detail,
    };
  }

  let target: URL | null;
  try {
    target = resolveAdminServiceConnectionHealthUrl(connection);
  } catch (error) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: Date.now() - startedAt,
      target: connection.baseUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!target) {
    return {
      result: 'succeeded',
      status: 'ready',
      latencyMs: deterministicConnectionLatency(connection.id),
      target: connection.baseUrl,
    };
  }

  try {
    const response = await fetchAdminServiceConnectionHealth(
      fetchImpl,
      target,
      connection.timeoutMs
    );
    const succeeded = response.ok;
    return {
      result: succeeded ? 'succeeded' : 'failed',
      status: succeeded ? 'ready' : 'warning',
      latencyMs: Date.now() - startedAt,
      target: target.toString(),
      responseStatus: response.status,
      error: succeeded ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      result: 'failed',
      status: 'warning',
      latencyMs: Date.now() - startedAt,
      target: target.toString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeProviderId(value: string | undefined): string {
  const id = (value ?? '').toLowerCase();
  if (['postgres', 'database', 'runtime-store', 'runtime_store'].some((token) => id.includes(token))) {
    return 'runtime-store';
  }
  if (['s3', 'file', 'storage'].some((token) => id.includes(token))) {
    return 'files';
  }
  if (['stripe', 'billing', 'payment'].some((token) => id.includes(token))) {
    return 'billing';
  }
  if (['email', 'mail'].some((token) => id.includes(token))) {
    return 'email';
  }
  if (['openai', 'ai'].some((token) => id.includes(token))) {
    return 'ai';
  }
  if (['rag', 'vector'].some((token) => id.includes(token))) {
    return 'rag';
  }
  if (['notification'].some((token) => id.includes(token))) {
    return 'notifications';
  }
  return id || 'custom';
}

function inferAuthType(providerId: string): AdminServiceConnectionRow['authType'] {
  if (providerId === 'auth') {
    return 'env';
  }
  if (providerId === 'email' || providerId === 'billing') {
    return 'webhook';
  }
  if (providerId === 'runtime-store') {
    return 'env';
  }
  if (providerId === 'files' || providerId === 'ai') {
    return 'apiKey';
  }
  return 'none';
}

function inferSecretSource(providerId: string): string {
  if (providerId === 'runtime-store') {
    return 'env:DATABASE_URL';
  }
  if (providerId === 'files') {
    return 'env:PLOYKIT_S3_*';
  }
  if (providerId === 'billing') {
    return 'env:STRIPE_*';
  }
  if (providerId === 'email') {
    return 'env:PLOYKIT_EMAIL_*';
  }
  if (providerId === 'ai') {
    return 'env:AI_PROVIDER_*';
  }
  if (providerId === 'auth') {
    return 'env:PLOYKIT_AUTH_SECRET';
  }
  return 'none';
}

function inferBaseUrl(providerId: string): string {
  if (providerId === 'runtime-store') {
    return 'postgres://configured-by-env';
  }
  if (providerId === 'files') {
    return 's3://configured-bucket';
  }
  if (providerId === 'billing') {
    return 'https://api.stripe.com';
  }
  if (providerId === 'email') {
    return 'webhook://email-provider';
  }
  return 'local://host-runtime';
}

function normalizeCustomConnectionId(value: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!id) {
    throw new Error('ADMIN_CONNECTION_ID_REQUIRED');
  }
  return id.startsWith('custom:') ? id : `custom:${id}`;
}

function normalizeConnectionAuthType(
  value: string | undefined
): AdminServiceConnectionRow['authType'] {
  if (
    value === 'none' ||
    value === 'apiKey' ||
    value === 'basic' ||
    value === 'oauth' ||
    value === 'webhook' ||
    value === 'env'
  ) {
    return value;
  }
  return 'none';
}

function normalizeConnectionOwnerType(
  value: string | undefined
): AdminServiceConnectionRow['ownerType'] {
  if (value === 'system' || value === 'module' || value === 'workspace' || value === 'user') {
    return value;
  }
  return 'workspace';
}

function normalizeConnectionScopeType(
  value: string | undefined
): AdminServiceConnectionRow['scopeType'] {
  if (value === 'global' || value === 'workspace' || value === 'user') {
    return value;
  }
  return 'workspace';
}

function normalizeCredentialRef(value: string | undefined): string {
  const ref = value?.trim();
  if (!ref || ref === 'none' || ref === '[REDACTED]') {
    return 'none';
  }
  if (ref.startsWith('env:')) {
    return ref;
  }
  throw new Error('ADMIN_CONNECTION_SECRET_SOURCE_UNSUPPORTED');
}

function normalizeSecretRefs(input: {
  secretSource?: string;
  secretRefs?: Record<string, string>;
}): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const [name, ref] of Object.entries(input.secretRefs ?? {})) {
    const normalized = normalizeCredentialRef(ref);
    if (normalized !== 'none') {
      refs[name] = normalized;
    }
  }
  const credentialRef = normalizeCredentialRef(input.secretSource);
  if (credentialRef !== 'none' && (input.secretSource !== undefined || !refs.credential)) {
    refs.credential = credentialRef;
  }
  return refs;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = metadataRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

function normalizeConnectionUrl(value: string | undefined): string {
  const url = value?.trim() || 'local://host-runtime';
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'postgres:', 's3:', 'webhook:', 'local:', 'resource:'].includes(parsed.protocol)) {
      throw new Error('unsupported protocol');
    }
    return url;
  } catch {
    throw new Error(`ADMIN_CONNECTION_BASE_URL_INVALID: ${url}`);
  }
}

function boundedConnectionNumber(value: number | undefined, fallback: number, min: number, max: number) {
  const next = Number(value ?? fallback);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(next), min), max);
}

function normalizeConnectionPolicyInput(input: AdminServiceConnectionPolicyInput) {
  const authType = normalizeConnectionAuthType(input.authType);
  const secretRefs = normalizeSecretRefs(input);
  return {
    connectionId: input.connectionId,
    service: (input.service ?? 'custom').trim(),
    provider: (input.provider ?? 'custom').trim(),
    moduleId: input.moduleId?.trim() || undefined,
    workspaceId: input.workspaceId === undefined ? DEFAULT_HOST_WORKSPACE_ID : input.workspaceId,
    environment:
      input.environment?.trim() || process.env.PLOYKIT_ENV || process.env.NODE_ENV || 'development',
    ownerType: normalizeConnectionOwnerType(input.ownerType),
    scopeType: normalizeConnectionScopeType(input.scopeType),
    authType,
    credentialRef: secretRefs.credential ?? 'none',
    secretRefs,
    baseUrl: normalizeConnectionUrl(input.baseUrl),
    timeoutMs: boundedConnectionNumber(input.timeoutMs, 8000, 100, 120_000),
    retry: input.retry?.trim() || '2 attempts / exponential',
    maxResponseBytes: boundedConnectionNumber(input.maxResponseBytes, 512 * 1024, 1024, 50 * 1024 * 1024),
    healthCheck: input.healthCheck?.trim() || 'provider readiness',
    actorClaims: input.actorClaims?.trim() || 'system',
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function adminSubjectFromStoredUserId(userId: string): AdminCommercialSubjectView {
  const [type, ...idParts] = userId.split(':');
  if (
    (type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    idParts.length > 0
  ) {
    const id = idParts.join(':');
    return { type, id, label: `${type}:${id}` };
  }
  return { type: 'user', id: userId, label: userId };
}

function adminSubjectFromParts(
  type: AdminCommercialSubjectView['type'] | undefined,
  id: string | undefined
): AdminCommercialSubjectView | undefined {
  if (!type || !id) {
    return undefined;
  }
  return { type, id, label: type === 'user' ? id : `${type}:${id}` };
}

function metadataString(record: { metadata?: Record<string, unknown> }, key: string): string | undefined {
  return stringMetadata(record.metadata?.[key]);
}

function isCommercialAdminMetadataSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase();
  if (normalized.endsWith('masked') || normalized === 'maskedcode') {
    return false;
  }
  return (
    [
      'rawcode',
      'keyhash',
      'codehash',
      'contacthash',
      'apikey',
      'secret',
      'token',
      'password',
      'authorization',
      'signature',
      'privatekey',
      'clientsecret',
      'accesskey',
      'email',
      'phone',
      'taxid',
      'vatid',
      'ssn',
    ].includes(normalized) ||
    normalized.endsWith('email') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
  );
}

function redactCommercialAdminString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\b/g, '[REDACTED_AUTH]');
}

function commercialAdminMetadata(value: unknown): Record<string, unknown> {
  const redact = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return redactCommercialAdminString(item);
    }
    if (Array.isArray(item)) {
      return item.map(redact);
    }
    if (!item || typeof item !== 'object') {
      return item;
    }
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([key, nested]) => [
        key,
        isCommercialAdminMetadataSensitiveKey(key) ? '[REDACTED]' : redact(nested),
      ])
    );
  };
  return metadataRecord(redact(value));
}

function redeemCodeStatus(record: RuntimeStoreRedeemCode): AdminCommercialRedeemCode['status'] {
  const status = stringMetadata(record.metadata.status);
  if (status === 'frozen' || status === 'revoked') {
    return status;
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

function toAdminRedeemCode(record: RuntimeStoreRedeemCode): AdminCommercialRedeemCode {
  return {
    id: `${record.productId}:${record.code.slice(0, 12)}`,
    productId: record.productId,
    codeHashPrefix: record.code.slice(0, 12),
    batchId: metadataString(record, 'batchId'),
    prefix: stringMetadata(record.metadata.prefix),
    maskedCode: stringMetadata(record.metadata.maskedCode),
    entitlement: record.entitlement,
    creditsAmount: record.creditsAmount,
    creditsUnit: record.creditsUnit,
    maxRedemptions: record.maxRedemptions,
    status: redeemCodeStatus(record),
    expiresAt: record.expiresAt,
    metadata: commercialAdminMetadata(record.metadata),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toAdminRedeemRedemption(
  record: RuntimeStoreRedeemRedemption
): AdminCommercialRedeemRedemption {
  return {
    id: record.id,
    productId: record.productId,
    codeHashPrefix: record.code.slice(0, 12),
    codeId: metadataString(record, 'codeId'),
    subject: adminSubjectFromStoredUserId(record.userId),
    entitlement: record.entitlement,
    creditsAmount: record.creditsAmount,
    creditsUnit: record.creditsUnit,
    idempotencyKey: record.idempotencyKey,
    metadata: commercialAdminMetadata(record.metadata),
    createdAt: record.createdAt,
  };
}

function toAdminRedeemAttempt(record: RuntimeStoreAuditRecord): AdminCommercialRedeemAttempt {
  const metadata = metadataRecord(record.metadata);
  const subject = metadataRecord(metadata.subject);
  const subjectType = stringMetadata(subject.type) as AdminCommercialSubjectView['type'] | undefined;
  const subjectId = stringMetadata(subject.id);
  const codeHash = stringMetadata(metadata.codeHash);
  return {
    id: record.id,
    productId: record.productId,
    codeHashPrefix: codeHash?.slice(0, 12),
    subject: adminSubjectFromParts(subjectType, subjectId),
    ok: metadata.ok === true,
    reason: stringMetadata(metadata.reason),
    metadata: commercialAdminMetadata(metadata),
    createdAt: record.createdAt,
  };
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function applyConnectionCallLogRetention(logs: readonly RuntimeStoreAuditRecord[]): {
  visibleLogs: RuntimeStoreAuditRecord[];
  retention: AdminConnectionLogRetentionView;
} {
  const connectionLogs = logs.filter((record) => record.type.startsWith('admin.connection.'));
  const marker = connectionLogs
    .filter((record) => record.type === 'admin.connection.retention_applied')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const cutoff = marker ? stringMetadata(marker.metadata.cutoff) : undefined;
  const retentionDays = marker ? numberMetadata(marker.metadata.retentionDays) : undefined;
  const visibleLogs = cutoff
    ? connectionLogs.filter(
        (record) =>
          record.type === 'admin.connection.retention_applied' || record.createdAt > cutoff
      )
    : connectionLogs;

  return {
    visibleLogs,
    retention: {
      retentionDays,
      cutoff,
      appliedAt: marker?.createdAt,
      hiddenCount: connectionLogs.length - visibleLogs.length,
      visibleCount: visibleLogs.length,
    },
  };
}

function policyFromAuditMetadata(metadata: Record<string, unknown>) {
  const policy = metadataRecord(metadata.policy);
  const connectionId = stringMetadata(policy.connectionId) ?? stringMetadata(metadata.connectionId);
  if (!connectionId) {
    return null;
  }
  return {
    connectionId,
    service: stringMetadata(policy.service) ?? 'custom',
    provider: stringMetadata(policy.provider) ?? 'custom',
    moduleId: stringMetadata(policy.moduleId),
    workspaceId:
      typeof policy.workspaceId === 'string' || policy.workspaceId === null
        ? policy.workspaceId
        : DEFAULT_HOST_WORKSPACE_ID,
    environment:
      stringMetadata(policy.environment) ??
      process.env.PLOYKIT_ENV ??
      process.env.NODE_ENV ??
      'development',
    ownerType: normalizeConnectionOwnerType(stringMetadata(policy.ownerType)),
    scopeType: normalizeConnectionScopeType(stringMetadata(policy.scopeType)),
    authType: normalizeConnectionAuthType(stringMetadata(policy.authType)),
    credentialRef: normalizeCredentialRef(stringMetadata(policy.credentialRef)),
    secretRefs: normalizeSecretRefs({
      secretSource: stringMetadata(policy.credentialRef),
      secretRefs: stringRecord(policy.secretRefs),
    }),
    baseUrl: normalizeConnectionUrl(stringMetadata(policy.baseUrl)),
    timeoutMs: boundedConnectionNumber(numberMetadata(policy.timeoutMs), 8000, 100, 120_000),
    retry: stringMetadata(policy.retry) ?? '2 attempts / exponential',
    maxResponseBytes: boundedConnectionNumber(
      numberMetadata(policy.maxResponseBytes),
      512 * 1024,
      1024,
      50 * 1024 * 1024
    ),
    healthCheck: stringMetadata(policy.healthCheck) ?? 'provider readiness',
    actorClaims: stringMetadata(policy.actorClaims) ?? 'system',
  };
}

function rowFromConnectionPolicy(
  policy: NonNullable<ReturnType<typeof policyFromAuditMetadata>>,
  createdAt: string
): AdminServiceConnectionRow {
  return {
    id: policy.connectionId,
    source: 'custom',
    moduleId: policy.moduleId,
    service: policy.service,
    provider: policy.provider,
    status: 'warning',
    required: false,
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    workspaceId: policy.workspaceId,
    authType: policy.authType,
    secretSource: policy.credentialRef,
    secretRefs: policy.secretRefs,
    baseUrl: policy.baseUrl,
    timeoutMs: policy.timeoutMs,
    retry: policy.retry,
    maxResponseBytes: policy.maxResponseBytes,
    healthCheck: policy.healthCheck,
    detail: 'Custom service connection created from Admin operations.',
    actorClaims: policy.actorClaims,
    policyUpdatedAt: createdAt,
  };
}

function applyConnectionPolicy(
  row: AdminServiceConnectionRow,
  policy: NonNullable<ReturnType<typeof policyFromAuditMetadata>>,
  updatedAt: string
): AdminServiceConnectionRow {
  return {
    ...row,
    service: policy.service,
    provider: policy.provider,
    moduleId: policy.moduleId ?? row.moduleId,
    workspaceId: policy.workspaceId,
    environment: policy.environment,
    ownerType: policy.ownerType,
    scopeType: policy.scopeType,
    authType: policy.authType,
    secretSource: policy.credentialRef,
    secretRefs: policy.secretRefs,
    baseUrl: policy.baseUrl,
    timeoutMs: policy.timeoutMs,
    retry: policy.retry,
    maxResponseBytes: policy.maxResponseBytes,
    healthCheck: policy.healthCheck,
    actorClaims: policy.actorClaims,
    policyUpdatedAt: updatedAt,
    detail: row.detail.includes('policy updated by admin')
      ? row.detail
      : `${row.detail}; policy updated by admin`,
  };
}

function rowFromServiceConnection(record: RuntimeStoreServiceConnectionRecord): AdminServiceConnectionRow {
  const health = metadataRecord(record.health);
  const statusFromHealth =
    health.status === 'ready' || health.status === 'warning' || health.status === 'blocked'
      ? (health.status as AdminServiceConnectionStatus)
      : undefined;
  return {
    id: record.connectionId,
    source: record.moduleId ? 'module' : 'custom',
    moduleId: record.moduleId ?? undefined,
    service: record.service,
    provider: record.provider,
    status:
      record.status === 'disabled' || record.status === 'blocked'
        ? record.status
        : statusFromHealth ?? 'warning',
    required: Boolean(health.required),
    environment: record.environment ?? process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    ownerType: normalizeConnectionOwnerType(stringMetadata(record.ownerType)),
    scopeType: normalizeConnectionScopeType(stringMetadata(record.scopeType)),
    workspaceId: record.workspaceId ?? undefined,
    authType: normalizeConnectionAuthType(stringMetadata(record.authType)),
    secretSource: stringMetadata(record.secretRefs.credential) ?? 'none',
    secretRefs: record.secretRefs,
    baseUrl: stringMetadata(record.config.baseUrl) ?? 'local://host-runtime',
    timeoutMs: numberMetadata(record.config.timeoutMs) ?? 8000,
    retry: stringMetadata(record.config.retry) ?? '2 attempts / exponential',
    maxResponseBytes: numberMetadata(record.config.maxResponseBytes) ?? 512 * 1024,
    healthCheck: stringMetadata(record.config.healthCheck) ?? 'provider readiness',
    detail: stringMetadata(record.config.detail) ?? 'Service connection from typed store.',
    actorClaims: stringMetadata(record.config.actorClaims) ?? 'system',
    policyUpdatedAt: record.updatedAt,
    lastTestAt: stringMetadata(health.lastTestAt),
    lastError: stringMetadata(health.lastError),
  };
}

function rowFromResourceBinding(record: RuntimeStoreResourceBindingRecord): AdminServiceConnectionRow {
  const metadata = metadataRecord(record.metadata);
  const health = metadataRecord(metadata.health);
  const serviceConnection = metadataRecord(metadata.serviceConnection);
  const status =
    record.status === 'disabled'
      ? 'disabled'
      : health.status === 'ready' || health.status === 'warning' || health.status === 'blocked'
        ? (health.status as AdminServiceConnectionStatus)
        : 'warning';
  const connectionId =
    stringMetadata(serviceConnection.connectionId) ?? stringMetadata(metadata.serviceConnectionId);
  return {
    id: record.moduleId ? `${record.moduleId}:resource:${record.name}` : `shared:resource:${record.name}`,
    source: record.moduleId ? 'module' : 'custom',
    moduleId: record.moduleId ?? undefined,
    service: record.name,
    provider: record.kind ?? stringMetadata(serviceConnection.provider) ?? 'resource',
    status,
    required: Boolean(metadata.required),
    environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    ownerType: record.moduleId ? 'module' : 'workspace',
    scopeType: record.workspaceId ? 'workspace' : 'global',
    workspaceId: record.workspaceId ?? undefined,
    authType: 'none',
    secretSource: connectionId ? `connection:${connectionId}` : 'resource-binding',
    secretRefs: {},
    baseUrl: connectionId ? `service-connection://${connectionId}` : `resource://${record.kind ?? 'binding'}`,
    timeoutMs: numberMetadata(metadata.timeoutMs) ?? 8000,
    retry: stringMetadata(metadata.retry) ?? 'host policy',
    maxResponseBytes: numberMetadata(metadata.maxResponseBytes) ?? 512 * 1024,
    healthCheck: stringMetadata(metadata.healthCheck) ?? 'resource binding health',
    detail:
      stringMetadata(metadata.detail) ??
      (connectionId
        ? `Resource binding linked to service connection ${connectionId}.`
        : 'Resource binding from typed store.'),
    actorClaims: stringMetadata(metadata.actorClaims) ?? 'module',
    policyUpdatedAt: record.updatedAt,
    lastTestAt: stringMetadata(health.lastTestAt),
    lastError: stringMetadata(health.lastError),
  };
}

function serviceConnectionStoreInput(
  session: ModuleHostSession,
  row: AdminServiceConnectionRow,
  status: 'active' | 'disabled' = row.status === 'disabled' ? 'disabled' : 'active'
) {
  return {
    productId: DEMO_PRODUCT_ID,
    workspaceId: row.workspaceId ?? session.workspaceId ?? null,
    moduleId: row.moduleId ?? null,
    actorId: session.actorId ?? session.user?.id ?? null,
    connectionId: row.id,
    service: row.service,
    provider: row.provider,
    status,
    environment: row.environment,
    ownerType: row.ownerType,
    scopeType: row.scopeType,
    authType: row.authType,
    config: {
      baseUrl: row.baseUrl,
      timeoutMs: row.timeoutMs,
      retry: row.retry,
      maxResponseBytes: row.maxResponseBytes,
      healthCheck: row.healthCheck,
      actorClaims: row.actorClaims,
      detail: row.detail,
    },
    secretRefs:
      Object.keys(row.secretRefs).length > 0
        ? row.secretRefs
        : {
            credential: row.secretSource,
          },
    health: {
      status: row.status,
      required: row.required,
      lastTestAt: row.lastTestAt,
      lastError: row.lastError,
    },
    metadata: {
      source: row.source,
    },
  };
}

function hostConnectionFromReadiness(item: HostProviderReadiness): AdminServiceConnectionRow {
  const providerId = normalizeProviderId(item.id);
  return {
    id: `host:${item.id}`,
    source: 'host',
    service: item.id,
    provider: item.mode,
    status: item.status,
    required: item.status === 'blocked',
    environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
    ownerType: 'system',
    scopeType: 'global',
    authType: inferAuthType(providerId),
    secretSource: inferSecretSource(providerId),
    secretRefs: {
      credential: inferSecretSource(providerId),
    },
    baseUrl: inferBaseUrl(providerId),
    timeoutMs: 8000,
    retry: '2 attempts / exponential',
    maxResponseBytes: 512 * 1024,
    healthCheck: item.id === 'runtime-store' ? 'select 1' : 'provider readiness',
    detail: item.detail,
  };
}

function applyConnectionAuditState(
  rows: AdminServiceConnectionRow[],
  logs: readonly RuntimeStoreAuditRecord[]
): AdminServiceConnectionRow[] {
  const logsByConnection = new Map<string, RuntimeStoreAuditRecord[]>();
  for (const log of logs
    .filter((record) => record.type.startsWith('admin.connection.'))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const connectionId = String(log.metadata.connectionId ?? '');
    if (connectionId) {
      logsByConnection.set(connectionId, [...(logsByConnection.get(connectionId) ?? []), log]);
    }
  }

  return rows.map((row) => {
    const rowLogs = logsByConnection.get(row.id);
    if (!rowLogs?.length) {
      return row;
    }
    let next: AdminServiceConnectionRow = { ...row };
    for (const log of rowLogs) {
      if (log.type === 'admin.connection.created' || log.type === 'admin.connection.updated') {
        const policy = policyFromAuditMetadata(log.metadata);
        if (policy && policy.connectionId === row.id) {
          next = applyConnectionPolicy(next, policy, log.createdAt);
        }
      }
      if (log.type === 'admin.connection.disabled') {
        next = {
          ...next,
          status: 'disabled',
          detail: next.detail.includes('disabled by admin')
            ? next.detail
            : `${next.detail}; disabled by admin`,
        };
      }
      if (log.type === 'admin.connection.enabled') {
        next = {
          ...next,
          status: row.status,
          detail: row.detail,
        };
      }
      if (log.type === 'admin.connection.tested') {
        next = {
          ...next,
          lastTestAt: log.createdAt,
          lastError:
            log.metadata.result === 'failed' ? String(log.metadata.error ?? 'test failed') : undefined,
        };
      }
      if (log.type === 'admin.connection.secret_rotated') {
        next = {
          ...next,
          secretSource: '[REDACTED]',
        };
      }
    }
    return next;
  });
}

function customConnectionRowsFromAudit(
  logs: readonly RuntimeStoreAuditRecord[]
): AdminServiceConnectionRow[] {
  const created = new Map<string, RuntimeStoreAuditRecord>();
  for (const log of logs
    .filter((record) => record.type === 'admin.connection.created')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    const policy = policyFromAuditMetadata(log.metadata);
    if (policy?.connectionId) {
      created.set(policy.connectionId, log);
    }
  }
  return [...created.values()]
    .map((log) => {
      const policy = policyFromAuditMetadata(log.metadata);
      return policy ? rowFromConnectionPolicy(policy, log.createdAt) : null;
    })
    .filter((row): row is AdminServiceConnectionRow => Boolean(row));
}

function buildServiceConnectionRows(input: {
  contracts: readonly ModuleRuntimeContract[];
  providerReadiness: readonly HostProviderReadiness[];
  storedConnections: readonly RuntimeStoreServiceConnectionRecord[];
  storedResourceBindings: readonly RuntimeStoreResourceBindingRecord[];
}): AdminServiceConnectionRow[] {
  const readinessByProvider = new Map(
    input.providerReadiness.map((item) => [normalizeProviderId(item.id), item])
  );
  const rows: AdminServiceConnectionRow[] = input.providerReadiness.map(hostConnectionFromReadiness);
  const storedRows = input.storedConnections.map(rowFromServiceConnection);
  const storedBindingRows = input.storedResourceBindings.map(rowFromResourceBinding);

  for (const contract of input.contracts) {
    for (const [name, requirement] of Object.entries(contract.serviceRequirements)) {
      const providerId = normalizeProviderId(requirement.provider ?? name);
      const readiness = readinessByProvider.get(providerId);
      const status: AdminServiceConnectionStatus = readiness
        ? readiness.status
        : requirement.required
          ? 'blocked'
          : 'warning';
      rows.push({
        id: `${contract.id}:service:${name}`,
        source: 'module',
        moduleId: contract.id,
        service: name,
        provider: requirement.provider ?? providerId,
        status,
        required: Boolean(requirement.required),
        environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
        ownerType: 'module',
        scopeType: 'workspace',
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        authType: inferAuthType(providerId),
        secretSource: inferSecretSource(providerId),
        secretRefs: {},
        baseUrl: inferBaseUrl(providerId),
        timeoutMs: 8000,
        retry: '2 attempts / exponential',
        maxResponseBytes: 512 * 1024,
        healthCheck: readiness?.id ?? 'declaration only',
        detail: [requirement.description, readiness?.detail ?? 'no provider binding found']
          .filter(Boolean)
          .join(' · '),
      });
    }

    for (const [name, binding] of Object.entries(contract.resourceBindings)) {
      const providerId = normalizeProviderId(binding.kind);
      rows.push({
        id: `${contract.id}:resource:${name}`,
        source: 'module',
        moduleId: contract.id,
        service: name,
        provider: binding.kind,
        status: binding.required ? 'blocked' : 'warning',
        required: Boolean(binding.required),
        environment: process.env.PLOYKIT_ENV ?? process.env.NODE_ENV ?? 'development',
        ownerType: 'module',
        scopeType: 'workspace',
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        authType: 'none',
        secretSource: 'resource-binding',
        secretRefs: {},
        baseUrl: `resource://${binding.kind}`,
        timeoutMs: 8000,
        retry: 'host policy',
        maxResponseBytes: 512 * 1024,
        healthCheck: 'resource binding exists',
        detail: binding.description ?? 'Resource binding declared by module contract.',
      });
    }
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const row of [...storedRows, ...storedBindingRows]) {
    byId.set(row.id, {
      ...(byId.get(row.id) ?? row),
      ...row,
    });
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function connectionSummary(rows: readonly AdminServiceConnectionRow[]) {
  return rows.reduce<Record<AdminServiceConnectionStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { ready: 0, warning: 0, blocked: 0, disabled: 0 }
  );
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true' || value === '1' || value === 'yes';
  }
  return fallback;
}

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), min), max) : fallback;
}

function adminSettingSource(source: HostSettingValueSource): AdminHostSettingSource {
  return source === 'store' ? 'admin-override' : source;
}

function adminSettingsSource(source: HostSettingValueSource | 'mixed'): AdminHostSettingsSource {
  return source === 'store' ? 'admin-override' : source;
}

function settingsUpdateValues(
  input: Partial<HostRuntimeSettings>
): Partial<HostRuntimeSettings> {
  return Object.fromEntries(
    HOST_SETTINGS_SCHEMA.map((schema) => {
      const value = input[schema.key];
      return [schema.key, typeof value === 'string' ? value.trim() : value];
    }).filter(([, value]) => value !== undefined)
  ) as Partial<HostRuntimeSettings>;
}

const EMAIL_ADDRESS_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rejectInvalidSetting(key: HostSettingKey): never {
  throw new Error(`ADMIN_SETTINGS_INVALID:${key}`);
}

function assertStringSetting(
  key: HostSettingKey,
  value: unknown,
  options: { maxLength: number; email?: boolean; timezone?: boolean }
): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > options.maxLength) {
    rejectInvalidSetting(key);
  }
  if (options.email && (!EMAIL_ADDRESS_PATTERN.test(value) || value.length > 254)) {
    rejectInvalidSetting(key);
  }
  if (options.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    } catch {
      rejectInvalidSetting(key);
    }
  }
}

function assertNumberSetting(
  key: HostSettingKey,
  value: unknown,
  min: number,
  max: number
): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Math.floor(value) !== value ||
    value < min ||
    value > max
  ) {
    rejectInvalidSetting(key);
  }
}

function assertBooleanSetting(key: HostSettingKey, value: unknown): void {
  if (typeof value !== 'boolean') {
    rejectInvalidSetting(key);
  }
}

function assertEnumSetting(
  key: HostSettingKey,
  value: unknown,
  allowedValues: readonly string[]
): void {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    rejectInvalidSetting(key);
  }
}

function assertAdminHostSettingsUpdate(
  input: Partial<HostRuntimeSettings>
): void {
  if (input.siteName !== undefined) {
    assertStringSetting('siteName', input.siteName, { maxLength: 120 });
  }
  if (input.supportEmail !== undefined) {
    assertStringSetting('supportEmail', input.supportEmail, { maxLength: 254, email: true });
  }
  if (input.defaultLocale !== undefined) {
    if (typeof input.defaultLocale !== 'string' || !isSupportedLanguage(input.defaultLocale)) {
      rejectInvalidSetting('defaultLocale');
    }
  }
  if (input.timezone !== undefined) {
    assertStringSetting('timezone', input.timezone, { maxLength: 64, timezone: true });
  }
  if (input.requireEmailVerification !== undefined) {
    assertBooleanSetting('requireEmailVerification', input.requireEmailVerification);
  }
  if (input.sessionMaxAgeDays !== undefined) {
    assertNumberSetting('sessionMaxAgeDays', input.sessionMaxAgeDays, 1, 365);
  }
  if (input.passwordMinLength !== undefined) {
    assertNumberSetting('passwordMinLength', input.passwordMinLength, 8, 128);
  }
  if (input.emailProvider !== undefined) {
    assertEnumSetting('emailProvider', input.emailProvider, ['disabled', 'log', 'webhook']);
  }
  if (input.fromEmail !== undefined) {
    assertStringSetting('fromEmail', input.fromEmail, { maxLength: 254, email: true });
  }
  if (input.fromName !== undefined) {
    assertStringSetting('fromName', input.fromName, { maxLength: 80 });
  }
  if (input.digestFrequency !== undefined) {
    assertEnumSetting('digestFrequency', input.digestFrequency, [
      'immediate',
      'daily',
      'weekly',
      'off',
    ]);
  }
}

function settingValueForAudit(value: unknown): unknown {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? value
    : null;
}

function settingsChangeSummary(
  current: AdminHostSettingsView,
  next: HostRuntimeSettings
) {
  return HOST_SETTINGS_SCHEMA
    .map((schema) => {
      const previousValue = current[schema.key];
      const nextValue = next[schema.key];
      if (previousValue === nextValue) {
        return null;
      }
      return {
        key: schema.key,
        previous: settingValueForAudit(previousValue),
        next: settingValueForAudit(nextValue),
        sourceBefore: current.fieldSources[schema.key],
        sourceAfter: current.fieldSources[schema.key] === 'env' ? 'env' : 'admin-override',
        risk: schema.risk,
        requiresRestart: schema.requiresRestart,
        scope: schema.scope,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function highestSettingsRisk(changes: readonly { risk: HostSettingRisk }[]): HostSettingRisk {
  if (changes.some((change) => change.risk === 'high')) {
    return 'high';
  }
  if (changes.some((change) => change.risk === 'medium')) {
    return 'medium';
  }
  return 'low';
}

export async function getAdminHostSettingsView(): Promise<AdminHostSettingsView> {
  const hostRuntime = await getHostRuntime();
  const settings = await readHostSettingsView(hostRuntime.runtimeStore.store, DEMO_PRODUCT_ID);
  const fieldSources = Object.fromEntries(
    Object.entries(settings.fieldSources).map(([key, source]) => [
      key,
      adminSettingSource(source),
    ])
  ) as Record<HostSettingKey, AdminHostSettingSource>;
  const fields: AdminHostSettingsFieldView[] = settings.fields.map((field) => ({
    ...field,
    defaultValue: field.defaultValue,
    source: adminSettingSource(field.source),
  }));
  return {
    siteName: settings.siteName,
    supportEmail: settings.supportEmail,
    defaultLocale: settings.defaultLocale,
    timezone: settings.timezone,
    requireEmailVerification: settings.requireEmailVerification,
    sessionMaxAgeDays: settings.sessionMaxAgeDays,
    passwordMinLength: settings.passwordMinLength,
    emailProvider: settings.emailProvider,
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    digestFrequency: settings.digestFrequency,
    source: adminSettingsSource(settings.source),
    fieldSources,
    fields,
    version: settings.version,
    updatedAt: settings.updatedAt,
  };
}

export type AdminHostSettingsUpdateInput = Partial<HostRuntimeSettings> & {
  reason?: string;
};

export async function updateAdminHostSettings(
  session: ModuleHostSession,
  input: AdminHostSettingsUpdateInput
) {
  assertAdminSession(session);
  const current = await getAdminHostSettingsView();
  const { reason, ...rawSettingsInput } = input;
  const settingsInput = settingsUpdateValues(rawSettingsInput);
  const writableSettingsInput = Object.fromEntries(
    Object.entries(settingsInput).filter(
      ([key]) => current.fieldSources[key as HostSettingKey] !== 'env'
    )
  ) as Partial<HostRuntimeSettings>;
  assertAdminHostSettingsUpdate(writableSettingsInput);
  const next: AdminHostSettingsView = {
    ...current,
    ...writableSettingsInput,
    requireEmailVerification: booleanSetting(
      writableSettingsInput.requireEmailVerification,
      current.requireEmailVerification
    ),
    sessionMaxAgeDays: numberSetting(
      writableSettingsInput.sessionMaxAgeDays,
      current.sessionMaxAgeDays,
      1,
      365
    ),
    passwordMinLength: numberSetting(
      writableSettingsInput.passwordMinLength,
      current.passwordMinLength,
      8,
      128
    ),
    digestFrequency: writableSettingsInput.digestFrequency ?? current.digestFrequency,
    source: 'admin-override',
    updatedAt: new Date().toISOString(),
  };
  const diff = settingsChangeSummary(current, next);
  const hostRuntime = await getHostRuntime();
  const saved = await writeHostSettings(hostRuntime.runtimeStore.store, {
    productId: DEMO_PRODUCT_ID,
    workspaceId: null,
    actorId: session.actorId ?? session.user?.id,
    settings: next,
  });
  const savedView = await getAdminHostSettingsView();
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.settings.updated',
    metadata: {
      fields: diff.map((change) => change.key),
      settingId: saved.id,
      version: saved.version,
      reason,
      risk: highestSettingsRisk(diff),
      requiresRestart: diff.some((change) => change.requiresRestart),
      ignoredEnvFields: Object.keys(settingsInput).filter(
        (key) => current.fieldSources[key as HostSettingKey] === 'env'
      ),
      diff,
    },
  });
  invalidateHostRuntime();
  return savedView;
}

export async function getAdminRunDetail(runId: string): Promise<AdminRunDetailView> {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );
  const run = await hostRuntime.runtimeStore.store.getRun(runId);
  if (!run) {
    return { run: null, outbox: [], deliveries: [], usage: [], files: [], artifacts: [], audit: [] };
  }

  const productId = run.productId ?? DEMO_PRODUCT_ID;
  const [outbox, usage, files, artifacts, audit] = await Promise.all([
    hostRuntime.runtimeStore.store.listOutbox({
      productId,
    }),
    hostRuntime.runtimeStore.store.listUsage({
      productId,
      moduleId: run.moduleId,
    }),
    hostRuntime.runtimeStore.store.listFiles({
      productId,
      moduleId: run.moduleId,
      runId: run.id,
      includeDeleted: true,
    }),
    listHostWorkerArtifactsForRun({
      moduleId: run.moduleId,
      runId: run.id,
    }),
    hostRuntime.runtimeStore.store.listAudit({
      productId,
      moduleId: run.moduleId,
    }),
  ]);

  const relatedOutbox = outbox.filter(
    (record) =>
      record.moduleId === run.moduleId &&
      (record.name === run.name ||
        record.name.endsWith(`:${run.name}`) ||
        valueHasRunId(record.payload, run.id) ||
        valueHasRunId(record.metadata, run.id) ||
        outboxRunId(record) === run.id)
  );
  const deliveryGroups = await Promise.all([
    hostRuntime.runtimeStore.store.listDeliveries({
      productId,
      runId: run.id,
    }),
    ...relatedOutbox.map((record) =>
      hostRuntime.runtimeStore.store.listDeliveries({
        productId,
        outboxId: record.id,
      })
    ),
  ]);
  const relatedDeliveries = uniqueById(deliveryGroups.flat());
  const relatedUsage = usage.filter(
    (record) =>
      valueHasRunId(record.metadata, run.id) ||
      (Boolean(run.idempotencyKey) && record.idempotencyKey === run.idempotencyKey)
  );
  const relatedAudit = audit.filter(
    (record) =>
      valueHasRunId(record.metadata, run.id) ||
      (record.type.startsWith('admin.run.') && record.metadata.runId === run.id)
  );

  return {
    run,
    outbox: relatedOutbox,
    deliveries: relatedDeliveries,
    usage: relatedUsage,
    files,
    artifacts,
    audit: relatedAudit,
  };
}

export async function getAdminOutboxDetail(outboxId: string): Promise<AdminOutboxDetailView> {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );
  const outbox =
    (await hostRuntime.runtimeStore.store.listOutbox({ productId: DEMO_PRODUCT_ID })).find(
      (record) => record.id === outboxId
    ) ?? null;
  if (!outbox) {
    return { outbox: null, receipts: [], deliveries: [], audit: [] };
  }

  const receiptId = outboxReceiptId(outbox);
  const moduleReceipts = outbox.moduleId
    ? await hostRuntime.runtimeStore.store.listWebhookReceipts({
        productId: outbox.productId,
        moduleId: outbox.moduleId,
      })
    : [];
  const receipts = moduleReceipts.filter(
    (receipt) =>
      receipt.id === receiptId ||
      valueHasReceiptId(outbox.payload, receipt.id) ||
      valueHasReceiptId(outbox.metadata, receipt.id)
  );
  const receiptIds = new Set(receipts.map((receipt) => receipt.id));
  const deliveryGroups = await Promise.all([
    hostRuntime.runtimeStore.store.listDeliveries({
      productId: outbox.productId,
      outboxId: outbox.id,
    }),
    ...receipts.map((receipt) =>
      hostRuntime.runtimeStore.store.listDeliveries({
        productId: outbox.productId,
        receiptId: receipt.id,
      })
    ),
  ]);
  const deliveries = uniqueById(deliveryGroups.flat());
  const audit = (
    await hostRuntime.runtimeStore.store.listAudit({
      productId: outbox.productId,
      moduleId: outbox.moduleId ?? undefined,
    })
  )
    .filter(
      (record) =>
        record.metadata.outboxId === outbox.id ||
        (typeof record.metadata.receiptId === 'string' && receiptIds.has(record.metadata.receiptId))
    )
    .slice(0, 50);

  return { outbox, receipts, deliveries, audit };
}

export async function getAdminFilesView(): Promise<AdminFilesView> {
  const hostRuntime = await getHostRuntime();
  const [files, storage, reconcile] = await Promise.all([
    hostRuntime.runtimeStore.store.listFiles({
      productId: DEMO_PRODUCT_ID,
      includeDeleted: true,
    }),
    getHostFileStorageStatus(),
    reconcileAdminFileStorage({ productId: DEMO_PRODUCT_ID, limit: 200 }),
  ]);

  return { files, storage, reconcile };
}

function buildAdminFileAccess(file: RuntimeStoreFileRecord): AdminFileAccessView {
  if (file.status !== 'ready' && file.status !== 'published') {
    return {
      openUrl: null,
      downloadUrl: null,
      mediaGateway: 'blocked',
      reason: `File status ${file.status} is not readable through media gateway.`,
    };
  }
  return {
    openUrl: `/api/media/${file.id}`,
    downloadUrl: `/api/media/${file.id}?download=1`,
    mediaGateway: file.status === 'published' || file.visibility === 'public' ? 'public' : 'signed',
    reason:
      file.status === 'published' || file.visibility === 'public'
        ? 'Public file still resolves through host media gateway; storage key is not exposed.'
        : 'Private file requires a signed media gateway token generated by the host.',
  };
}

function fileObjectView(
  file: RuntimeStoreFileRecord,
  head: ModuleFileStorageHead | null,
  checkedAt: string
): AdminFileStorageObjectView {
  if (!head) {
    return {
      status: 'missing',
      key: file.storageKey,
      checkedAt,
      sizeBytes: null,
      checksum: null,
      contentType: null,
      metadata: {},
    };
  }
  return {
    status: 'present',
    key: file.storageKey,
    checkedAt,
    sizeBytes: head.sizeBytes,
    checksum: head.checksum,
    contentType: head.contentType ?? null,
    metadata: head.metadata,
  };
}

async function inspectAdminFileStorageObject(
  file: RuntimeStoreFileRecord
): Promise<AdminFileStorageObjectView> {
  const checkedAt = new Date().toISOString();
  try {
    const storage = await getHostFileStorage();
    return fileObjectView(file, await storage.storage.head(file.storageKey), checkedAt);
  } catch (error) {
    return {
      status: 'error',
      key: file.storageKey,
      checkedAt,
      sizeBytes: null,
      checksum: null,
      contentType: null,
      metadata: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildAdminFileCleanup(input: {
  file: RuntimeStoreFileRecord;
  storageObject: AdminFileStorageObjectView;
  cleanupAudit: readonly RuntimeStoreAuditRecord[];
}): AdminFileCleanupView {
  const latestCleanupAt =
    [...input.cleanupAudit].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
      ?.createdAt ?? null;
  const physicalObjectPresent =
    input.storageObject.status === 'error' ? null : input.storageObject.status === 'present';
  const eligible = input.file.status === 'deleted';
  return {
    eligible,
    physicalObjectPresent,
    latestCleanupAt,
    command: 'npm run host:files-cleanup-smoke',
    reason: eligible
      ? physicalObjectPresent
        ? 'Deleted metadata still has a physical object; cleanup can remove object bytes while keeping audit metadata.'
        : 'Deleted metadata has no physical object; cleanup is already reflected in storage.'
      : 'Only files marked deleted are eligible for physical object cleanup.',
  };
}

function fileExpectsStorageObject(file: RuntimeStoreFileRecord): boolean {
  return ['ready', 'published', 'archived', 'quarantined'].includes(file.status);
}

function reconcileFileIssue(
  file: RuntimeStoreFileRecord,
  storageObject: AdminFileStorageObjectView
): AdminFileStorageReconcileIssue {
  if (storageObject.status === 'error') {
    return 'storage-error';
  }
  if (file.status === 'deleted' && storageObject.status === 'present') {
    return 'deleted-object-present';
  }
  if (fileExpectsStorageObject(file) && storageObject.status === 'missing') {
    return 'missing-object';
  }
  if (
    storageObject.status === 'present' &&
    file.sizeBytes > 0 &&
    storageObject.sizeBytes !== null &&
    storageObject.sizeBytes !== file.sizeBytes
  ) {
    return 'size-mismatch';
  }
  if (
    storageObject.status === 'present' &&
    Boolean(file.checksum) &&
    Boolean(storageObject.checksum) &&
    storageObject.checksum !== file.checksum
  ) {
    return 'checksum-mismatch';
  }
  return 'none';
}

function reconcileItem(
  file: RuntimeStoreFileRecord,
  storageObject: AdminFileStorageObjectView
): AdminFileStorageReconcileItem {
  const issue = reconcileFileIssue(file, storageObject);
  return {
    fileId: file.id,
    name: file.name,
    moduleId: file.moduleId,
    status: file.status,
    storageKey: file.storageKey,
    issue,
    objectStatus: storageObject.status,
    metadataSizeBytes: file.sizeBytes,
    objectSizeBytes: storageObject.sizeBytes,
    metadataChecksum: file.checksum ?? null,
    objectChecksum: storageObject.checksum,
    cleanupCandidate: issue === 'deleted-object-present',
    error: storageObject.error,
  };
}

function auditRecordReferencesFile(record: RuntimeStoreAuditRecord, fileId: string): boolean {
  if (record.metadata.fileId === fileId) {
    return true;
  }
  return Array.isArray(record.metadata.fileIds) && record.metadata.fileIds.includes(fileId);
}

export async function reconcileAdminFileStorage(input: {
  productId?: string;
  limit?: number;
  orphanLimit?: number;
} = {}): Promise<AdminFileStorageReconcileReport> {
  const productId = input.productId ?? DEMO_PRODUCT_ID;
  const limit = input.limit ?? 500;
  const orphanLimit = input.orphanLimit ?? limit;
  const checkedAt = new Date().toISOString();
  const hostRuntime = await getHostRuntime();
  const storage = await getHostFileStorage();
  const files = await hostRuntime.runtimeStore.store.listFiles({
    productId,
    includeDeleted: true,
  });
  const checkedFiles = files.slice(0, limit);
  const items: AdminFileStorageReconcileItem[] = [];
  for (const file of checkedFiles) {
    items.push(reconcileItem(file, await inspectAdminFileStorageObject(file)));
  }

  const issueItems = items.filter((item) => item.issue !== 'none');
  const presentItems = items.filter((item) => item.objectStatus === 'present');
  const metadataKeys = new Set(files.map((file) => file.storageKey));
  const listedObjects = storage.storage.list
    ? await storage.storage.list({ prefix: `${productId}/`, limit: orphanLimit })
    : [];
  const orphans: AdminFileStorageOrphanObject[] = listedObjects
    .filter((object) => !metadataKeys.has(object.key))
    .slice(0, 50)
    .map((object) => ({
      key: object.key,
      sizeBytes: object.sizeBytes,
      checksum: object.checksum,
      contentType: object.contentType ?? null,
      metadata: object.metadata,
    }));
  return {
    checkedAt,
    totalFiles: files.length,
    checkedFiles: checkedFiles.length,
    limit,
    orphanScanSupported: Boolean(storage.storage.list),
    issues: issueItems.length + orphans.length,
    presentObjects: presentItems.length,
    missingObjects: items.filter((item) => item.objectStatus === 'missing').length,
    orphanObjects: orphans.length,
    deletedObjectsPresent: items.filter((item) => item.issue === 'deleted-object-present').length,
    missingActiveObjects: items.filter((item) => item.issue === 'missing-object').length,
    sizeMismatches: items.filter((item) => item.issue === 'size-mismatch').length,
    checksumMismatches: items.filter((item) => item.issue === 'checksum-mismatch').length,
    metadataBytes: items.reduce((total, item) => total + item.metadataSizeBytes, 0),
    physicalBytes: listedObjects.length > 0
      ? listedObjects.reduce((total, item) => total + item.sizeBytes, 0)
      : presentItems.reduce((total, item) => total + (item.objectSizeBytes ?? 0), 0),
    orphanBytes: orphans.reduce((total, item) => total + item.sizeBytes, 0),
    command: 'npm run host:files-reconcile-smoke',
    items: issueItems.slice(0, 50),
    orphans,
  };
}

export async function getAdminFileDetailView(fileId: string): Promise<AdminFileDetailView> {
  const hostRuntime = await getHostRuntime();
  const file = await hostRuntime.runtimeStore.store.getFile(fileId);
  if (!file) {
    return {
      file: null,
      storage: await getHostFileStorageStatus(),
      audit: [],
      storageObject: null,
      access: null,
      cleanup: null,
    };
  }

  const [audit, cleanupAudit, storage, storageObject] = await Promise.all([
    hostRuntime.runtimeStore.store.listAudit({
      productId: file.productId,
      moduleId: file.moduleId,
    }),
    hostRuntime.runtimeStore.store.listAudit({
      productId: file.productId,
      type: 'admin.file.cleanup_deleted',
    }),
    getHostFileStorageStatus(),
    inspectAdminFileStorageObject(file),
  ]);
  return {
    file,
    storage,
    storageObject,
    access: buildAdminFileAccess(file),
    cleanup: buildAdminFileCleanup({ file, storageObject, cleanupAudit }),
    audit: uniqueById([...audit, ...cleanupAudit])
      .filter((record) => auditRecordReferencesFile(record, fileId))
      .slice(0, 50),
  };
}

export async function quarantineAdminFile(
  session: ModuleHostSession,
  fileId: string,
  reason = 'Admin quarantine'
) {
  const hostRuntime = await getHostRuntime();
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
  const file = await hostRuntime.runtimeStore.store.updateFile(fileId, {
    status: 'quarantined',
    quarantinedAt: new Date().toISOString(),
    metadata: { quarantineReason: reason },
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: file.productId,
    workspaceId: file.workspaceId,
    moduleId: file.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.file.quarantined',
    metadata: { fileId, reason },
  });
  return file;
}

export async function restoreAdminFile(session: ModuleHostSession, fileId: string) {
  const hostRuntime = await getHostRuntime();
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
  const file = await hostRuntime.runtimeStore.store.updateFile(fileId, {
    status: 'ready',
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: file.productId,
    workspaceId: file.workspaceId,
    moduleId: file.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.file.restored',
    metadata: { fileId },
  });
  return file;
}

export async function archiveAdminFile(session: ModuleHostSession, fileId: string) {
  const hostRuntime = await getHostRuntime();
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
  const file = await hostRuntime.runtimeStore.store.updateFile(fileId, {
    status: 'archived',
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: file.productId,
    workspaceId: file.workspaceId,
    moduleId: file.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.file.archived',
    metadata: { fileId },
  });
  return file;
}

export async function deleteAdminFile(session: ModuleHostSession, fileId: string) {
  const hostRuntime = await getHostRuntime();
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
  const file = await hostRuntime.runtimeStore.store.updateFile(fileId, {
    status: 'deleted',
    deletedAt: new Date().toISOString(),
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: file.productId,
    workspaceId: file.workspaceId,
    moduleId: file.moduleId,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.file.deleted',
    metadata: { fileId },
  });
  return file;
}

export async function cleanupAdminDeletedFiles(session: ModuleHostSession) {
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
  const files = await getHostFileRuntime(session);
  const deleted = await files.cleanupDeletedFiles();
  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: session.productId ?? DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'admin.file.cleanup_deleted',
    metadata: {
      deleted: deleted.length,
      fileIds: deleted.slice(0, 100).map((file) => file.id),
      storageKeys: deleted.slice(0, 100).map((file) => file.storageKey),
      truncated: deleted.length > 100,
    },
  });
  return deleted;
}

export async function bulkUpdateAdminFiles(
  session: ModuleHostSession,
  input: {
    fileIds: readonly string[];
    action: 'archive' | 'delete';
    reason?: string;
  }
) {
  assertAdminSession(session);
  const uniqueIds = [...new Set(input.fileIds.map((id) => id.trim()).filter(Boolean))].slice(0, 100);
  const results: RuntimeStoreFileRecord[] = [];
  for (const fileId of uniqueIds) {
    if (input.action === 'archive') {
      results.push(await archiveAdminFile(session, fileId));
    } else {
      results.push(await deleteAdminFile(session, fileId));
    }
  }
  const hostRuntime = await getHostRuntime();
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: session.productId ?? DEMO_PRODUCT_ID,
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: `admin.file.bulk_${input.action}`,
    metadata: {
      fileIds: uniqueIds,
      count: results.length,
      reason: input.reason ?? `Admin bulk ${input.action} files`,
    },
  });
  return results;
}

function assertAdminSession(session: ModuleHostSession) {
  if (session.user?.role !== 'admin' && !session.system) {
    throw new Error('ADMIN_OPERATION_FORBIDDEN');
  }
}

export async function grantAdminEntitlement(
  session: ModuleHostSession,
  input: {
    userId: string;
    entitlement: string;
    planId?: string;
    expiresAt?: string;
  }
) {
  assertAdminSession(session);
  const commercial = await getHostCommercialRuntime(session);
  return commercial.admin.grantEntitlement({
    session,
    userId: input.userId,
    entitlement: input.entitlement,
    planId: input.planId,
    expiresAt: input.expiresAt,
    idempotencyKey: `admin:${input.userId}:${input.entitlement}:${Date.now()}`,
    metadata: { source: 'admin-ui' },
  });
}

export async function revokeAdminEntitlement(session: ModuleHostSession, entitlementId: string) {
  assertAdminSession(session);
  const commercial = await getHostCommercialRuntime(session);
  return commercial.admin.revokeEntitlement({
    session,
    entitlementId,
    metadata: { source: 'admin-ui' },
  });
}

export async function overrideAdminEntitlement(
  session: ModuleHostSession,
  input: {
    entitlementId: string;
    status: RuntimeStoreEntitlementStatus;
    expiresAt?: string | null;
    reason?: string;
  }
) {
  assertAdminSession(session);
  const commercial = await getHostCommercialRuntime(session);
  return commercial.admin.overrideEntitlement({
    session,
    entitlementId: input.entitlementId,
    status: input.status,
    expiresAt: input.expiresAt,
    metadata: {
      source: 'admin-ui',
    },
    reason: input.reason,
  });
}

export async function getAdminCommercialView(): Promise<AdminCommercialView> {
  const hostRuntime = await getHostRuntime();
  const [
    orders,
    rawEntitlements,
    rawCredits,
    rawCreditReservations,
    rawRedeemCodes,
    rawRedeemRedemptions,
    rawRedeemAttempts,
    rawApiKeys,
    rawRiskEvents,
    rawRiskBlocks,
    catalog,
    users,
    usage,
    invoices,
    subscriptions,
  ] = await Promise.all([
    hostRuntime.runtimeStore.store.listCommercialOrders({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listEntitlements({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listCreditLedger({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listCreditReservations({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listRedeemCodes({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listRedeemRedemptions({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listAudit({
      productId: DEMO_PRODUCT_ID,
      type: 'commercial.redeem_code.attempt',
    }),
    hostRuntime.runtimeStore.store.listApiKeys({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listRiskEvents({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listRiskBlocks({ productId: DEMO_PRODUCT_ID }),
    loadHostBillingCatalog(hostRuntime.runtimeStore.store, DEMO_PRODUCT_ID),
    hostRuntime.runtimeStore.store.listHostUsers({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listUsage({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listInvoices({ productId: DEMO_PRODUCT_ID }),
    hostRuntime.runtimeStore.store.listSubscriptions({ productId: DEMO_PRODUCT_ID }),
  ]);
  const entitlements = rawEntitlements.map((grant) => {
    const normalized = normalizeRuntimeStoreEntitlementGrant(grant);
    return { ...normalized, subject: adminSubjectFromStoredUserId(normalized.userId) };
  });
  const credits = rawCredits.map((entry) => ({
    ...entry,
    subject: adminSubjectFromStoredUserId(entry.userId),
    orderId: metadataString(entry, 'orderId'),
    reservationId: metadataString(entry, 'reservationId'),
  }));
  const creditReservations = rawCreditReservations.map((reservation) => ({
    ...reservation,
    subject: adminSubjectFromStoredUserId(reservation.userId),
  }));
  const redeemCodes = rawRedeemCodes.map(toAdminRedeemCode);
  const redeemRedemptions = rawRedeemRedemptions.map(toAdminRedeemRedemption);
  const redeemAttempts = rawRedeemAttempts.map(toAdminRedeemAttempt);
  const apiKeys = rawApiKeys.map(({ keyHash: _keyHash, ...record }) => ({
    ...record,
    metadata: commercialAdminMetadata(record.metadata),
    owner: adminSubjectFromParts(record.ownerSubjectType, record.ownerSubjectId),
  }));
  const riskEvents = rawRiskEvents.map((event) => ({
    ...event,
    metadata: commercialAdminMetadata(event.metadata),
    subject: adminSubjectFromParts(event.subjectType, event.subjectId),
  }));
  const riskBlocks = rawRiskBlocks.map((block) => ({
    ...block,
    metadata: commercialAdminMetadata(block.metadata),
    subject: adminSubjectFromParts(block.subjectType, block.subjectId) ?? {
      type: block.subjectType,
      id: block.subjectId,
      label: block.subjectType === 'user' ? block.subjectId : `${block.subjectType}:${block.subjectId}`,
    },
  }));
  const planSubscribers = entitlements.reduce<Record<string, number>>((acc, grant) => {
    if (grant.status === 'active' && grant.planId) {
      acc[grant.planId] = (acc[grant.planId] ?? 0) + 1;
    }
    return acc;
  }, {});
  const planUsage = usage.reduce<Record<string, number>>((acc, record) => {
    const planId = String(record.metadata.planId ?? record.metadata.plan ?? 'unknown');
    acc[planId] = (acc[planId] ?? 0) + record.quantity;
    return acc;
  }, {});
  const capabilityNames = new Set<string>();
  for (const plan of catalog.plans) {
    for (const entitlement of plan.entitlements) {
      capabilityNames.add(entitlement);
    }
    for (const feature of plan.features) {
      capabilityNames.add(feature);
    }
    for (const limit of Object.keys(plan.limits)) {
      capabilityNames.add(`limit:${limit}`);
    }
  }
  const featureMatrix = [...capabilityNames].sort().map((capability) => ({
    capability,
    plans: Object.fromEntries(
      catalog.plans.map((plan) => [
        plan.id,
        capability.startsWith('limit:')
          ? (plan.limits[capability.slice('limit:'.length)] ?? '-')
          : plan.entitlements.includes(capability) || plan.features.includes(capability),
      ])
    ),
  }));
  const billingEvidence = await Promise.all(
    users.map(async (user) => ({
      user,
      billingAccount: await hostRuntime.runtimeStore.store.getBillingAccount(
        DEMO_PRODUCT_ID,
        user.id,
        user.workspaceId ?? null
      ),
      taxProfile: await hostRuntime.runtimeStore.store.getTaxProfile(
        DEMO_PRODUCT_ID,
        user.id,
        user.workspaceId ?? null
      ),
    }))
  );
  const settlementInvoices =
    invoices.length > 0
      ? invoices.map((invoice) => ({
          id: invoice.id,
          orderId: invoice.orderId ?? '',
          status: invoice.status,
          amount: invoice.total,
          currency: invoice.currency,
          hostedUrl: `/api/billing/invoices?id=${invoice.id}`,
          createdAt: invoice.issuedAt ?? invoice.createdAt,
        }))
      : orders
          .filter((order) => order.status === 'paid' || order.status === 'refunded')
          .map((order) => ({
            id: `invoice-${order.id}`,
            orderId: order.id,
            status: order.status === 'refunded' ? 'refunded' : 'paid',
            amount: order.amount,
            currency: order.currency,
            hostedUrl: `/api/billing/invoices?id=invoice-${order.id}`,
            createdAt: order.updatedAt,
          }));
  const settlementSubscriptions =
    subscriptions.length > 0
      ? subscriptions.map((subscription) => ({
          id: subscription.id,
          userId: subscription.userId,
          planId: subscription.planId,
          entitlement: String(subscription.metadata.entitlement ?? subscription.planId),
          status: subscription.status,
          source: subscription.provider ?? 'runtime-store',
          currentPeriodEnd: subscription.currentPeriodEnd ?? undefined,
        }))
      : entitlements.map((grant) => ({
          id: `subscription-${grant.id}`,
          userId: grant.userId,
          planId: grant.planId ?? 'none',
          entitlement: grant.entitlement,
          status: grant.status,
          source: grant.source,
          currentPeriodEnd: grant.expiresAt,
        }));
  const paymentMethods = billingEvidence.flatMap(({ user, billingAccount }) => {
    const billing = metadataRecord(user.metadata.billing);
    const accountMethods = Array.isArray(billingAccount?.paymentMethods) ? billingAccount.paymentMethods : [];
    const methods = accountMethods.length > 0 ? accountMethods : Array.isArray(billing.paymentMethods) ? billing.paymentMethods : [];
    return methods
      .filter((method): method is Record<string, unknown> => Boolean(method && typeof method === 'object'))
      .map((method) => ({
        id: String(method.id ?? `method-${user.id}`),
        provider: String(method.provider ?? 'local'),
        type: String(method.type ?? 'local'),
        label: String(method.label ?? 'Payment method'),
        status: String(method.status ?? 'active'),
        last4: typeof method.last4 === 'string' ? method.last4 : undefined,
        userId: user.id,
      }));
  });
  const taxProfiles = billingEvidence
    .map(({ user, taxProfile }) => {
      const billingTax = metadataRecord(user.metadata.billing).taxProfile;
      const source = { ...metadataRecord(billingTax), ...metadataRecord(taxProfile?.profile) };
      const taxId =
        typeof source.taxId === 'string'
          ? source.taxId
          : typeof source.vatId === 'string'
            ? source.vatId
            : typeof source.businessId === 'string'
              ? source.businessId
              : undefined;
      return {
        userId: user.id,
        company: typeof source.company === 'string' ? source.company : undefined,
        country: typeof source.country === 'string' ? source.country : undefined,
        taxIdMasked: taxId ? `***${taxId.slice(-4)}` : undefined,
      };
    })
    .filter((profile) => profile.company || profile.country || profile.taxIdMasked);

  return {
    orders,
    entitlements,
    credits,
    creditReservations,
    redeemCodes,
    redeemRedemptions,
    redeemAttempts,
    apiKeys,
    riskEvents,
    riskBlocks,
    catalog,
    planSubscribers,
    planUsage,
    featureMatrix,
    invoices: settlementInvoices,
    subscriptions: settlementSubscriptions,
    paymentMethods,
    taxProfiles,
  };
}

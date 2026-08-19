import {
  PermissionRegistry,
  SystemOnlyPermissions,
  validateModuleDefinition,
  type ModuleDiagnostic,
} from '@ploykit/module-sdk';
import { countMissingRequiredModuleRequirements } from '@host/lib/admin/operations-center';
import type {
  ModuleCatalogModuleState,
  ModuleCatalogModuleStatus,
} from '@/lib/module-runtime/catalog';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleMapReleaseMetadata } from '@/lib/module-runtime/loader/module-map-types';
import type { ModuleRunRecord } from '@/lib/module-runtime/runs/run-runtime';
import type {
  RuntimeStoreFileRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreUsageRecord,
  RuntimeStoreWebhookReceipt,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { MODULE_MAP_ARTIFACT } from '@/lib/module-map';

export type AdminModuleRuntimeState = ModuleCatalogModuleStatus | 'blocked' | 'not_installed';

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
    sourceHash?: string;
    contractDigest?: string;
    buildId?: string;
    sourceFiles: number;
    capabilitySummary: ModuleMapReleaseMetadata['capabilitySummary'] | null;
  };
  runtimeSummary: ModuleRuntimeContract['capabilitySummary'];
}

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
    contract.capabilitySummary.routes.site +
    contract.capabilitySummary.routes.dashboard +
    contract.capabilitySummary.routes.admin +
    contract.capabilitySummary.routes.api
  );
}

function moduleCapabilitySummary(contract: ModuleRuntimeContract): AdminModuleCapabilitySummary {
  return {
    routes: moduleRouteCount(contract),
    siteRoutes: contract.capabilitySummary.routes.site,
    dashboardRoutes: contract.capabilitySummary.routes.dashboard,
    adminRoutes: contract.capabilitySummary.routes.admin,
    apiRoutes: contract.capabilitySummary.routes.api,
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

function routeCountForShell(
  contract: ModuleRuntimeContract,
  shell: 'site' | 'dashboard' | 'admin'
) {
  return contract.pages.filter((page) => page.area === shell).length;
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
    missingNavigationShells: requiredShells.filter(
      (shell) => !hasNavigationForShell(contract, shell)
    ),
  };
}

export function moduleRiskSummary(contract: ModuleRuntimeContract): AdminModuleRiskSummary {
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
  const publicApis = contract.apis
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
      .filter(
        (permission) =>
          PermissionRegistry[permission]?.risk === 'high' ||
          PermissionRegistry[permission]?.risk === 'critical'
      )
      .map(String),
  ];
  const secretConfig = Object.entries(contract.config)
    .filter(([, definition]) => definition.secret)
    .map(([name, definition]) => `${name}${definition.required ? ':required' : ':optional'}`);
  const requiredRequirements = [
    ...Object.entries(contract.serviceRequirements)
      .filter(([, definition]) => definition.required)
      .map(
        ([name, definition]) =>
          `service:${name}${definition.provider ? `:${definition.provider}` : ''}`
      ),
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

export function moduleDiagnostics(
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

export function buildAdminModuleRows(input: {
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

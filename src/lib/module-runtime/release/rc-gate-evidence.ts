import fs from 'node:fs';
import path from 'node:path';

import type {
  CommercialDomainEvidence,
  ModuleDashboardTransitionRequirement,
  ModuleMapManifest,
  ModuleQualityEvidenceRequirement,
  ModuleQualityRouteRequirement,
  ModuleTestReport,
  ProductPresentationManifest,
  ProviderInvocationEvidence,
  ProviderMatrixReport,
  RuntimeEvidenceReport,
  RuntimeStorePostgresReport,
  WorkerSoakReport,
} from './rc-gate-types';

const DEFAULT_MODULE_ROUTE_VIEWPORTS = ['desktop', 'mobile'] as const;

export function dashboardTransitionRoutePath(route: string): string {
  const normalized = route.startsWith('/') ? route : `/${route}`;
  if (normalized === '/zh/dashboard' || normalized.startsWith('/zh/dashboard/')) {
    return normalized;
  }
  if (normalized === '/dashboard' || normalized.startsWith('/dashboard/')) {
    return `/zh${normalized}`;
  }
  return normalized === '/' ? '/zh/dashboard' : `/zh/dashboard${normalized}`;
}

function moduleApiPerformanceCheckId(input: {
  moduleId: string;
  method?: string;
  path: string;
}): string {
  return `api:${input.moduleId}:${(input.method ?? 'GET').toUpperCase()}:${input.path}`;
}

function modulePagePerformanceCheckId(input: {
  moduleId: string;
  path: string;
  samplePath?: string;
}): string {
  return `page:${input.moduleId}:${input.samplePath ?? input.path}`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberFromRecord(record: Record<string, unknown> | undefined, key: string): number {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function booleanFromRecord(record: Record<string, unknown> | undefined, key: string): boolean {
  return record?.[key] === true;
}

export function commercialDomainEvidenceFromReport(
  report: RuntimeEvidenceReport | undefined
): CommercialDomainEvidence | undefined {
  const direct = asRecord(report?.domainEvidence?.commercialDomain);
  if (direct) {
    return {
      orders: numberFromRecord(direct, 'orders'),
      paidOrders: numberFromRecord(direct, 'paidOrders'),
      invoices: numberFromRecord(direct, 'invoices'),
      subscriptions: numberFromRecord(direct, 'subscriptions'),
      catalogItems: numberFromRecord(direct, 'catalogItems'),
      billingAccount: booleanFromRecord(direct, 'billingAccount'),
      revenueBuckets: numberFromRecord(direct, 'revenueBuckets'),
    };
  }

  const checks = report?.checks ?? [];
  for (const check of checks) {
    const detail = asRecord((check as { detail?: unknown }).detail);
    const nested =
      asRecord(detail?.commercialDomain) ??
      asRecord(asRecord(detail?.domainEvidence)?.commercialDomain);
    if (nested) {
      return {
        orders: numberFromRecord(nested, 'orders'),
        paidOrders: numberFromRecord(nested, 'paidOrders'),
        invoices: numberFromRecord(nested, 'invoices'),
        subscriptions: numberFromRecord(nested, 'subscriptions'),
        catalogItems: numberFromRecord(nested, 'catalogItems'),
        billingAccount: booleanFromRecord(nested, 'billingAccount'),
        revenueBuckets: numberFromRecord(nested, 'revenueBuckets'),
      };
    }
  }
  return undefined;
}

export function providerInvocationEvidenceFromReport(
  report: RuntimeEvidenceReport | ProviderMatrixReport | undefined
): ProviderInvocationEvidence | undefined {
  const direct = asRecord(
    (report as RuntimeEvidenceReport | undefined)?.domainEvidence
  )?.providerInvocationLedger;
  const directRecord = asRecord(direct);
  if (directRecord) {
    const operations = directRecord.operations;
    return {
      invocations: numberFromRecord(directRecord, 'invocations'),
      successful: numberFromRecord(directRecord, 'successful'),
      failed: numberFromRecord(directRecord, 'failed'),
      operations: Array.isArray(operations) ? operations.map(String) : [],
      kinds: Array.isArray(directRecord.kinds) ? directRecord.kinds.map(String) : [],
      ragSources: numberFromRecord(directRecord, 'ragSources'),
      ragChunks: numberFromRecord(directRecord, 'ragChunks'),
      connectorInvocations: numberFromRecord(directRecord, 'connectorInvocations'),
    };
  }

  const checks = report?.checks ?? [];
  for (const check of checks) {
    const detail = asRecord((check as { detail?: unknown }).detail);
    const nested =
      asRecord(detail?.providerInvocationLedger) ??
      asRecord(asRecord(detail?.domainEvidence)?.providerInvocationLedger);
    if (nested) {
      const operations = nested.operations;
      return {
        invocations: numberFromRecord(nested, 'invocations'),
        successful: numberFromRecord(nested, 'successful'),
        failed: numberFromRecord(nested, 'failed'),
        operations: Array.isArray(operations) ? operations.map(String) : [],
        kinds: Array.isArray(nested.kinds) ? nested.kinds.map(String) : [],
        ragSources: numberFromRecord(nested, 'ragSources'),
        ragChunks: numberFromRecord(nested, 'ragChunks'),
        connectorInvocations: numberFromRecord(nested, 'connectorInvocations'),
      };
    }
  }
  return undefined;
}

export function readProviderMatrixReport(projectRoot: string): {
  report?: ProviderMatrixReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', 'provider-matrix', 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: 'Provider matrix evidence is missing.' };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ProviderMatrixReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readWorkerSoakReport(projectRoot: string): {
  report?: WorkerSoakReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', 'worker-soak', 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: 'Worker soak evidence is missing.' };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as WorkerSoakReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readRuntimeStorePostgresReport(projectRoot: string): {
  report?: RuntimeStorePostgresReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', 'runtime-store-postgres', 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: 'Runtime store Postgres evidence is missing.' };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RuntimeStorePostgresReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readRuntimeEvidenceReport(
  projectRoot: string,
  runtimeDir: string
): {
  report?: RuntimeEvidenceReport;
  path: string;
  error?: string;
} {
  const reportPath = path.join(projectRoot, '.runtime', runtimeDir, 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return { path: reportPath, error: `${runtimeDir} evidence is missing.` };
  }
  try {
    return {
      path: reportPath,
      report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as RuntimeEvidenceReport,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readModuleMapManifest(projectRoot: string): {
  manifest?: ModuleMapManifest;
  path: string;
  error?: string;
} {
  const manifestPath = path.join(projectRoot, 'src', 'lib', 'module-map.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { path: manifestPath, error: 'Module map manifest is missing.' };
  }
  try {
    return {
      path: manifestPath,
      manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ModuleMapManifest,
    };
  } catch (error) {
    return {
      path: manifestPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function collectModuleQualityRouteRequirements(
  projectRoot: string,
  kind: 'browser' | 'accessibility'
): { requirements: ModuleQualityRouteRequirement[]; manifestPath: string; error?: string } {
  const manifest = readModuleMapManifest(projectRoot);
  if (!manifest.manifest) {
    return { requirements: [], manifestPath: manifest.path, error: manifest.error };
  }

  const requirements = (manifest.manifest.modules ?? []).flatMap((moduleInfo) => {
    const moduleId = moduleInfo.id;
    if (!moduleId) {
      return [];
    }
    const routes = moduleInfo.quality?.routes?.[kind] ?? [];
    return routes.flatMap((route): ModuleQualityRouteRequirement[] => {
      if (!route.path || !route.path.startsWith('/')) {
        return [];
      }
      return [
        {
          moduleId,
          path: route.path,
          viewports:
            route.viewports && route.viewports.length > 0
              ? route.viewports
              : DEFAULT_MODULE_ROUTE_VIEWPORTS,
        },
      ];
    });
  });

  return { requirements, manifestPath: manifest.path };
}

export function collectModuleQualityEvidenceRequirements(projectRoot: string): {
  requirements: ModuleQualityEvidenceRequirement[];
  manifestPath: string;
  error?: string;
} {
  const manifest = readModuleMapManifest(projectRoot);
  if (!manifest.manifest) {
    return { requirements: [], manifestPath: manifest.path, error: manifest.error };
  }

  const requirements = (manifest.manifest.modules ?? []).flatMap((moduleInfo) => {
    const moduleId = moduleInfo.id;
    if (!moduleId) {
      return [];
    }
    const evidence = moduleInfo.quality?.evidence ?? [];
    const declared = evidence.flatMap((item): ModuleQualityEvidenceRequirement[] => {
      if (!item.id || item.required === false) {
        return [];
      }
      return [
        {
          moduleId,
          title: item.title ?? `${moduleInfo.name ?? moduleId} module quality`,
          id: item.id,
          runtimeDir: item.runtimeDir ?? item.id,
          command: item.command,
          checks: item.checks ?? [],
        },
      ];
    });
    const apiRoutes = moduleInfo.quality?.performance?.apiRoutes ?? [];
    const apiChecks = apiRoutes
      .filter((route) => route.path && route.path.startsWith('/'))
      .map((route) =>
        moduleApiPerformanceCheckId({
          moduleId,
          method: route.method,
          path: route.path as string,
        })
      );
    const pageRoutes = moduleInfo.quality?.performance?.pageRoutes ?? [];
    const pageChecks = pageRoutes
      .filter((route) => route.path && route.path.startsWith('/'))
      .map((route) =>
        modulePagePerformanceCheckId({
          moduleId,
          path: route.path as string,
          samplePath: route.samplePath,
        })
      );
    if (apiChecks.length === 0 && pageChecks.length === 0) {
      return declared;
    }
    const performanceEvidence: ModuleQualityEvidenceRequirement[] = [];
    if (pageChecks.length > 0) {
      performanceEvidence.push({
        moduleId,
        title: `${moduleInfo.name ?? moduleId} module page performance`,
        id: 'module-page-performance',
        runtimeDir: 'module-page-performance',
        command: {
          script: 'module:page-performance',
          args: ['--module-id', moduleId],
        },
        checks: pageChecks,
      });
    }
    if (apiChecks.length > 0) {
      performanceEvidence.push({
        moduleId,
        title: `${moduleInfo.name ?? moduleId} module API performance`,
        id: 'module-api-performance',
        runtimeDir: 'module-api-performance',
        command: {
          script: 'module:api-performance',
          args: ['--module-id', moduleId],
        },
        checks: apiChecks,
      });
    }
    return [
      ...declared,
      ...performanceEvidence,
    ];
  });

  return { requirements, manifestPath: manifest.path };
}

export function collectModuleDashboardTransitionRequirements(projectRoot: string): {
  requirements: ModuleDashboardTransitionRequirement[];
  manifestPath: string;
  error?: string;
} {
  const manifest = readModuleMapManifest(projectRoot);
  if (!manifest.manifest) {
    if (manifest.error === 'Module map manifest is missing.') {
      return { requirements: [], manifestPath: manifest.path };
    }
    return { requirements: [], manifestPath: manifest.path, error: manifest.error };
  }

  const requirements = (manifest.manifest.modules ?? []).flatMap((moduleInfo) => {
    const moduleId = moduleInfo.id;
    if (!moduleId) {
      return [];
    }
    const transitions = moduleInfo.quality?.performance?.dashboardTransitions;
    const routes = transitions?.routes ?? [];
    return routes.flatMap((route): ModuleDashboardTransitionRequirement[] => {
      if (!route || !route.startsWith('/')) {
        return [];
      }
      return [
        {
          moduleId,
          route: dashboardTransitionRoutePath(route),
          maxDocumentNavigations: transitions?.maxDocumentNavigations,
          maxHydrationErrors: transitions?.maxHydrationErrors,
          maxP95Ms: transitions?.maxP95Ms,
          maxRscTransferBytes: transitions?.maxRscTransferBytes,
        },
      ];
    });
  });

  return { requirements, manifestPath: manifest.path };
}

export function missingDashboardTransitionRoutes(
  report: RuntimeEvidenceReport,
  requirements: readonly ModuleDashboardTransitionRequirement[]
): string[] {
  const summary = asRecord(report.summary);
  const reportRoutes = Array.isArray(summary?.routes)
    ? new Set(
        summary.routes
          .filter((route): route is string => typeof route === 'string')
          .map(dashboardTransitionRoutePath)
      )
    : new Set<string>();
  return requirements
    .filter((requirement) => !reportRoutes.has(requirement.route))
    .map((requirement) => `${requirement.moduleId}:${requirement.route}`);
}

export function missingModuleQualityRouteChecks(
  report: RuntimeEvidenceReport,
  requirements: readonly ModuleQualityRouteRequirement[]
): string[] {
  const passedIds = new Set(
    (report.checks ?? [])
      .filter((check) => check.ok === true)
      .map((check) => check.id)
      .filter((id): id is string => typeof id === 'string')
  );
  return requirements
    .flatMap((route) => route.viewports.map((viewport) => `${viewport}:${route.path}`))
    .filter((id) => !passedIds.has(id));
}

export function readProductPresentationManifest(projectRoot: string): {
  manifest?: ProductPresentationManifest;
  path: string;
  error?: string;
} {
  const reportPath = [
    path.join(projectRoot, '.ploykit', 'generated', 'product-presentation.manifest.json'),
    path.join(projectRoot, '.runtime', 'product-presentation-manifest.json'),
  ].find((candidate) => fs.existsSync(candidate));
  if (!reportPath) {
    return {
      path: path.join(projectRoot, '.ploykit', 'generated', 'product-presentation.manifest.json'),
      error: 'Product Presentation manifest is missing.',
    };
  }
  try {
    return {
      path: reportPath,
      manifest: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ProductPresentationManifest,
    };
  } catch (error) {
    return {
      path: reportPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readModuleTestReports(projectRoot: string): {
  reports: { moduleId: string; path: string; report?: ModuleTestReport; error?: string }[];
  missing: string[];
} {
  const modulesRoot = path.join(projectRoot, 'modules');
  const reportsRoot = path.join(projectRoot, '.runtime', 'module-test-reports');
  const moduleIds = fs.existsSync(modulesRoot)
    ? fs
        .readdirSync(modulesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    : [];
  const reports = moduleIds.map((moduleId) => {
    const reportPath = path.join(reportsRoot, `${moduleId}.json`);
    if (!fs.existsSync(reportPath)) {
      return { moduleId, path: reportPath, error: 'Module test report is missing.' };
    }
    try {
      return {
        moduleId,
        path: reportPath,
        report: JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ModuleTestReport,
      };
    } catch (error) {
      return {
        moduleId,
        path: reportPath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  return {
    reports,
    missing: reports
      .filter((item) => !item.report || item.report.success !== true)
      .map((item) => item.moduleId),
  };
}

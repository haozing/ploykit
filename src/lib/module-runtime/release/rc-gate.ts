import fs from 'node:fs';
import path from 'node:path';

export type ReleaseCandidateCheckStatus = 'passed' | 'pending' | 'failed';
export type ReleaseCandidateGateProfile = 'local' | 'integration' | 'maintainer';

export interface ReleaseCandidateCheck {
  id: string;
  title: string;
  required: boolean;
  status: ReleaseCandidateCheckStatus;
  evidence?: string;
}

export interface ReleaseCandidateDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path: string;
  line?: number;
  term?: string;
  snippet?: string;
  fix?: string;
}

export interface ReleaseCandidateGateResult {
  ok: boolean;
  checkedAt: string;
  profile: ReleaseCandidateGateProfile;
  scannedFiles: number;
  diagnostics: ReleaseCandidateDiagnostic[];
  checks: ReleaseCandidateCheck[];
}

export interface RunReleaseCandidateGateInput {
  projectRoot: string;
  profile?: ReleaseCandidateGateProfile;
  targets?: readonly string[];
  requiredChecks?: Record<string, ReleaseCandidateCheckStatus | boolean | undefined>;
  now?: () => Date;
}

interface LegacyRuntimeTerm {
  code: string;
  value: string;
  formalName: string;
}

interface ResolvedCheckEvidence {
  status: ReleaseCandidateCheckStatus;
  evidence?: string;
}

interface ProviderMatrixReport {
  ok?: boolean;
  required?: boolean;
  checkedAt?: string;
  checks?: { id?: string; ok?: boolean }[];
}

interface WorkerSoakReport {
  ok?: boolean;
  required?: boolean;
  checkedAt?: string;
  enqueued?: number;
  drain?: {
    processed?: number;
    failed?: number;
    deadLettered?: number;
    iterations?: number;
  };
  deliveryLedger?: {
    records?: number;
    delivered?: number;
    failed?: number;
    deadLettered?: number;
    workerRecords?: number;
    workers?: number;
  };
  workerRegistry?: {
    workers?: number;
    activeWorkers?: number;
    errorWorkers?: number;
    latestHeartbeatAt?: string;
  };
}

interface RuntimeStorePostgresReport {
  ok?: boolean;
  required?: boolean;
  checkedAt?: string;
  profile?: string;
  checks?: { id?: string; ok?: boolean }[];
}

interface RuntimeEvidenceReport {
  ok?: boolean;
  required?: boolean;
  skipped?: boolean;
  checkedAt?: string;
  mode?: string;
  baseUrl?: string;
  outputDir?: string;
  summary?: { tests?: number; pass?: number; fail?: number; skipped?: number };
  checks?: { id?: string; ok?: boolean; status?: string }[];
  domainEvidence?: Record<string, unknown>;
}

type DriftCheckReport = Omit<RuntimeEvidenceReport, 'summary'> & {
  findings?: {
    id?: string;
    domain?: string;
    severity?: string;
    blocking?: boolean;
    message?: string;
  }[];
  summary?: {
    total?: number;
    blocking?: number;
    errors?: number;
    warnings?: number;
    domains?: string[];
  };
  policy?: {
    warningBlocks?: boolean;
    errorBlocks?: boolean;
  };
};

interface CommercialDomainEvidence {
  orders?: number;
  paidOrders?: number;
  invoices?: number;
  subscriptions?: number;
  catalogItems?: number;
  billingAccount?: boolean;
  revenueBuckets?: number;
}

interface ProviderInvocationEvidence {
  invocations?: number;
  successful?: number;
  failed?: number;
  operations?: string[];
  kinds?: string[];
  ragSources?: number;
  ragChunks?: number;
  connectorInvocations?: number;
}

interface ProductPresentationManifest {
  kind?: string;
  checkedAt?: string;
  diagnostics?: { severity?: string; code?: string; message?: string; path?: string }[];
  product?: { id?: string; supportedLanguages?: string[] };
  pages?: Record<string, unknown>;
  theme?: { rejectedTokens?: string[]; rejectedDarkTokens?: string[] };
}

interface ModuleTestReport {
  success?: boolean;
  moduleRoot?: string;
  checkedAt?: string;
  steps?: { name?: string; ok?: boolean; status?: number }[];
}

interface ModuleQualityRouteEvidence {
  path?: string;
  viewports?: string[];
}

interface ModuleQualityCommand {
  script?: string;
  args?: string[];
}

interface ModuleQualityRuntimeEvidence {
  id?: string;
  title?: string;
  runtimeDir?: string;
  required?: boolean;
  command?: ModuleQualityCommand;
  checks?: string[];
}

interface ModuleQualityDefinition {
  routes?: {
    browser?: ModuleQualityRouteEvidence[];
    accessibility?: ModuleQualityRouteEvidence[];
  };
  evidence?: ModuleQualityRuntimeEvidence[];
}

interface ModuleMapManifestModule {
  id?: string;
  name?: string;
  quality?: ModuleQualityDefinition;
}

interface ModuleMapManifest {
  modules?: ModuleMapManifestModule[];
}

interface ModuleQualityRouteRequirement {
  moduleId: string;
  path: string;
  viewports: readonly string[];
}

interface ModuleQualityEvidenceRequirement {
  moduleId: string;
  title: string;
  id: string;
  runtimeDir: string;
  command?: ModuleQualityCommand;
  checks: readonly string[];
}

const DEFAULT_TARGETS = [
  'src',
  'modules',
  'templates',
  'apps',
  'docs',
  'README.md',
  'package.json',
] as const;

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.runtime',
  'coverage',
  'dist',
  'node_modules',
]);

const LEGACY_RUNTIME_TERMS: LegacyRuntimeTerm[] = [
  {
    code: 'RC_LEGACY_DEFINE_FACTORY',
    value: `${'define'}${'Plugin'}`,
    formalName: 'legacy factory API',
  },
  {
    code: 'RC_LEGACY_ENTRY_FILE',
    value: `${'plugin'}.${'ts'}`,
    formalName: 'legacy entry file',
  },
  {
    code: 'RC_LEGACY_STORAGE_API',
    value: `${'ctx'}.${'storage'}`,
    formalName: 'legacy storage API',
  },
  {
    code: 'RC_LEGACY_SDK_IMPORT',
    value: `${'@ploykit'}/${'plugin-sdk'}`,
    formalName: 'legacy SDK import',
  },
  {
    code: 'RC_LEGACY_RUNTIME_IMPORT',
    value: `${'plugin'}-${'runtime'}`,
    formalName: 'legacy runtime import',
  },
  {
    code: 'RC_LEGACY_MODULE_ROOT',
    value: `${'plugins'}/`,
    formalName: 'legacy module root',
  },
  {
    code: 'RC_LEGACY_MODULE_ROOT',
    value: `${'plugins'}\\`,
    formalName: 'legacy module root',
  },
];

const REQUIRED_CHECKS: readonly Omit<ReleaseCandidateCheck, 'status' | 'evidence'>[] = [
  {
    id: 'module-contract',
    title: 'Module contract, module map, doctor, and templates use module-first APIs.',
    required: true,
  },
  {
    id: 'web-shell',
    title: 'Web Shell loads modules through the v2 host without legacy runtime dependencies.',
    required: true,
  },
  {
    id: 'host-product-smoke',
    title: 'Product host smoke covers site, auth, dashboard, admin, and public tools.',
    required: true,
  },
  {
    id: 'runtime-stores',
    title: 'Runtime stores and Data v2 pass the Postgres verification loop.',
    required: true,
  },
  {
    id: 'production-adapters',
    title: 'Billing, files, jobs, webhooks, and provider adapters have production-grade tests.',
    required: true,
  },
  {
    id: 'security-operations',
    title: 'Security matrix, runtime checks, and operational diagnostics pass.',
    required: true,
  },
  {
    id: 'demo-products',
    title:
      'Demo products start from a clean checkout and cover public routes, jobs, billing, files, and AI.',
    required: true,
  },
  {
    id: 'provider-live-matrix',
    title:
      'S3-compatible storage, Stripe, Email, and AI/RAG provider smoke matrix has current evidence.',
    required: true,
  },
  {
    id: 'worker-soak',
    title: 'Worker soak evidence proves queue drain, heartbeat, and dead-letter status.',
    required: true,
  },
  {
    id: 'delivery-ledger',
    title:
      'Delivery ledger and worker registry record worker, job, webhook, event, and email delivery evidence.',
    required: true,
  },
  {
    id: 'browser-matrix',
    title:
      'Desktop/mobile browser matrix covers site, auth, dashboard, admin, demo, files, billing, and declared module routes.',
    required: true,
  },
  {
    id: 'accessibility-smoke',
    title:
      'Accessibility smoke covers named controls, headings, overflow, console errors, and declared module routes.',
    required: true,
  },
  {
    id: 'module-quality',
    title: 'Module-declared quality evidence passes without host-specific module exceptions.',
    required: true,
  },
  {
    id: 'product-presentation-kernel',
    title:
      'Product Presentation manifest proves typed product config, clean i18n paths, and theme token readiness.',
    required: true,
  },
  {
    id: 'white-label-presentation',
    title:
      'White-label presentation smoke covers public pages, auth, workspace theme, admin boundary, and hreflang.',
    required: true,
  },
  {
    id: 'data-safety-matrix',
    title: 'Auth secrets, store durability, route security, files, worker, and legacy scans are checked.',
    required: true,
  },
  {
    id: 'drift-check-matrix',
    title: 'Unified drift check covers module map, catalog, runtime, data, files, and providers.',
    required: true,
  },
  {
    id: 'backup-restore-matrix',
    title: 'Runtime store backup/restore semantic snapshot evidence passes.',
    required: true,
  },
  {
    id: 'upgrade-migration-matrix',
    title: 'Runtime store upgrade migrations are ordered, covered, idempotent, and non-destructive.',
    required: true,
  },
  {
    id: 'chaos-matrix',
    title: 'Queue chaos evidence covers concurrency, backoff, lease reclaim, and dead-letter replay.',
    required: true,
  },
  {
    id: 'commercial-domain',
    title:
      'Commercial domain evidence records catalog, billing account, invoices, subscriptions, and revenue buckets.',
    required: true,
  },
  {
    id: 'provider-invocation-ledger',
    title:
      'Provider invocation ledger records AI/RAG/connectors with operation, status, usage, cost, and latency.',
    required: true,
  },
  {
    id: 'documentation',
    title:
      'Quickstart, deployment, module authoring, operations, security, upgrade policy, and checklist are present.',
    required: true,
  },
];

const PROFILE_REQUIRED_CHECKS: Record<ReleaseCandidateGateProfile, readonly string[]> = {
  local: [
    'module-contract',
    'web-shell',
    'security-operations',
    'demo-products',
    'documentation',
  ],
  integration: [
    'module-contract',
    'web-shell',
    'host-product-smoke',
    'runtime-stores',
    'production-adapters',
    'security-operations',
    'demo-products',
    'browser-matrix',
    'accessibility-smoke',
    'module-quality',
    'product-presentation-kernel',
    'white-label-presentation',
    'documentation',
  ],
  maintainer: REQUIRED_CHECKS.map((check) => check.id),
};

const DEFAULT_MODULE_ROUTE_VIEWPORTS = ['desktop', 'mobile'] as const;

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
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

function commercialDomainEvidenceFromReport(
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

function providerInvocationEvidenceFromReport(
  report: RuntimeEvidenceReport | ProviderMatrixReport | undefined
): ProviderInvocationEvidence | undefined {
  const direct = asRecord((report as RuntimeEvidenceReport | undefined)?.domainEvidence)
    ?.providerInvocationLedger;
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

function normalizeCheckStatus(
  value: ReleaseCandidateCheckStatus | boolean | undefined
): ReleaseCandidateCheckStatus {
  if (value === true) {
    return 'passed';
  }
  if (value === false) {
    return 'failed';
  }
  return value ?? 'pending';
}

function readProviderMatrixReport(projectRoot: string): {
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

function readWorkerSoakReport(projectRoot: string): {
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

function readRuntimeStorePostgresReport(projectRoot: string): {
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

function readRuntimeEvidenceReport(
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

function collectModuleQualityRouteRequirements(
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

function collectModuleQualityEvidenceRequirements(projectRoot: string): {
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
    return evidence.flatMap((item): ModuleQualityEvidenceRequirement[] => {
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
  });

  return { requirements, manifestPath: manifest.path };
}

function missingModuleQualityRouteChecks(
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

function readProductPresentationManifest(projectRoot: string): {
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

function readModuleTestReports(projectRoot: string): {
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

function resolveHostProductSmokeCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Host product smoke was marked failed by the release gate caller.',
    };
  }
  const smoke = readRuntimeEvidenceReport(projectRoot, 'host-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run host:smoke. (${smoke.path})`,
    };
  }
  if (smoke.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Host product smoke passed at ${smoke.report.checkedAt ?? 'unknown time'} with ${smoke.report.checks?.length ?? 0} checks against ${smoke.report.baseUrl ?? 'unknown base URL'}. (${smoke.path})`,
    };
  }
  const failedChecks = (smoke.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Host product smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${smoke.path})`,
  };
}

function resolveBrowserMatrixCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Browser matrix was marked failed by the release gate caller.',
    };
  }
  const matrix = readRuntimeEvidenceReport(projectRoot, 'browser-matrix');
  if (!matrix.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${matrix.error} Run npm run host:browser-matrix. (${matrix.path})`,
    };
  }
  if (requestedStatus === 'passed' && matrix.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Browser matrix strict evidence must be generated with npm run host:browser-matrix -- --required. (${matrix.path})`,
    };
  }
  const moduleRoutes = collectModuleQualityRouteRequirements(projectRoot, 'browser');
  if (moduleRoutes.error) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${moduleRoutes.error} (${moduleRoutes.manifestPath})`,
    };
  }
  const missingModuleRoutes = missingModuleQualityRouteChecks(matrix.report, moduleRoutes.requirements);
  if (missingModuleRoutes.length > 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Browser matrix is missing module-declared route evidence: ${missingModuleRoutes.join(', ')}. (${matrix.path}; declared in ${moduleRoutes.manifestPath})`,
    };
  }
  if (matrix.report.ok === true && matrix.report.skipped !== true) {
    return {
      status: 'passed',
      evidence: `Browser matrix passed at ${matrix.report.checkedAt ?? 'unknown time'} with ${matrix.report.checks?.length ?? 0} checks. (${matrix.path})`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Browser matrix did not pass or was skipped. (${matrix.path})`,
  };
}

function resolveAccessibilitySmokeCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Accessibility smoke was marked failed by the release gate caller.',
    };
  }
  const smoke = readRuntimeEvidenceReport(projectRoot, 'accessibility-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run host:accessibility-smoke. (${smoke.path})`,
    };
  }
  if (requestedStatus === 'passed' && smoke.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Accessibility smoke strict evidence must be generated with npm run host:accessibility-smoke -- --required. (${smoke.path})`,
    };
  }
  const moduleRoutes = collectModuleQualityRouteRequirements(projectRoot, 'accessibility');
  if (moduleRoutes.error) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${moduleRoutes.error} (${moduleRoutes.manifestPath})`,
    };
  }
  const missingModuleRoutes = missingModuleQualityRouteChecks(smoke.report, moduleRoutes.requirements);
  if (missingModuleRoutes.length > 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Accessibility smoke is missing module-declared route evidence: ${missingModuleRoutes.join(', ')}. (${smoke.path}; declared in ${moduleRoutes.manifestPath})`,
    };
  }
  if (smoke.report.ok === true && smoke.report.skipped !== true) {
    return {
      status: 'passed',
      evidence: `Accessibility smoke passed at ${smoke.report.checkedAt ?? 'unknown time'} with ${smoke.report.checks?.length ?? 0} checks. (${smoke.path})`,
    };
  }
  const failedChecks = (smoke.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Accessibility smoke did not pass or was skipped. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${smoke.path})`,
  };
}

function resolveModuleQualityCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Module quality was marked failed by the release gate caller.',
    };
  }

  const declared = collectModuleQualityEvidenceRequirements(projectRoot);
  if (declared.error) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${declared.error} (${declared.manifestPath})`,
    };
  }

  if (declared.requirements.length === 0) {
    return {
      status: 'passed',
      evidence: `No required module-declared quality evidence was found in ${declared.manifestPath}.`,
    };
  }

  const results = declared.requirements.map((requirement) => {
    const evidence = readRuntimeEvidenceReport(projectRoot, requirement.runtimeDir);
    if (!evidence.report) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${evidence.error} Run ${
          requirement.command?.script ? `npm run ${requirement.command.script}` : 'the declared module quality command'
        } -- --required. (${evidence.path})`,
      };
    }
    if (evidence.report.required !== true) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${requirement.id} strict evidence must be generated with --required. (${evidence.path})`,
      };
    }
    if (evidence.report.skipped === true) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${requirement.id} evidence was skipped. (${evidence.path})`,
      };
    }

    const passedIds = new Set(
      (evidence.report.checks ?? [])
        .filter((check) => check.ok === true)
        .map((check) => check.id)
        .filter((id): id is string => typeof id === 'string')
    );
    const missing = requirement.checks.filter((id) => !passedIds.has(id));
    if (missing.length > 0) {
      return {
        requirement,
        status: requestedStatus === 'passed' ? 'failed' : 'pending',
        evidence: `${requirement.id} is missing required checks: ${missing.join(', ')}. (${evidence.path})`,
      };
    }

    const failedChecks = (evidence.report.checks ?? [])
      .filter((check) => check.ok === false)
      .map((check) => check.id ?? 'unknown');
    if (evidence.report.ok === true) {
      return {
        requirement,
        status: 'passed' as const,
        evidence: `${requirement.id} passed at ${evidence.report.checkedAt ?? 'unknown time'} with ${evidence.report.checks?.length ?? 0} checks. (${evidence.path})`,
      };
    }

    return {
      requirement,
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${requirement.id} did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${evidence.path})`,
    };
  });

  const failed = results.filter((item) => item.status === 'failed');
  if (failed.length > 0) {
    return {
      status: 'failed',
      evidence: failed.map((item) => item.evidence).join(' '),
    };
  }
  const pending = results.filter((item) => item.status === 'pending');
  if (pending.length > 0) {
    return {
      status: 'pending',
      evidence: pending.map((item) => item.evidence).join(' '),
    };
  }

  return {
    status: 'passed',
    evidence: `Module quality evidence passed for ${results.length} required declaration(s): ${results
      .map((item) => `${item.requirement.moduleId}:${item.requirement.id}`)
      .join(', ')}.`,
  };
}

function resolveProductPresentationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Product Presentation manifest was marked failed by the release gate caller.',
    };
  }
  const manifest = readProductPresentationManifest(projectRoot);
  if (!manifest.manifest) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${manifest.error} Run npm run presentation:check. (${manifest.path})`,
    };
  }
  const errors = (manifest.manifest.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.severity === 'error'
  );
  if (errors.length > 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Product Presentation manifest has ${errors.length} error diagnostics: ${errors
        .map((item) => item.code ?? item.path ?? 'unknown')
        .join(', ')}. (${manifest.path})`,
    };
  }
  if (manifest.manifest.kind !== 'ploykit.product-presentation.manifest') {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `Product Presentation manifest kind is invalid. (${manifest.path})`,
    };
  }
  return {
    status: 'passed',
    evidence: `Product Presentation manifest passed at ${manifest.manifest.checkedAt ?? 'unknown time'} for ${manifest.manifest.product?.id ?? 'unknown product'} with ${Object.keys(manifest.manifest.pages ?? {}).length} page overrides. (${manifest.path})`,
  };
}

function resolveWhiteLabelPresentationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'White-label presentation smoke was marked failed by the release gate caller.',
    };
  }
  const smoke = readRuntimeEvidenceReport(projectRoot, 'white-label-smoke');
  if (!smoke.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${smoke.error} Run npm run white-label:smoke. (${smoke.path})`,
    };
  }
  if (requestedStatus === 'passed' && smoke.report.required !== true) {
    return {
      status: 'failed',
      evidence: `White-label smoke strict evidence must be generated with npm run white-label:smoke. (${smoke.path})`,
    };
  }
  if (smoke.report.ok === true) {
    return {
      status: 'passed',
      evidence: `White-label presentation smoke passed at ${smoke.report.checkedAt ?? 'unknown time'}. (${smoke.path})`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `White-label presentation smoke did not pass. (${smoke.path})`,
  };
}

function resolveDataSafetyCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Data safety matrix was marked failed by the release gate caller.',
    };
  }
  const safety = readRuntimeEvidenceReport(projectRoot, 'data-safety');
  if (!safety.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${safety.error} Run npm run host:data-safety. (${safety.path})`,
    };
  }
  if (requestedStatus === 'passed' && safety.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Data safety strict evidence must be generated with npm run host:data-safety -- --required. (${safety.path})`,
    };
  }
  if (safety.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Data safety matrix passed at ${safety.report.checkedAt ?? 'unknown time'} with ${safety.report.checks?.length ?? 0} checks. (${safety.path})`,
    };
  }
  const failedChecks = (safety.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Data safety matrix did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${safety.path})`,
  };
}

function resolveDriftCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Unified drift evidence was marked failed by the release gate caller.',
    };
  }

  const drift = readRuntimeEvidenceReport(projectRoot, 'drift-check') as {
    report?: DriftCheckReport;
    path: string;
    error?: string;
  };
  if (!drift.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${drift.error} Run npm run drift:check. (${drift.path})`,
    };
  }

  if (requestedStatus === 'passed' && drift.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Unified drift strict evidence must be generated with npm run drift:check -- --required. (${drift.path})`,
    };
  }

  const blockedFindings = (drift.report.findings ?? []).filter((finding) => finding.blocking === true);
  if (drift.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Unified drift check passed at ${drift.report.checkedAt ?? 'unknown time'} with ${drift.report.summary?.total ?? drift.report.findings?.length ?? 0} findings across ${drift.report.summary?.domains?.length ?? 0} domains. (${drift.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Unified drift check did not pass. Blocking findings: ${blockedFindings
      .map((finding) => finding.id ?? finding.message ?? 'unknown')
      .join(', ') || 'unknown'}. (${drift.path})`,
  };
}

function resolveBackupRestoreCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Backup/restore evidence was marked failed by the release gate caller.',
    };
  }

  const backupRestore = readRuntimeEvidenceReport(projectRoot, 'backup-restore');
  if (!backupRestore.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${backupRestore.error} Run npm run host:backup-restore-smoke. (${backupRestore.path})`,
    };
  }

  if (requestedStatus === 'passed' && backupRestore.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Backup/restore strict evidence must be generated with npm run host:backup-restore-smoke -- --required. (${backupRestore.path})`,
    };
  }

  const failedChecks = (backupRestore.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  if (backupRestore.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Backup/restore smoke passed at ${backupRestore.report.checkedAt ?? 'unknown time'} in ${backupRestore.report.mode ?? 'unknown'} mode with ${backupRestore.report.checks?.length ?? 0} checks. (${backupRestore.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Backup/restore smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${backupRestore.path})`,
  };
}

function resolveUpgradeMigrationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Upgrade migration evidence was marked failed by the release gate caller.',
    };
  }

  const upgrade = readRuntimeEvidenceReport(projectRoot, 'upgrade-migration');
  if (!upgrade.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${upgrade.error} Run npm run host:upgrade-migration-smoke. (${upgrade.path})`,
    };
  }

  if (requestedStatus === 'passed' && upgrade.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Upgrade migration strict evidence must be generated with npm run host:upgrade-migration-smoke -- --required. (${upgrade.path})`,
    };
  }

  const failedChecks = (upgrade.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  if (upgrade.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Upgrade migration smoke passed at ${upgrade.report.checkedAt ?? 'unknown time'} in ${upgrade.report.mode ?? 'unknown'} mode with ${upgrade.report.checks?.length ?? 0} checks. (${upgrade.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Upgrade migration smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${upgrade.path})`,
  };
}

function resolveChaosCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Chaos evidence was marked failed by the release gate caller.',
    };
  }

  const chaos = readRuntimeEvidenceReport(projectRoot, 'chaos');
  if (!chaos.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${chaos.error} Run npm run host:chaos-smoke. (${chaos.path})`,
    };
  }

  if (requestedStatus === 'passed' && chaos.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Chaos strict evidence must be generated with npm run host:chaos-smoke -- --required. (${chaos.path})`,
    };
  }

  const failedChecks = (chaos.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  if (chaos.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Chaos smoke passed at ${chaos.report.checkedAt ?? 'unknown time'} in ${chaos.report.mode ?? 'unknown'} mode with ${chaos.report.checks?.length ?? 0} checks. (${chaos.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Chaos smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${chaos.path})`,
  };
}

function resolveSecurityOperationsCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  const safety = resolveDataSafetyCheck(projectRoot, requestedStatus);
  if (safety.status !== 'passed') {
    return {
      status: safety.status,
      evidence: safety.evidence?.replace('Data safety matrix', 'Security operations'),
    };
  }
  return {
    status: 'passed',
    evidence: `Security operations passed through data-safety route security, config doctor, legacy scan, and redaction evidence. ${safety.evidence}`,
  };
}

function resolveWebShellCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Web shell evidence was marked failed by the release gate caller.',
    };
  }
  const report = readRuntimeEvidenceReport(projectRoot, 'web-shell');
  if (!report.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${report.error} Run npm run host:web-shell-evidence. (${report.path})`,
    };
  }
  if (requestedStatus === 'passed' && report.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Web shell strict evidence must be generated with npm run host:web-shell-evidence -- --required. (${report.path})`,
    };
  }
  if (report.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Web shell evidence passed at ${report.report.checkedAt ?? 'unknown time'} with ${report.report.summary?.tests ?? 0} tests. (${report.path})`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Web shell evidence did not pass. (${report.path})`,
  };
}

function resolveProductionAdaptersCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Production adapters were marked failed by the release gate caller.',
    };
  }

  const provider = resolveProviderMatrixCheck(projectRoot, requestedStatus);
  if (provider.status !== 'passed') {
    return {
      status: provider.status,
      evidence: provider.evidence?.replace('Provider matrix', 'Production adapters'),
    };
  }

  const runtime = resolveRuntimeStoresCheck(projectRoot, requestedStatus);
  if (runtime.status !== 'passed') {
    return {
      status: runtime.status,
      evidence: runtime.evidence?.replace('Runtime store Postgres smoke', 'Production adapters'),
    };
  }

  const worker = resolveWorkerSoakCheck(projectRoot, requestedStatus);
  if (worker.status !== 'passed') {
    return {
      status: worker.status,
      evidence: worker.evidence?.replace('Worker soak', 'Production adapters'),
    };
  }

  const delivery = resolveDeliveryLedgerCheck(projectRoot, requestedStatus);
  if (delivery.status !== 'passed') {
    return {
      status: delivery.status,
      evidence: delivery.evidence?.replace('Delivery ledger', 'Production adapters'),
    };
  }

  return {
    status: 'passed',
    evidence: `Production adapters passed with provider matrix, runtime store, worker soak, and delivery ledger evidence. ${provider.evidence} ${runtime.evidence} ${worker.evidence} ${delivery.evidence}`,
  };
}

function resolveModuleReportsCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus,
  label: string
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: `${label} was marked failed by the release gate caller.`,
    };
  }
  const moduleReports = readModuleTestReports(projectRoot);
  if (moduleReports.reports.length === 0) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: 'No modules were found under modules/.',
    };
  }
  if (moduleReports.missing.length === 0) {
    return {
      status: 'passed',
      evidence: `${label} passed with ${moduleReports.reports.length} module:test reports in .runtime/module-test-reports.`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `${label} is missing passing module:test reports for: ${moduleReports.missing.join(', ')}.`,
  };
}

function resolveDocumentationCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Documentation was marked failed by the release gate caller.',
    };
  }
  const requiredDocs = [
    'README.md',
    'docs/README.zh-CN.md',
    'docs/deployment.zh-CN.md',
    'docs/module-development.zh-CN.md',
    'docs/operations.zh-CN.md',
    'docs/security-model.zh-CN.md',
    'docs/release-candidate-checklist.zh-CN.md',
  ];
  const missing = requiredDocs.filter((docPath) => !fs.existsSync(path.join(projectRoot, docPath)));
  if (missing.length === 0) {
    return {
      status: 'passed',
      evidence: `Documentation index and release docs are present: ${requiredDocs.join(', ')}.`,
    };
  }
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Documentation is missing required files: ${missing.join(', ')}.`,
  };
}

function resolveProviderMatrixCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Provider matrix was marked failed by the release gate caller.',
    };
  }

  const matrix = readProviderMatrixReport(projectRoot);
  if (!matrix.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${matrix.error} Run npm run host:provider-matrix. (${matrix.path})`,
    };
  }

  const failedChecks = (matrix.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  const localDepth = (matrix.report.checks ?? []).find(
    (check) => check.id === 'local-provider-depth'
  );
  const aiRagLocal = (matrix.report.checks ?? []).find((check) => check.id === 'ai-rag-local');
  const invocationEvidence = providerInvocationEvidenceFromReport(matrix.report);

  if (requestedStatus === 'passed' && matrix.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Provider matrix strict evidence must be generated with npm run host:provider-matrix -- --required. (${matrix.path})`,
    };
  }

  if (
    matrix.report.ok &&
    localDepth?.ok === true &&
    aiRagLocal?.ok === true &&
    (requestedStatus !== 'passed' ||
      ((invocationEvidence?.invocations ?? 0) >= 2 &&
        (invocationEvidence?.successful ?? 0) >= 2 &&
        (invocationEvidence?.failed ?? 0) === 0 &&
        (invocationEvidence?.ragSources ?? 0) >= 1 &&
        (invocationEvidence?.ragChunks ?? 0) >= 1))
  ) {
    return {
      status: 'passed',
      evidence: `Provider matrix passed at ${matrix.report.checkedAt ?? 'unknown time'} with local-provider-depth, ai-rag-local, ${invocationEvidence?.invocations ?? 0} provider invocation ledger records, and ${invocationEvidence?.ragSources ?? 0}/${invocationEvidence?.ragChunks ?? 0} RAG source/chunk records. (${matrix.path})`,
    };
  }

  const missingRequiredChecks = [
    localDepth?.ok === true ? undefined : 'local-provider-depth evidence is missing',
    aiRagLocal?.ok === true ? undefined : 'ai-rag-local evidence is missing',
    requestedStatus !== 'passed' ||
    ((invocationEvidence?.invocations ?? 0) >= 2 &&
      (invocationEvidence?.successful ?? 0) >= 2 &&
      (invocationEvidence?.failed ?? 0) === 0 &&
      (invocationEvidence?.ragSources ?? 0) >= 1 &&
      (invocationEvidence?.ragChunks ?? 0) >= 1)
      ? undefined
      : 'provider/RAG invocation ledger evidence is missing',
  ].filter(Boolean);
  const reason = matrix.report.ok
    ? `Provider matrix passed but ${missingRequiredChecks.join('; ')}.`
    : `Provider matrix did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}.`;
  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `${reason} (${matrix.path})`,
  };
}

function resolveDeliveryLedgerCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Delivery ledger was marked failed by the release gate caller.',
    };
  }

  const soak = readWorkerSoakReport(projectRoot);
  if (!soak.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${soak.error} Run npm run host:worker-soak -- --required. (${soak.path})`,
    };
  }

  if (requestedStatus === 'passed' && soak.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Delivery ledger strict evidence must be generated with npm run host:worker-soak -- --required. (${soak.path})`,
    };
  }

  const ledger = soak.report.deliveryLedger;
  const registry = soak.report.workerRegistry;
  const hasLedger =
    (ledger?.records ?? 0) >= Math.max(1, (soak.report.enqueued ?? 0) + 1) &&
    (ledger?.failed ?? 0) === 0 &&
    (ledger?.deadLettered ?? 0) === 0 &&
    (ledger?.workerRecords ?? 0) >= 1;
  const hasRegistry = (registry?.workers ?? 0) >= 1 && (registry?.errorWorkers ?? 0) === 0;

  if (soak.report.ok === true && hasLedger && hasRegistry) {
    return {
      status: 'passed',
      evidence: `Delivery ledger passed with ${ledger?.records ?? 0} records, ${ledger?.workerRecords ?? 0} worker records, and ${registry?.workers ?? 0} worker registry row(s). (${soak.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Delivery ledger evidence is incomplete. records=${ledger?.records ?? 0}, workerRecords=${ledger?.workerRecords ?? 0}, workers=${registry?.workers ?? 0}, failed=${ledger?.failed ?? 0}, deadLettered=${ledger?.deadLettered ?? 0}. (${soak.path})`,
  };
}

function resolveCommercialDomainCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Commercial domain evidence was marked failed by the release gate caller.',
    };
  }

  const billing = readRuntimeEvidenceReport(projectRoot, 'billing-reconcile');
  if (!billing.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${billing.error} Run npm run host:billing-reconcile-smoke. (${billing.path})`,
    };
  }

  if (requestedStatus === 'passed' && billing.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Commercial domain strict evidence must be generated with npm run host:billing-reconcile-smoke. (${billing.path})`,
    };
  }

  const evidence = commercialDomainEvidenceFromReport(billing.report);
  const ok =
    billing.report.ok === true &&
    (evidence?.paidOrders ?? 0) >= 1 &&
    (evidence?.catalogItems ?? 0) >= 2 &&
    evidence?.billingAccount === true &&
    (evidence?.invoices ?? 0) >= 1 &&
    (evidence?.subscriptions ?? 0) >= 1 &&
    (evidence?.revenueBuckets ?? 0) >= 1;
  if (ok) {
    return {
      status: 'passed',
      evidence: `Commercial domain evidence passed with ${evidence?.catalogItems ?? 0} catalog items, ${evidence?.invoices ?? 0} invoices, ${evidence?.subscriptions ?? 0} subscriptions, and ${evidence?.revenueBuckets ?? 0} revenue buckets. (${billing.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Commercial domain evidence is incomplete. paidOrders=${evidence?.paidOrders ?? 0}, catalogItems=${evidence?.catalogItems ?? 0}, billingAccount=${evidence?.billingAccount === true}, invoices=${evidence?.invoices ?? 0}, subscriptions=${evidence?.subscriptions ?? 0}, revenueBuckets=${evidence?.revenueBuckets ?? 0}. (${billing.path})`,
  };
}

function resolveProviderInvocationLedgerCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Provider invocation ledger was marked failed by the release gate caller.',
    };
  }

  const aiRag = readRuntimeEvidenceReport(projectRoot, 'ai-rag-local');
  const providerMatrix = readProviderMatrixReport(projectRoot);
  const report = aiRag.report ?? providerMatrix.report;
  const reportPath = aiRag.report ? aiRag.path : providerMatrix.path;
  const reportError = aiRag.error ?? providerMatrix.error;
  if (!report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${reportError ?? 'Provider invocation ledger evidence is missing.'} Run npm run host:ai-rag-local-smoke or npm run host:provider-matrix. (${reportPath})`,
    };
  }

  if (requestedStatus === 'passed' && (report as RuntimeEvidenceReport).required !== true) {
    return {
      status: 'failed',
      evidence: `Provider invocation ledger strict evidence must be generated by a required provider smoke. (${reportPath})`,
    };
  }

  const evidence = providerInvocationEvidenceFromReport(report);
  const operations = new Set(evidence?.operations ?? []);
  const kinds = new Set(evidence?.kinds ?? []);
  const ok =
    (evidence?.invocations ?? 0) >= 2 &&
    (evidence?.successful ?? 0) >= 2 &&
    (evidence?.failed ?? 0) === 0 &&
    operations.has('generateText') &&
    operations.has('embedText') &&
    (evidence?.ragSources ?? 0) >= 1 &&
    (evidence?.ragChunks ?? 0) >= 1 &&
    (kinds.size === 0 || kinds.has('ai')) &&
    (kinds.size === 0 || kinds.has('rag'));
  if (ok) {
    return {
      status: 'passed',
      evidence: `Provider invocation ledger passed with ${evidence?.invocations ?? 0} records for ${[...operations].join(', ')}, ${evidence?.ragSources ?? 0} RAG sources and ${evidence?.ragChunks ?? 0} RAG chunks. (${reportPath})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Provider invocation ledger evidence is incomplete. invocations=${evidence?.invocations ?? 0}, successful=${evidence?.successful ?? 0}, failed=${evidence?.failed ?? 0}, operations=${(evidence?.operations ?? []).join(', ') || 'none'}, ragSources=${evidence?.ragSources ?? 0}, ragChunks=${evidence?.ragChunks ?? 0}, connectorInvocations=${evidence?.connectorInvocations ?? 0}. (${reportPath})`,
  };
}

function resolveWorkerSoakCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Worker soak was marked failed by the release gate caller.',
    };
  }

  const soak = readWorkerSoakReport(projectRoot);
  if (!soak.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${soak.error} Run npm run host:worker-soak. (${soak.path})`,
    };
  }

  if (requestedStatus === 'passed' && soak.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Worker soak strict evidence must be generated with npm run host:worker-soak -- --required. (${soak.path})`,
    };
  }

  const enqueued = soak.report.enqueued ?? 0;
  const processed = soak.report.drain?.processed ?? 0;
  const failed = soak.report.drain?.failed ?? 0;
  const deadLettered = soak.report.drain?.deadLettered ?? 0;
  const passed = soak.report.ok === true && processed >= enqueued && failed === 0 && deadLettered === 0;
  if (passed) {
    return {
      status: 'passed',
      evidence: `Worker soak passed at ${soak.report.checkedAt ?? 'unknown time'} with ${processed}/${enqueued} records processed and ${soak.report.drain?.iterations ?? 0} iterations. (${soak.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Worker soak did not pass. processed=${processed}/${enqueued}, failed=${failed}, deadLettered=${deadLettered}. (${soak.path})`,
  };
}

function resolveRuntimeStoresCheck(
  projectRoot: string,
  requestedStatus: ReleaseCandidateCheckStatus
): ResolvedCheckEvidence {
  if (requestedStatus === 'failed') {
    return {
      status: 'failed',
      evidence: 'Runtime store Postgres evidence was marked failed by the release gate caller.',
    };
  }

  const postgres = readRuntimeStorePostgresReport(projectRoot);
  if (!postgres.report) {
    return {
      status: requestedStatus === 'passed' ? 'failed' : 'pending',
      evidence: `${postgres.error} Run npm run host:postgres-local-smoke. (${postgres.path})`,
    };
  }

  if (requestedStatus === 'passed' && postgres.report.required !== true) {
    return {
      status: 'failed',
      evidence: `Runtime store strict evidence must be generated by npm run host:postgres-local-smoke. (${postgres.path})`,
    };
  }

  const failedChecks = (postgres.report.checks ?? [])
    .filter((check) => check.ok === false)
    .map((check) => check.id ?? 'unknown');
  if (postgres.report.ok === true) {
    return {
      status: 'passed',
      evidence: `Runtime store Postgres smoke passed at ${postgres.report.checkedAt ?? 'unknown time'} with ${postgres.report.profile ?? 'unknown'} profile. (${postgres.path})`,
    };
  }

  return {
    status: requestedStatus === 'passed' ? 'failed' : 'pending',
    evidence: `Runtime store Postgres smoke did not pass. Failed checks: ${failedChecks.join(', ') || 'unknown'}. (${postgres.path})`,
  };
}

function resolveCheckEvidence(
  projectRoot: string,
  checkId: string,
  requested: ReleaseCandidateCheckStatus | boolean | undefined
): ResolvedCheckEvidence {
  const requestedStatus = normalizeCheckStatus(requested);
  if (checkId === 'module-contract') {
    return resolveModuleReportsCheck(projectRoot, requestedStatus, 'Module contract');
  }
  if (checkId === 'host-product-smoke') {
    return resolveHostProductSmokeCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'web-shell') {
    return resolveWebShellCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'runtime-stores') {
    return resolveRuntimeStoresCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'production-adapters') {
    return resolveProductionAdaptersCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'security-operations') {
    return resolveSecurityOperationsCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'demo-products') {
    return resolveModuleReportsCheck(projectRoot, requestedStatus, 'Demo products');
  }
  if (checkId === 'provider-live-matrix') {
    return resolveProviderMatrixCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'worker-soak') {
    return resolveWorkerSoakCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'delivery-ledger') {
    return resolveDeliveryLedgerCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'browser-matrix') {
    return resolveBrowserMatrixCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'accessibility-smoke') {
    return resolveAccessibilitySmokeCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'module-quality') {
    return resolveModuleQualityCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'product-presentation-kernel') {
    return resolveProductPresentationCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'white-label-presentation') {
    return resolveWhiteLabelPresentationCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'data-safety-matrix') {
    return resolveDataSafetyCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'drift-check-matrix') {
    return resolveDriftCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'backup-restore-matrix') {
    return resolveBackupRestoreCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'upgrade-migration-matrix') {
    return resolveUpgradeMigrationCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'chaos-matrix') {
    return resolveChaosCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'commercial-domain') {
    return resolveCommercialDomainCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'provider-invocation-ledger') {
    return resolveProviderInvocationLedgerCheck(projectRoot, requestedStatus);
  }
  if (checkId === 'documentation') {
    return resolveDocumentationCheck(projectRoot, requestedStatus);
  }
  return {
    status: requestedStatus,
    evidence: requested !== undefined ? 'provided by release gate caller' : undefined,
  };
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function collectFiles(root: string, target: string): string[] {
  const absolute = path.resolve(root, target);
  if (!fs.existsSync(absolute)) {
    return [];
  }
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    return isTextFile(absolute) ? [absolute] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          visit(path.join(dir, entry.name));
        }
        continue;
      }
      const filePath = path.join(dir, entry.name);
      if (entry.isFile() && isTextFile(filePath)) {
        files.push(filePath);
      }
    }
  };
  visit(absolute);
  return files;
}

function isCleanupContext(relativePath: string, line: string): boolean {
  const normalized = slash(relativePath);
  if (normalized.startsWith('docs/old-ploykit-')) {
    return true;
  }
  if (
    /(do not|don't|must not|never|legacy|old|forbidden|deny|cleanup|remove|removed|no longer|not use)/i.test(
      line
    )
  ) {
    return true;
  }
  if (
    /(不恢复|不使用|不迁移|不保留|不再|不应|不能|不得|不要|没有新增|删除|旧|老|禁止|阻断|清理|门禁|拒绝|禁用)/u.test(
      line
    )
  ) {
    return true;
  }
  if (normalized.startsWith('docs/') && /(\.\.\/PloyKit|老代码|材料库)/u.test(line)) {
    return true;
  }
  return false;
}

function scanFile(root: string, filePath: string): ReleaseCandidateDiagnostic[] {
  const relativePath = slash(path.relative(root, filePath));
  const content = fs.readFileSync(filePath, 'utf8');
  const diagnostics: ReleaseCandidateDiagnostic[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const term of LEGACY_RUNTIME_TERMS) {
      if (!line.includes(term.value) || isCleanupContext(relativePath, line)) {
        continue;
      }
      diagnostics.push({
        severity: 'error',
        code: term.code,
        message: `Formal v2 entry mentions ${term.formalName}.`,
        path: relativePath,
        line: index + 1,
        term: term.formalName,
        snippet: line.trim(),
        fix: 'Replace the formal entry with defineModule, ctx.data, modules/, and the v2 module runtime contract.',
      });
    }
  });

  return diagnostics;
}

export function runReleaseCandidateGate(
  input: RunReleaseCandidateGateInput
): ReleaseCandidateGateResult {
  const projectRoot = path.resolve(input.projectRoot);
  const profile = input.profile ?? 'maintainer';
  const targets = input.targets ?? DEFAULT_TARGETS;
  const files = [...new Set(targets.flatMap((target) => collectFiles(projectRoot, target)))].sort();
  const diagnostics = files.flatMap((file) => scanFile(projectRoot, file));
  const profileRequiredChecks = new Set(PROFILE_REQUIRED_CHECKS[profile]);
  const checks = REQUIRED_CHECKS.map((check) => {
    const evidence = resolveCheckEvidence(projectRoot, check.id, input.requiredChecks?.[check.id]);
    return {
      ...check,
      required: profileRequiredChecks.has(check.id),
      status: evidence.status,
      evidence: evidence.evidence,
    };
  });

  return {
    ok:
      diagnostics.every((item) => item.severity !== 'error') &&
      checks.every((check) => !check.required || check.status === 'passed'),
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    profile,
    scannedFiles: files.length,
    diagnostics,
    checks,
  };
}

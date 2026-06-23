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

export interface LegacyRuntimeTerm {
  code: string;
  value: string;
  formalName: string;
}

export interface ResolvedCheckEvidence {
  status: ReleaseCandidateCheckStatus;
  evidence?: string;
}

export interface ProviderMatrixReport {
  ok?: boolean;
  required?: boolean;
  checkedAt?: string;
  checks?: { id?: string; ok?: boolean }[];
}

export interface WorkerSoakReport {
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

export interface RuntimeStorePostgresReport {
  ok?: boolean;
  required?: boolean;
  checkedAt?: string;
  profile?: string;
  checks?: { id?: string; ok?: boolean }[];
}

export interface RuntimeEvidenceReport {
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

export type DriftCheckReport = Omit<RuntimeEvidenceReport, 'summary'> & {
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

export interface CommercialDomainEvidence {
  orders?: number;
  paidOrders?: number;
  invoices?: number;
  subscriptions?: number;
  catalogItems?: number;
  billingAccount?: boolean;
  revenueBuckets?: number;
}

export interface ProviderInvocationEvidence {
  invocations?: number;
  successful?: number;
  failed?: number;
  operations?: string[];
  kinds?: string[];
  ragSources?: number;
  ragChunks?: number;
  connectorInvocations?: number;
}

export interface FilesCleanupReport extends RuntimeEvidenceReport {
  file?: {
    id?: string;
    status?: string;
    objectDeleted?: boolean;
  };
  cleanup?: {
    matched?: number;
    cleanedFileIds?: string[];
    auditId?: string;
  };
  storage?: {
    mode?: string;
    durable?: boolean;
  };
}

export interface FilesReconcileReport extends RuntimeEvidenceReport {
  checks?: { id?: string; ok?: boolean; status?: string }[];
  report?: {
    checkedFiles?: number;
    issues?: number;
    presentObjects?: number;
    missingObjects?: number;
    deletedObjectsPresent?: number;
    missingActiveObjects?: number;
    sizeMismatches?: number;
    checksumMismatches?: number;
    orphanObjects?: number;
    orphanBytes?: number;
  };
}

export interface ProductPresentationManifest {
  kind?: string;
  checkedAt?: string;
  diagnostics?: { severity?: string; code?: string; message?: string; path?: string }[];
  product?: { id?: string; supportedLanguages?: string[] };
  pages?: Record<string, unknown>;
  theme?: { rejectedTokens?: string[]; rejectedDarkTokens?: string[] };
}

export interface ModuleTestReport {
  success?: boolean;
  moduleRoot?: string;
  checkedAt?: string;
  steps?: { name?: string; ok?: boolean; status?: number }[];
}

export interface ModuleQualityRouteEvidence {
  path?: string;
  viewports?: string[];
}

export interface ModuleQualityCommand {
  script?: string;
  args?: string[];
}

export interface ModuleQualityRuntimeEvidence {
  id?: string;
  title?: string;
  runtimeDir?: string;
  required?: boolean;
  command?: ModuleQualityCommand;
  checks?: string[];
}

export interface ModuleQualityDashboardTransitionsPerformance {
  routes?: string[];
  maxDocumentNavigations?: number;
  maxHydrationErrors?: number;
  maxP95Ms?: number;
  maxRscTransferBytes?: number;
}

export interface ModuleQualityApiRoutePerformance {
  path?: string;
  method?: string;
  auth?: string;
  maxP95Ms?: number;
  maxResponseBytes?: number;
}

export interface ModuleQualityPageRoutePerformance {
  shell?: string;
  path?: string;
  params?: Record<string, string>;
  samplePath?: string;
  maxLoaderMs?: number;
  maxLoaderDataBytes?: number;
}

export interface ModuleQualityPerformanceDefinition {
  dashboardTransitions?: ModuleQualityDashboardTransitionsPerformance;
  pageRoutes?: ModuleQualityPageRoutePerformance[];
  apiRoutes?: ModuleQualityApiRoutePerformance[];
}

export interface ModuleQualityDefinition {
  routes?: {
    browser?: ModuleQualityRouteEvidence[];
    accessibility?: ModuleQualityRouteEvidence[];
  };
  performance?: ModuleQualityPerformanceDefinition;
  evidence?: ModuleQualityRuntimeEvidence[];
}

export interface ModuleMapManifestModule {
  id?: string;
  name?: string;
  quality?: ModuleQualityDefinition;
}

export interface ModuleMapManifest {
  modules?: ModuleMapManifestModule[];
}

export interface ModuleQualityRouteRequirement {
  moduleId: string;
  path: string;
  viewports: readonly string[];
}

export interface ModuleQualityEvidenceRequirement {
  moduleId: string;
  title: string;
  id: string;
  runtimeDir: string;
  command?: ModuleQualityCommand;
  checks: readonly string[];
}

export interface ModuleDashboardTransitionRequirement {
  moduleId: string;
  route: string;
  maxDocumentNavigations?: number;
  maxHydrationErrors?: number;
  maxP95Ms?: number;
  maxRscTransferBytes?: number;
}

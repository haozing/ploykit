import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import {
  runHostConfigDoctor,
  type HostConfigDoctorReport,
  type HostConfigDoctorStatus,
  type HostProviderReadiness,
} from './config-doctor';
import { defaultProductId } from './default-scope';
import { DEFAULT_LANGUAGE, localizedAdminPath } from './i18n';
import { getHostRuntimeStore } from './runtime-store';

export type AdminProviderEvidenceStatus = 'passed' | 'failed' | 'skipped' | 'missing';
export type AdminProviderFailureSeverity = 'warning' | 'error';

export interface AdminProviderFailureDetail {
  checkId: string;
  status: AdminProviderEvidenceStatus | HostConfigDoctorStatus;
  severity: AdminProviderFailureSeverity;
  reason: string;
  missing: string[];
  command?: string;
  action: string;
}

export type AdminProviderOperationKind = 'admin-link' | 'command' | 'evidence';

export interface AdminProviderOperation {
  id: string;
  label: string;
  kind: AdminProviderOperationKind;
  href?: string;
  command?: string;
  detail: string;
}

export interface AdminProviderFailureTimelineItem {
  id: string;
  providerId: string;
  kind: string;
  operation: string;
  moduleId?: string | null;
  target?: string | null;
  serviceConnectionId?: string | null;
  resourceBindingId?: string | null;
  latencyMs: number;
  error?: string;
  createdAt: string;
}

export interface AdminProviderStatusRow extends HostProviderReadiness {
  label: string;
  evidenceStatus: AdminProviderEvidenceStatus;
  evidence: string;
  action: string;
  matrixCheckIds: string[];
  failureDetails: AdminProviderFailureDetail[];
  failureTimeline: AdminProviderFailureTimelineItem[];
  operations: AdminProviderOperation[];
}

export interface AdminProviderMatrixCheckSummary {
  id: string;
  status: AdminProviderEvidenceStatus;
  command?: string;
  detail: string;
  error?: string;
  missing: string[];
}

export interface AdminProviderMatrixSummary {
  exists: boolean;
  ok: boolean;
  required: boolean;
  checkedAt?: string;
  latestPath: string;
  reportPath?: string;
  failedChecks: string[];
  skippedChecks: string[];
  localDepth: {
    present: boolean;
    ok: boolean;
    checks: number;
    failedChecks: string[];
    reportPath?: string;
  };
  checks: AdminProviderMatrixCheckSummary[];
}

export interface AdminProviderStatusView {
  checkedAt: string;
  ok: boolean;
  providersReady: number;
  providersTotal: number;
  providersBlocked: number;
  providersWarning: number;
  providers: AdminProviderStatusRow[];
  diagnostics: HostConfigDoctorReport['diagnostics'];
  matrix: AdminProviderMatrixSummary;
}

export interface AdminProviderStatusAuditResult {
  auditId: string;
  providerStatus: AdminProviderStatusView;
}

interface ProviderMatrixReport {
  ok?: unknown;
  required?: unknown;
  checkedAt?: unknown;
  artifacts?: {
    report?: unknown;
  };
  checks?: ProviderMatrixRawCheck[];
}

interface ProviderMatrixRawCheck {
  id?: unknown;
  ok?: unknown;
  skipped?: unknown;
  command?: unknown;
  detail?: unknown;
  error?: unknown;
}

const PROVIDER_LABELS: Record<string, string> = {
  'runtime-store': 'Runtime Store',
  files: 'Files',
  billing: 'Billing',
  auth: 'Auth',
  ai: 'AI',
  rag: 'RAG',
  notifications: 'Notifications',
  email: 'Email',
  security: 'Security',
};

const MATRIX_CHECKS_BY_PROVIDER: Record<string, string[]> = {
  files: [
    'provider-config:files',
    'local-provider-depth',
    'files-cleanup',
    'files-reconcile',
    's3-local-minio',
    's3-compatible-storage',
  ],
  billing: [
    'provider-config:billing',
    'local-provider-depth',
    'stripe-commerce',
    'billing-reconcile',
  ],
  email: ['provider-config:email', 'email-local-webhook', 'email-delivery'],
  ai: ['provider-config:ai', 'local-provider-depth', 'ai-rag-local', 'ai-webhook-local'],
  rag: ['provider-config:rag', 'local-provider-depth', 'ai-rag-local', 'rag-provider'],
  notifications: ['provider-config:notifications', 'local-provider-depth'],
};

function stringifyDetail(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (typeof object.reason === 'string') {
      return object.reason;
    }
    if (Array.isArray(object.missing) && object.missing.length > 0) {
      return `missing ${object.missing.join(', ')}`;
    }
    if (typeof object.mode === 'string') {
      return `mode ${object.mode}`;
    }
    if (object.ok !== undefined) {
      return `ok=${String(object.ok)}`;
    }
  }
  const json = JSON.stringify(value);
  return json.length > 160 ? `${json.slice(0, 157)}...` : json;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function collectMissing(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return [...new Set(value.flatMap((item) => collectMissing(item)))];
  }
  const object = value as Record<string, unknown>;
  return [
    ...readStringList(object.missing),
    ...readStringList(object.requiredMissing),
    ...Object.values(object).flatMap((item) => collectMissing(item)),
  ].filter((item, index, all) => all.indexOf(item) === index);
}

function checkStatus(check: ProviderMatrixRawCheck): AdminProviderEvidenceStatus {
  if (check.ok === false) {
    return 'failed';
  }
  if (check.skipped === true) {
    return 'skipped';
  }
  return check.ok === true ? 'passed' : 'missing';
}

function toCheckSummary(check: ProviderMatrixRawCheck): AdminProviderMatrixCheckSummary {
  return {
    id: typeof check.id === 'string' ? check.id : 'unknown',
    status: checkStatus(check),
    command: typeof check.command === 'string' ? check.command : undefined,
    detail: stringifyDetail(check.detail),
    error: typeof check.error === 'string' ? check.error : undefined,
    missing: collectMissing(check.detail),
  };
}

function emptyMatrixSummary(latestPath: string): AdminProviderMatrixSummary {
  return {
    exists: false,
    ok: false,
    required: false,
    latestPath,
    failedChecks: [],
    skippedChecks: [],
    localDepth: {
      present: false,
      ok: false,
      checks: 0,
      failedChecks: [],
    },
    checks: [],
  };
}

async function readProviderMatrix(projectRoot: string): Promise<AdminProviderMatrixSummary> {
  const latestPath = path.join(projectRoot, '.runtime', 'provider-matrix', 'latest.json');
  let report: ProviderMatrixReport;
  try {
    report = JSON.parse(await fs.readFile(latestPath, 'utf8')) as ProviderMatrixReport;
  } catch {
    return emptyMatrixSummary(latestPath);
  }

  const checks = (Array.isArray(report.checks) ? report.checks : []).map(toCheckSummary);
  const localDepthRaw = (Array.isArray(report.checks) ? report.checks : []).find(
    (check) => check.id === 'local-provider-depth'
  );
  const localDepthDetail =
    localDepthRaw && typeof localDepthRaw.detail === 'object' && localDepthRaw.detail
      ? (localDepthRaw.detail as {
          checks?: { id?: string; ok?: boolean }[];
          artifacts?: { report?: string };
        })
      : null;
  const localDepthChecks = Array.isArray(localDepthDetail?.checks) ? localDepthDetail.checks : [];
  const failedChecks = checks.filter((check) => check.status === 'failed').map((check) => check.id);
  const skippedChecks = checks
    .filter((check) => check.status === 'skipped')
    .map((check) => check.id);

  return {
    exists: true,
    ok: report.ok === true,
    required: report.required === true,
    checkedAt: typeof report.checkedAt === 'string' ? report.checkedAt : undefined,
    latestPath,
    reportPath: typeof report.artifacts?.report === 'string' ? report.artifacts.report : undefined,
    failedChecks,
    skippedChecks,
    localDepth: {
      present: Boolean(localDepthRaw),
      ok: localDepthRaw?.ok === true,
      checks: localDepthChecks.length,
      failedChecks: localDepthChecks
        .filter((check) => check.ok === false)
        .map((check) => check.id ?? 'unknown'),
      reportPath: localDepthDetail?.artifacts?.report,
    },
    checks,
  };
}

function statusAction(provider: HostProviderReadiness, matrix: AdminProviderMatrixSummary): string {
  if (provider.status === 'blocked') {
    return 'Configure required secrets or provider environment, then rerun provider matrix.';
  }
  if (provider.id === 'runtime-store' && provider.status !== 'ready') {
    return 'Set DATABASE_URL and run runtime store migrations before production.';
  }
  if (provider.id === 'auth' && provider.status !== 'ready') {
    return 'Set PLOYKIT_AUTH_SECRET before production.';
  }
  if (provider.id === 'billing' && provider.status !== 'ready') {
    return 'Use local ledger for development; configure Stripe required matrix for paid production.';
  }
  if (provider.id === 'email' && provider.status !== 'ready') {
    return 'Use log delivery locally; configure webhook email provider for production.';
  }
  if (provider.id === 'rag' && provider.status !== 'ready') {
    return 'Use memory-vector RAG locally; add durable vector store before production scale.';
  }
  if (!matrix.exists) {
    return 'Run npm run host:provider-matrix to attach latest evidence.';
  }
  if (provider.status === 'warning') {
    return 'Accept for local development; required RC profile must document or replace this provider.';
  }
  return 'Ready in current profile.';
}

function failureAction(input: {
  provider: HostProviderReadiness & { label?: string };
  check: AdminProviderMatrixCheckSummary;
  missing: string[];
}): string {
  if (input.missing.length > 0) {
    return `Configure ${input.missing.join(', ')} and rerun ${input.check.command ?? 'provider matrix'}.`;
  }
  if (input.check.status === 'skipped') {
    return 'Accept for local development, or run the required provider profile to prove production readiness.';
  }
  if (input.check.status === 'missing') {
    return 'Run npm run host:provider-matrix to attach latest provider evidence.';
  }
  if (input.check.status === 'failed') {
    return `Fix ${input.provider.label ?? input.provider.id} provider failure and rerun provider matrix.`;
  }
  return 'No action required.';
}

function providerFailureDetails(
  provider: HostProviderReadiness & { label?: string },
  matrix: AdminProviderMatrixSummary
): AdminProviderFailureDetail[] {
  const details: AdminProviderFailureDetail[] = [];
  if (provider.status !== 'ready') {
    details.push({
      checkId: 'config-doctor:provider-readiness',
      status: provider.status,
      severity: provider.status === 'blocked' ? 'error' : 'warning',
      reason: provider.detail,
      missing: [],
      action: statusAction(provider, matrix),
    });
  }

  const matrixCheckIds = MATRIX_CHECKS_BY_PROVIDER[provider.id] ?? [];
  if (matrixCheckIds.length === 0) {
    return details;
  }
  if (!matrix.exists) {
    details.push({
      checkId: 'provider-matrix:latest',
      status: 'missing',
      severity: 'warning',
      reason: 'Provider matrix latest evidence is missing.',
      missing: [],
      action: 'Run npm run host:provider-matrix.',
    });
    return details;
  }

  const checks = matrix.checks.filter((check) => matrixCheckIds.includes(check.id));
  for (const check of checks) {
    if (check.status === 'passed') {
      continue;
    }
    const missing = check.missing;
    details.push({
      checkId: check.id,
      status: check.status,
      severity: check.status === 'failed' ? 'error' : 'warning',
      reason: check.error ?? check.detail,
      missing,
      command: check.command,
      action: failureAction({ provider, check, missing }),
    });
  }

  if (
    matrixCheckIds.includes('local-provider-depth') &&
    matrix.localDepth.present &&
    !matrix.localDepth.ok
  ) {
    details.push({
      checkId: 'local-provider-depth:subchecks',
      status: 'failed',
      severity: 'error',
      reason:
        matrix.localDepth.failedChecks.length > 0
          ? `Failed local depth checks: ${matrix.localDepth.failedChecks.join(', ')}`
          : 'Local provider depth did not pass.',
      missing: [],
      command: 'npm run host:local-provider-smoke',
      action:
        'Open local provider depth report, fix failed runtime smoke, then rerun provider matrix.',
    });
  }

  return details;
}

function evidenceForProvider(
  provider: HostProviderReadiness,
  matrix: AdminProviderMatrixSummary
): Pick<AdminProviderStatusRow, 'evidenceStatus' | 'evidence' | 'matrixCheckIds'> {
  const matrixCheckIds = MATRIX_CHECKS_BY_PROVIDER[provider.id] ?? [];
  if (matrixCheckIds.length === 0) {
    return {
      evidenceStatus: matrix.exists ? 'passed' : 'missing',
      evidence: matrix.exists ? 'Config doctor evidence only.' : 'Provider matrix has not run.',
      matrixCheckIds,
    };
  }

  const checks = matrix.checks.filter((check) => matrixCheckIds.includes(check.id));
  const failed = checks.filter((check) => check.status === 'failed');
  const passed = checks.filter((check) => check.status === 'passed');
  const skipped = checks.filter((check) => check.status === 'skipped');
  if (!matrix.exists || checks.length === 0) {
    return {
      evidenceStatus: 'missing',
      evidence: 'No matching provider matrix evidence.',
      matrixCheckIds,
    };
  }
  if (failed.length > 0) {
    return {
      evidenceStatus: 'failed',
      evidence: `Failed: ${failed.map((check) => check.id).join(', ')}`,
      matrixCheckIds,
    };
  }
  if (passed.length > 0) {
    return {
      evidenceStatus: skipped.length > 0 ? 'skipped' : 'passed',
      evidence: [
        `${passed.length} checks passed`,
        skipped.length > 0 ? `${skipped.length} skipped` : null,
        matrix.required ? 'required profile' : 'local profile',
      ]
        .filter(Boolean)
        .join(' · '),
      matrixCheckIds,
    };
  }
  return {
    evidenceStatus: skipped.length > 0 ? 'skipped' : 'missing',
    evidence: skipped.length > 0 ? `${skipped.length} checks skipped` : 'No passing evidence.',
    matrixCheckIds,
  };
}

function providerOperationCommands(providerId: string): AdminProviderOperation[] {
  if (providerId === 'files') {
    return [
      {
        id: 'files.cleanup-smoke',
        label: 'Files Cleanup Smoke',
        kind: 'command',
        command: 'npm run host:files-cleanup-smoke',
        detail: 'Validate deleted file object cleanup and audit-backed retention path.',
      },
      {
        id: 'files.reconcile-smoke',
        label: 'Files Reconcile Smoke',
        kind: 'command',
        command: 'npm run host:files-reconcile-smoke',
        detail:
          'Validate metadata/object reconciliation for missing, stale deleted, and drift cases.',
      },
      {
        id: 'files.s3.required-smoke',
        label: 'S3 Required Smoke',
        kind: 'command',
        command: 'npm run host:s3-smoke -- --required --check-signed-url',
        detail:
          'Validate S3-compatible bucket credentials, upload/read/delete, and signed URL path.',
      },
      {
        id: 'files.s3.local-minio-smoke',
        label: 'Local MinIO S3 Smoke',
        kind: 'command',
        command: 'npm run host:s3-local-smoke',
        detail:
          'Start the local MinIO profile and validate S3-compatible signed URL fetch end to end.',
      },
    ];
  }
  if (providerId === 'billing') {
    return [
      {
        id: 'billing.stripe.required-smoke',
        label: 'Stripe Required Smoke',
        kind: 'command',
        command: 'npm run host:stripe-smoke -- --required --apply-ledger',
        detail: 'Validate Stripe checkout/webhook configuration and local ledger application.',
      },
      {
        id: 'billing.stripe.local-mock-smoke',
        label: 'Local Mock Stripe Smoke',
        kind: 'command',
        command: 'npm run host:stripe-local-smoke',
        detail:
          'Validate checkout request shape, webhook signature, and ledger apply without external Stripe keys.',
      },
      {
        id: 'billing.reconcile-smoke',
        label: 'Billing Reconcile Smoke',
        kind: 'command',
        command: 'npm run host:billing-reconcile-smoke',
        detail:
          'Validate provider order reconcile discrepancies, benefit reconcile, credit reconcile, and audit evidence.',
      },
    ];
  }
  if (providerId === 'email') {
    return [
      {
        id: 'email.local-webhook-smoke',
        label: 'Local Email Webhook Smoke',
        kind: 'command',
        command: 'npm run host:email-local-webhook-smoke',
        detail:
          'Start a local signed email webhook and validate the required delivery path end to end.',
      },
      {
        id: 'email.required-smoke',
        label: 'Email Required Smoke',
        kind: 'command',
        command: 'npm run host:email-smoke -- --required',
        detail: 'Validate email provider configuration, webhook signature, and delivery path.',
      },
    ];
  }
  if (providerId === 'runtime-store') {
    return [
      {
        id: 'runtime-store.local-postgres-smoke',
        label: 'Local Postgres Smoke',
        kind: 'command',
        command: 'npm run host:postgres-local-smoke',
        detail:
          'Start local Docker Postgres and validate runtime store schema, tests, commercial ledger, and runtime checks.',
      },
      {
        id: 'runtime-store.verify',
        label: 'Runtime Store Verify',
        kind: 'command',
        command: 'npm run runtime:stores:verify',
        detail: 'Verify runtime store schema and adapter behavior before production.',
      },
    ];
  }
  if (providerId === 'ai' || providerId === 'rag') {
    return [
      {
        id: `${providerId}.ai-rag-local-smoke`,
        label: 'AI/RAG Local Smoke',
        kind: 'command',
        command: 'npm run host:ai-rag-local-smoke',
        detail: 'Validate AI provider runtime, RAG indexing, and the ai-rag demo module contract.',
      },
      ...(providerId === 'rag'
        ? [
            {
              id: 'rag.provider-smoke',
              label: 'RAG Provider Smoke',
              kind: 'command' as const,
              command: 'npm run host:rag-provider-smoke',
              detail:
                'Validate host RAG memory-vector provider, workspace isolation, delete, and audit evidence.',
            },
          ]
        : []),
      ...(providerId === 'ai'
        ? [
            {
              id: 'ai.webhook-local-smoke',
              label: 'AI Webhook Local Smoke',
              kind: 'command' as const,
              command: 'npm run host:ai-webhook-local-smoke',
              detail:
                'Validate the host AI webhook provider adapter, signed request, text generation, and embeddings.',
            },
          ]
        : []),
      {
        id: `${providerId}.local-depth`,
        label: 'Local Provider Depth',
        kind: 'command',
        command: 'npm run host:local-provider-smoke',
        detail: 'Validate local provider runtime behavior through the provider depth smoke.',
      },
    ];
  }
  if (providerId === 'notifications') {
    return [
      {
        id: `${providerId}.local-depth`,
        label: 'Local Provider Depth',
        kind: 'command',
        command: 'npm run host:local-provider-smoke',
        detail: 'Validate local provider runtime behavior through the provider depth smoke.',
      },
    ];
  }
  return [];
}

function providerOperations(
  provider: HostProviderReadiness,
  matrix: AdminProviderMatrixSummary
): AdminProviderOperation[] {
  return [
    {
      id: `${provider.id}.service-connection`,
      label: 'Service Connection',
      kind: 'admin-link',
      href: localizedAdminPath(
        DEFAULT_LANGUAGE,
        `/service-connections?service=${encodeURIComponent(provider.id)}`
      ),
      detail: 'Open the Admin service connection row for this provider.',
    },
    {
      id: `${provider.id}.provider-matrix`,
      label: 'Provider Matrix',
      kind: 'command',
      command: matrix.required
        ? 'npm run host:provider-matrix -- --required'
        : 'npm run host:provider-matrix',
      detail: matrix.exists
        ? `Latest matrix evidence: ${matrix.checkedAt ?? 'unknown time'}`
        : 'Attach provider matrix evidence for this provider.',
    },
    {
      id: `${provider.id}.latest-evidence`,
      label: 'Latest Evidence',
      kind: 'evidence',
      href: matrix.reportPath ?? matrix.latestPath,
      detail: matrix.exists
        ? 'Open latest provider matrix artifact.'
        : 'Provider matrix artifact is missing.',
    },
    ...providerOperationCommands(provider.id),
  ];
}

function enrichProvider(
  provider: HostProviderReadiness,
  matrix: AdminProviderMatrixSummary,
  failureTimeline: readonly AdminProviderFailureTimelineItem[] = []
): AdminProviderStatusRow {
  const label = PROVIDER_LABELS[provider.id] ?? provider.id;
  const providerWithLabel = { ...provider, label };
  return {
    ...provider,
    label,
    ...evidenceForProvider(provider, matrix),
    action: statusAction(provider, matrix),
    failureDetails: providerFailureDetails(providerWithLabel, matrix),
    failureTimeline: failureTimeline.filter(
      (item) => normalizeProviderId(item.providerId) === normalizeProviderId(provider.id)
    ),
    operations: providerOperations(provider, matrix),
  };
}

function normalizeProviderId(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.includes('memory-vector') || normalized.includes('rag') || normalized.includes('vector')) {
    return 'rag';
  }
  if (normalized.includes('static') || normalized.includes('local-test') || normalized.includes('webhook') || normalized.includes('ai')) {
    return 'ai';
  }
  if (normalized.includes('stripe') || normalized.includes('billing') || normalized.includes('payment')) {
    return 'billing';
  }
  if (normalized.includes('email') || normalized.includes('mail')) {
    return 'email';
  }
  if (normalized.includes('s3') || normalized.includes('file') || normalized.includes('storage')) {
    return 'files';
  }
  if (normalized.includes('postgres') || normalized.includes('runtime-store') || normalized.includes('database')) {
    return 'runtime-store';
  }
  return normalized;
}

async function readProviderFailureTimeline(
  productId: string
): Promise<AdminProviderFailureTimelineItem[]> {
  const runtimeStore = await getHostRuntimeStore();
  const failed = await runtimeStore.store.listProviderInvocations({
    productId,
    status: 'failed',
  });
  return failed.slice(0, 50).map((record) => ({
    id: record.id,
    providerId: record.providerId,
    kind: record.kind,
    operation: record.operation,
    moduleId: record.moduleId,
    target: record.target,
    serviceConnectionId: record.serviceConnectionId,
    resourceBindingId: record.resourceBindingId,
    latencyMs: record.latencyMs,
    error: record.error?.message,
    createdAt: record.createdAt,
  }));
}

export async function getAdminProviderStatusView(
  options: {
    projectRoot?: string;
    configDoctor?: HostConfigDoctorReport;
  } = {}
): Promise<AdminProviderStatusView> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const [configDoctor, matrix, failureTimeline] = await Promise.all([
    options.configDoctor
      ? Promise.resolve(options.configDoctor)
      : runHostConfigDoctor({ projectRoot }),
    readProviderMatrix(projectRoot),
    readProviderFailureTimeline(defaultProductId(undefined)),
  ]);
  const providers = configDoctor.providerReadiness.map((provider) =>
    enrichProvider(provider, matrix, failureTimeline)
  );
  const view: AdminProviderStatusView = {
    checkedAt: new Date().toISOString(),
    ok: configDoctor.ok && (!matrix.exists || matrix.ok),
    providersReady: providers.filter((provider) => provider.status === 'ready').length,
    providersTotal: providers.length,
    providersBlocked: providers.filter((provider) => provider.status === 'blocked').length,
    providersWarning: providers.filter((provider) => provider.status === 'warning').length,
    providers,
    diagnostics: configDoctor.diagnostics,
    matrix,
  };

  return redactSensitive(view);
}

export async function recordAdminProviderStatusAudit(
  session: ModuleHostSession,
  options: {
    reason?: string;
    providerStatus?: AdminProviderStatusView;
  } = {}
): Promise<AdminProviderStatusAuditResult> {
  const providerStatus = options.providerStatus ?? (await getAdminProviderStatusView());
  const failures = providerStatus.providers.flatMap((provider) =>
    provider.failureDetails.map((detail) => ({
      providerId: provider.id,
      providerLabel: provider.label,
      checkId: detail.checkId,
      status: detail.status,
      severity: detail.severity,
      missing: detail.missing,
      reason: detail.reason,
      action: detail.action,
    }))
  );
  const runtimeStore = await getHostRuntimeStore();
  const audit = await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.userId ?? session.user?.id,
    type: 'admin.providers.diagnostics_recorded',
    metadata: {
      reason: options.reason ?? 'Provider diagnostics recorded from Admin Providers API',
      ok: providerStatus.ok,
      checkedAt: providerStatus.checkedAt,
      providersReady: providerStatus.providersReady,
      providersTotal: providerStatus.providersTotal,
      providersBlocked: providerStatus.providersBlocked,
      providersWarning: providerStatus.providersWarning,
      matrix: {
        exists: providerStatus.matrix.exists,
        ok: providerStatus.matrix.ok,
        required: providerStatus.matrix.required,
        checkedAt: providerStatus.matrix.checkedAt,
        failedChecks: providerStatus.matrix.failedChecks,
        skippedChecks: providerStatus.matrix.skippedChecks,
        localDepth: providerStatus.matrix.localDepth,
      },
      failures,
      providers: providerStatus.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        mode: provider.mode,
        status: provider.status,
        evidenceStatus: provider.evidenceStatus,
        failureCount: provider.failureDetails.length,
        operations: provider.operations.map((operation) => operation.id),
      })),
    },
  });

  return redactSensitive({
    auditId: audit.id,
    providerStatus,
  });
}

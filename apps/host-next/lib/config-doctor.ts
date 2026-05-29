import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import { getHostRuntimeHealth } from './create-host';
import { getHostWorkerStatus } from './worker';
import { auditDiscoveredHostApiRoutes } from './route-security-audit';
import type { HostRuntimeHealth } from './host-health';
import type { HostRouteSecurityAudit } from './security';

export type HostConfigDoctorSeverity = 'error' | 'warning' | 'info';
export type HostConfigDoctorStatus = 'ready' | 'warning' | 'blocked';

export interface HostConfigDoctorDiagnostic {
  severity: HostConfigDoctorSeverity;
  code: string;
  message: string;
  path: string;
  fix?: string;
}

export interface HostProviderReadiness {
  id: string;
  mode: string;
  status: HostConfigDoctorStatus;
  detail: string;
}

export interface HostRetentionPolicySnapshot {
  files: string;
  auditLogs: string;
  runLogs: string;
  outbox: string;
}

export interface HostMetricsSnapshot {
  routeCatalogEntries: number;
  apiRoutesDiscovered: number;
  mutationRoutes: number;
  workerQueued: number;
  workerDeadLettered: number;
  workerHeartbeatFresh: boolean;
  providersReady: number;
  providersTotal: number;
}

export interface HostConfigDoctorReport {
  ok: boolean;
  required: boolean;
  checkedAt: string;
  diagnostics: HostConfigDoctorDiagnostic[];
  health: HostRuntimeHealth;
  routeSecurity: HostRouteSecurityAudit;
  providerReadiness: HostProviderReadiness[];
  metrics: HostMetricsSnapshot;
  retention: HostRetentionPolicySnapshot;
}

function diagnostic(
  severity: HostConfigDoctorSeverity,
  code: string,
  message: string,
  path: string,
  fix?: string
): HostConfigDoctorDiagnostic {
  return { severity, code, message, path, fix };
}

function readiness(
  id: string,
  mode: string,
  status: HostConfigDoctorStatus,
  detail: string
): HostProviderReadiness {
  return { id, mode, status, detail };
}

function productionProfile(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production' || env.PLOYKIT_PROFILE === 'production';
}

function collectProviderReadiness(health: HostRuntimeHealth): HostProviderReadiness[] {
  const emailStatus =
    health.providers.email.mode === 'webhook'
      ? health.providers.email.webhookConfigured
        ? 'ready'
        : 'blocked'
      : health.providers.email.mode === 'log'
        ? 'warning'
        : 'warning';
  const aiStatus =
    health.providers.ai.mode === 'webhook'
      ? health.providers.ai.webhookConfigured
        ? 'ready'
        : 'blocked'
      : 'warning';
  return [
    readiness(
      'runtime-store',
      health.store.mode,
      health.store.durable ? 'ready' : 'warning',
      health.store.durable ? health.store.databaseLabel : 'memory runtime store'
    ),
    readiness(
      'files',
      health.files.mode,
      health.files.durable ? 'ready' : 'warning',
      health.files.mode === 's3'
        ? `${health.files.bucket ?? 'bucket'} @ ${health.files.region ?? 'region'}`
        : (health.files.rootDir ?? 'memory file storage')
    ),
    readiness(
      'billing',
      health.billing.mode,
      health.billing.mode === 'stripe' && health.billing.stripeConfigured
        ? 'ready'
        : health.billing.mode === 'local'
          ? 'warning'
          : 'blocked',
      health.billing.mode === 'stripe'
        ? `stripe=${String(health.billing.stripeConfigured)}, webhook=${String(
            health.billing.stripeWebhookConfigured
          )}, price=${String(health.billing.priceConfigured)}`
        : 'local billing provider'
    ),
    readiness(
      'auth',
      health.auth.mode,
      health.auth.secretConfigured ? 'ready' : 'warning',
      health.auth.secretConfigured ? 'signed cookie secret configured' : 'development secret'
    ),
    readiness(
      'ai',
      health.providers.ai.mode,
      aiStatus,
      health.providers.ai.mode === 'webhook'
        ? `webhook=${String(health.providers.ai.webhookConfigured)}, signed=${String(
            health.providers.ai.webhookSecretConfigured
          )}, text=${health.providers.ai.textModel}, embedding=${health.providers.ai.embeddingModel}`
        : `${health.providers.ai.mode} provider; configure webhook AI provider before paid production AI`
    ),
    readiness(
      'rag',
      health.providers.rag.mode,
      health.providers.rag.durable ? 'ready' : 'warning',
      health.providers.rag.durable
        ? 'durable RAG vector provider'
        : `${health.providers.rag.mode} index; embeddings=${health.providers.rag.indexer.embeddings}`
    ),
    readiness(
      'notifications',
      health.providers.notifications,
      'ready',
      'runtime-store in-app notification provider'
    ),
    readiness(
      'email',
      health.providers.email.mode,
      emailStatus,
      health.providers.email.mode === 'webhook'
        ? `webhook=${String(health.providers.email.webhookConfigured)}, signed=${String(
            health.providers.email.webhookSecretConfigured
          )}`
        : health.providers.email.mode === 'log'
          ? `local delivery log from ${health.providers.email.from}`
          : 'email provider disabled'
    ),
    readiness(
      'security',
      health.security.routeCatalog,
      'ready',
      `csrf=${health.security.csrf}, origin=${health.security.origin}, rate=${health.security.rateLimit}`
    ),
  ];
}

export async function runHostConfigDoctor(
  options: { required?: boolean; env?: NodeJS.ProcessEnv; projectRoot?: string } = {}
): Promise<HostConfigDoctorReport> {
  const env = options.env ?? process.env;
  const required = options.required ?? false;
  const [health, worker] = await Promise.all([getHostRuntimeHealth(), getHostWorkerStatus()]);
  const routeSecurity = auditDiscoveredHostApiRoutes(options.projectRoot ?? process.cwd());
  const providerReadiness = collectProviderReadiness(health);
  const diagnostics: HostConfigDoctorDiagnostic[] = [];
  const heartbeatFresh =
    worker.heartbeatAt !== null && Date.now() - new Date(worker.heartbeatAt).getTime() < 120_000;

  if (!routeSecurity.ok) {
    diagnostics.push(
      diagnostic(
        'error',
        'HOST_ROUTE_SECURITY_AUDIT_FAILED',
        'Host API routes and route security catalog are not aligned.',
        'apps/host-next/app/api',
        'Add the route to apps/host-next/lib/security.ts and protect the handler with checkHostRouteSecurity or requireApiSession.'
      )
    );
  }

  if (productionProfile(env) || required) {
    if (!health.auth.secretConfigured) {
      diagnostics.push(
        diagnostic(
          'error',
          'HOST_AUTH_SECRET_REQUIRED',
          'Production profile requires an explicit auth/media signing secret.',
          'PLOYKIT_AUTH_SECRET',
          'Set PLOYKIT_AUTH_SECRET or PLOYKIT_MEDIA_SECRET.'
        )
      );
    }
    if (!health.store.durable) {
      diagnostics.push(
        diagnostic(
          'error',
          'HOST_RUNTIME_STORE_DURABLE_REQUIRED',
          'Production profile must not use the memory runtime store.',
          'DATABASE_URL',
          'Set DATABASE_URL and PLOYKIT_RUNTIME_STORE=postgres.'
        )
      );
    }
    if (!health.files.durable) {
      diagnostics.push(
        diagnostic(
          'error',
          'HOST_FILE_STORAGE_DURABLE_REQUIRED',
          'Production profile must not use memory file storage.',
          'PLOYKIT_FILE_STORAGE',
          'Use local persistent storage or S3-compatible storage; required RC matrix should use S3.'
        )
      );
    }
  }

  if (!heartbeatFresh) {
    diagnostics.push(
      diagnostic(
        required ? 'error' : 'warning',
        'HOST_WORKER_HEARTBEAT_STALE',
        'Worker heartbeat is missing or stale.',
        'worker.heartbeatAt',
        'Run npm run host:worker or drain the worker once during required validation.'
      )
    );
  }

  for (const alert of worker.alerts.filter((item) => item.severity === 'error')) {
    diagnostics.push(
      diagnostic('error', 'HOST_WORKER_ALERT', alert.message, `worker.alerts.${alert.code}`)
    );
  }

  if (productionProfile(env) && health.billing.mode === 'local') {
    diagnostics.push(
      diagnostic(
        'warning',
        'HOST_BILLING_PROVIDER_LOCAL',
        'Production profile is using the local billing provider.',
        'PLOYKIT_BILLING_PROVIDER',
        'Configure Stripe for paid production products, or document a deliberate local-only deployment.'
      )
    );
  }

  if (productionProfile(env) && health.providers.email.mode !== 'webhook') {
    diagnostics.push(
      diagnostic(
        'warning',
        'HOST_EMAIL_PROVIDER_NOT_PRODUCTION',
        'Production profile is not using the webhook email provider.',
        'PLOYKIT_EMAIL_PROVIDER',
        'Set PLOYKIT_EMAIL_PROVIDER=webhook and PLOYKIT_EMAIL_WEBHOOK_URL to connect a production email adapter.'
      )
    );
  }

  if (productionProfile(env) && health.providers.ai.mode !== 'webhook') {
    diagnostics.push(
      diagnostic(
        'warning',
        'HOST_AI_PROVIDER_NOT_PRODUCTION',
        'Production profile is using a local/static AI provider.',
        'PLOYKIT_AI_PROVIDER',
        'Set PLOYKIT_AI_PROVIDER=webhook and PLOYKIT_AI_WEBHOOK_URL to connect a production AI adapter.'
      )
    );
  }

  if ((productionProfile(env) || required) && health.providers.ai.mode === 'webhook') {
    if (!health.providers.ai.webhookConfigured) {
      diagnostics.push(
        diagnostic(
          'error',
          'HOST_AI_WEBHOOK_URL_REQUIRED',
          'Webhook AI provider requires a webhook URL.',
          'PLOYKIT_AI_WEBHOOK_URL',
          'Set PLOYKIT_AI_WEBHOOK_URL or use PLOYKIT_AI_PROVIDER=static for local validation.'
        )
      );
    }
    if (!health.providers.ai.webhookSecretConfigured) {
      diagnostics.push(
        diagnostic(
          'warning',
          'HOST_AI_WEBHOOK_SECRET_RECOMMENDED',
          'Webhook AI provider should sign outbound inference requests.',
          'PLOYKIT_AI_WEBHOOK_SECRET',
          'Set PLOYKIT_AI_WEBHOOK_SECRET so receivers can verify PloyKit AI requests.'
        )
      );
    }
  }

  if ((productionProfile(env) || required) && health.providers.email.mode === 'webhook') {
    if (!health.providers.email.webhookConfigured) {
      diagnostics.push(
        diagnostic(
          'error',
          'HOST_EMAIL_WEBHOOK_URL_REQUIRED',
          'Webhook email provider requires a webhook URL.',
          'PLOYKIT_EMAIL_WEBHOOK_URL',
          'Set PLOYKIT_EMAIL_WEBHOOK_URL or use PLOYKIT_EMAIL_PROVIDER=log for local validation.'
        )
      );
    }
    if (!health.providers.email.webhookSecretConfigured) {
      diagnostics.push(
        diagnostic(
          'warning',
          'HOST_EMAIL_WEBHOOK_SECRET_RECOMMENDED',
          'Webhook email provider should sign outbound delivery requests.',
          'PLOYKIT_EMAIL_WEBHOOK_SECRET',
          'Set PLOYKIT_EMAIL_WEBHOOK_SECRET so receivers can verify PloyKit delivery requests.'
        )
      );
    }
  }

  const metrics: HostMetricsSnapshot = {
    routeCatalogEntries: routeSecurity.catalogEntries,
    apiRoutesDiscovered: routeSecurity.actualRoutes,
    mutationRoutes: routeSecurity.mutationCatalogEntries,
    workerQueued: worker.queue.queued,
    workerDeadLettered: worker.queue.deadLettered,
    workerHeartbeatFresh: heartbeatFresh,
    providersReady: providerReadiness.filter((provider) => provider.status === 'ready').length,
    providersTotal: providerReadiness.length,
  };
  const report: HostConfigDoctorReport = {
    ok: diagnostics.every((item) => item.severity !== 'error'),
    required,
    checkedAt: new Date().toISOString(),
    diagnostics,
    health,
    routeSecurity,
    providerReadiness,
    metrics,
    retention: {
      files: 'File records support expiresAt plus deleted/quarantined/archive cleanup paths.',
      auditLogs: env.PLOYKIT_AUDIT_RETENTION_DAYS
        ? `${env.PLOYKIT_AUDIT_RETENTION_DAYS} days`
        : 'retain in runtime store; export/archive policy required before production',
      runLogs: env.PLOYKIT_RUN_LOG_RETENTION_DAYS
        ? `${env.PLOYKIT_RUN_LOG_RETENTION_DAYS} days`
        : 'retain in runtime store; cleanup policy required before production',
      outbox:
        'Processed/dead-letter outbox records are visible in Admin and can be replayed or discarded.',
    },
  };

  return redactSensitive(report);
}

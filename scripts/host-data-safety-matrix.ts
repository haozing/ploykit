import fs from 'node:fs';
import path from 'node:path';
import { getHostRuntimeHealth } from '../apps/host-next/lib/create-host';
import { getHostRouteCatalog } from '../apps/host-next/lib/security';
import { drainHostWorker, getHostWorkerStatus } from '../apps/host-next/lib/worker';
import { runHostConfigDoctor } from '../apps/host-next/lib/config-doctor';
import { getHostRuntimeStore } from '../apps/host-next/lib/runtime-store';
import { redactSensitive } from '../src/lib/module-runtime';
import { runReleaseCandidateGate } from '../src/lib/module-runtime/release/rc-gate';
import { verifyRuntimeStoreSchema } from '../src/lib/module-runtime/stores/runtime-store-migrations';

const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'data-safety',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'data-safety.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'data-safety', 'latest.json');
interface WorkerSoakEvidence {
  ok?: boolean;
  required?: boolean;
  checkedAt?: string;
  enqueued?: number;
  drain?: {
    processed?: number;
    failed?: number;
    deadLettered?: number;
    queueLagMs?: number;
  };
  worker?: {
    workerId?: string;
    heartbeatAt?: string;
    queue?: Awaited<ReturnType<typeof getHostWorkerStatus>>['queue'];
    alerts?: Awaited<ReturnType<typeof getHostWorkerStatus>>['alerts'];
  };
}

function readWorkerSoakEvidence(projectRoot: string): {
  report?: WorkerSoakEvidence;
  path: string;
} {
  const latestPath = path.join(projectRoot, '.runtime', 'worker-soak', 'latest.json');
  if (!fs.existsSync(latestPath)) {
    return { path: latestPath };
  }
  try {
    return {
      path: latestPath,
      report: JSON.parse(fs.readFileSync(latestPath, 'utf8')) as WorkerSoakEvidence,
    };
  } catch {
    return { path: latestPath };
  }
}

function workerSoakPassed(report: WorkerSoakEvidence | undefined, strict: boolean): boolean {
  if (!report || report.ok !== true) {
    return false;
  }
  if (strict && report.required !== true) {
    return false;
  }
  const enqueued = report.enqueued ?? 0;
  const processed = report.drain?.processed ?? 0;
  return (
    processed >= enqueued &&
    (report.drain?.failed ?? 0) === 0 &&
    (report.drain?.deadLettered ?? 0) === 0
  );
}

const health = await getHostRuntimeHealth();
if (required) {
  await drainHostWorker({ limit: 0 });
}
const worker = await getHostWorkerStatus();
const runtimeStore = await getHostRuntimeStore();
const runtimeSchema = runtimeStore.database
  ? await verifyRuntimeStoreSchema(runtimeStore.database)
  : null;
const workerSoak = readWorkerSoakEvidence(process.cwd());
const configDoctor = await runHostConfigDoctor({ required, projectRoot: process.cwd() });
const rc = runReleaseCandidateGate({ projectRoot: process.cwd() });
const heartbeatFresh =
  worker.heartbeatAt !== null && Date.now() - new Date(worker.heartbeatAt).getTime() < 120_000;
const soakPassed = workerSoakPassed(workerSoak.report, required);
const effectiveWorkerQueue = workerSoak.report?.worker?.queue ?? worker.queue;
const effectiveWorkerAlerts = workerSoak.report?.worker?.alerts ?? worker.alerts;
const effectiveBlockingWorkerAlerts = effectiveWorkerAlerts.filter(
  (alert) => alert.severity === 'error'
);
const effectiveHeartbeatFresh = soakPassed || heartbeatFresh;

const checks = [
  {
    id: 'auth-signed-cookie-secret',
    ok: required ? health.auth.secretConfigured : true,
    severity: health.auth.secretConfigured ? 'pass' : 'warning',
    detail: health.auth.secretConfigured
      ? 'Host auth secret is configured.'
      : 'Host uses the development signed-cookie secret.',
  },
  {
    id: 'runtime-store-durability',
    ok: required ? health.store.durable : true,
    severity: health.store.durable ? 'pass' : 'warning',
    detail: health.store.durable
      ? health.store.databaseLabel
      : 'Runtime store is memory/local demo mode.',
  },
  {
    id: 'runtime-store-schema-drift',
    ok: runtimeSchema ? runtimeSchema.ok : !required,
    severity: runtimeSchema?.ok ? 'pass' : required ? 'error' : 'warning',
    detail: runtimeSchema ?? {
      mode: health.store.mode,
      message: 'Runtime store schema drift requires a Postgres-backed runtime store.',
    },
  },
  {
    id: 'route-security-catalog',
    ok:
      health.security.routeCatalog === 'configured' &&
      getHostRouteCatalog().length >= 8 &&
      configDoctor.routeSecurity.ok,
    severity: configDoctor.routeSecurity.ok ? 'pass' : 'error',
    detail: {
      routeSecurityEntries: getHostRouteCatalog().length,
      apiRoutesDiscovered: configDoctor.routeSecurity.actualRoutes,
      missingCatalogRoutes: configDoctor.routeSecurity.missingCatalogRoutes.length,
      mutationRoutesWithoutCsrf: configDoctor.routeSecurity.mutationRoutesWithoutCsrf.length,
      mutationRoutesWithoutOriginGuard:
        configDoctor.routeSecurity.mutationRoutesWithoutOriginGuard.length,
    },
  },
  {
    id: 'file-storage-durability',
    ok: required ? health.files.durable : true,
    severity: health.files.durable ? 'pass' : 'warning',
    detail: health.files.mode,
  },
  {
    id: 'worker-heartbeat-status',
    ok:
      health.worker.heartbeat &&
      effectiveWorkerQueue.deadLettered >= 0 &&
      (!required || (effectiveHeartbeatFresh && effectiveBlockingWorkerAlerts.length === 0)),
    severity: effectiveHeartbeatFresh && effectiveBlockingWorkerAlerts.length === 0 ? 'pass' : 'warning',
    detail: {
      evidence: soakPassed ? 'worker-soak' : 'live-heartbeat',
      workerId: workerSoak.report?.worker?.workerId ?? worker.workerId,
      heartbeatAt: workerSoak.report?.worker?.heartbeatAt ?? worker.heartbeatAt,
      heartbeatFresh: effectiveHeartbeatFresh,
      queue: effectiveWorkerQueue,
      alerts: effectiveWorkerAlerts,
      workerSoak: {
        exists: Boolean(workerSoak.report),
        path: workerSoak.path,
        ok: workerSoak.report?.ok === true,
        required: workerSoak.report?.required === true,
        checkedAt: workerSoak.report?.checkedAt,
        processed: workerSoak.report?.drain?.processed,
        enqueued: workerSoak.report?.enqueued,
      },
    },
  },
  {
    id: 'legacy-runtime-scan',
    ok: rc.diagnostics.every((item) => item.severity !== 'error'),
    severity: rc.diagnostics.length === 0 ? 'pass' : 'warning',
    detail: {
      scannedFiles: rc.scannedFiles,
      diagnostics: rc.diagnostics.length,
    },
  },
  {
    id: 'config-doctor',
    ok: configDoctor.ok,
    severity: configDoctor.ok ? 'pass' : 'error',
    detail: {
      diagnostics: configDoctor.diagnostics.length,
      metrics: configDoctor.metrics,
      retention: configDoctor.retention,
    },
  },
  {
    id: 'provider-readiness',
    ok: required
      ? configDoctor.providerReadiness.every((provider) => provider.status !== 'blocked')
      : true,
    severity: configDoctor.providerReadiness.some((provider) => provider.status === 'blocked')
      ? 'error'
      : configDoctor.providerReadiness.some((provider) => provider.status === 'warning')
        ? 'warning'
        : 'pass',
    detail: configDoctor.providerReadiness,
  },
  {
    id: 'secret-redaction-smoke',
    ok:
      JSON.stringify(
        redactSensitive({
          DATABASE_URL: 'postgres://user:secret-password@localhost:5432/app',
          nested: { apiKey: 'secret-key', secretConfigured: true },
        })
      ).includes('secret-password') === false,
    severity: 'pass',
    detail: 'Nested secrets and database URLs are redacted before JSON output.',
  },
];

const result = {
  ok: checks.every((check) => check.ok),
  required,
  checkedAt,
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;

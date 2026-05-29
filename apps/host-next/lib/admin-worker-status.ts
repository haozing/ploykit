import fs from 'node:fs/promises';
import path from 'node:path';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import {
  getHostWorkerStatus,
  type HostWorkerAlert,
  type HostWorkerStatusSnapshot,
} from './worker';

export type AdminWorkerEvidenceStatus = 'passed' | 'failed' | 'missing';
export type AdminWorkerReadinessStatus = 'ready' | 'warning' | 'blocked';

export interface AdminWorkerSoakSummary {
  exists: boolean;
  status: AdminWorkerEvidenceStatus;
  latestPath: string;
  reportPath?: string;
  checkedAt?: string;
  required: boolean;
  durationMs: number;
  enqueued: number;
  processed: number;
  failed: number;
  deadLettered: number;
  iterations: number;
  queueLagMs: number;
  alerts: HostWorkerAlert[];
}

export interface AdminWorkerStatusView {
  checkedAt: string;
  status: AdminWorkerReadinessStatus;
  workerId: string;
  heartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  heartbeatStatus: AdminWorkerReadinessStatus;
  lastDrainAt: string | null;
  lastDurationMs: number;
  lastResult: HostWorkerStatusSnapshot['lastResult'];
  queue: HostWorkerStatusSnapshot['queue'];
  thresholds: HostWorkerStatusSnapshot['thresholds'];
  alerts: HostWorkerStatusSnapshot['alerts'];
  soak: AdminWorkerSoakSummary;
  actions: string[];
}

interface WorkerSoakReport {
  ok?: unknown;
  required?: unknown;
  checkedAt?: unknown;
  durationMs?: unknown;
  enqueued?: unknown;
  drain?: {
    iterations?: unknown;
    processed?: unknown;
    failed?: unknown;
    deadLettered?: unknown;
    queueLagMs?: unknown;
  };
  worker?: {
    alerts?: HostWorkerAlert[];
  };
  artifacts?: {
    report?: unknown;
  };
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function emptySoakSummary(latestPath: string): AdminWorkerSoakSummary {
  return {
    exists: false,
    status: 'missing',
    latestPath,
    required: false,
    durationMs: 0,
    enqueued: 0,
    processed: 0,
    failed: 0,
    deadLettered: 0,
    iterations: 0,
    queueLagMs: 0,
    alerts: [],
  };
}

async function readWorkerSoak(projectRoot: string): Promise<AdminWorkerSoakSummary> {
  const latestPath = path.join(projectRoot, '.runtime', 'worker-soak', 'latest.json');
  let report: WorkerSoakReport;
  try {
    report = JSON.parse(await fs.readFile(latestPath, 'utf8')) as WorkerSoakReport;
  } catch {
    return emptySoakSummary(latestPath);
  }

  return {
    exists: true,
    status: report.ok === true ? 'passed' : 'failed',
    latestPath,
    reportPath: typeof report.artifacts?.report === 'string' ? report.artifacts.report : undefined,
    checkedAt: typeof report.checkedAt === 'string' ? report.checkedAt : undefined,
    required: report.required === true,
    durationMs: readNumber(report.durationMs),
    enqueued: readNumber(report.enqueued),
    processed: readNumber(report.drain?.processed),
    failed: readNumber(report.drain?.failed),
    deadLettered: readNumber(report.drain?.deadLettered),
    iterations: readNumber(report.drain?.iterations),
    queueLagMs: readNumber(report.drain?.queueLagMs),
    alerts: Array.isArray(report.worker?.alerts) ? report.worker.alerts : [],
  };
}

function heartbeatAgeMs(status: HostWorkerStatusSnapshot, now = Date.now()): number | null {
  return status.heartbeatAt
    ? Math.max(0, now - new Date(status.heartbeatAt).getTime())
    : null;
}

function heartbeatStatus(status: HostWorkerStatusSnapshot): AdminWorkerReadinessStatus {
  if (status.alerts.some((alert) => alert.code === 'worker.heartbeat.stale')) {
    return 'blocked';
  }
  if (status.alerts.some((alert) => alert.code === 'worker.heartbeat.missing')) {
    return 'warning';
  }
  return 'ready';
}

function overallStatus(input: {
  worker: HostWorkerStatusSnapshot;
  soak: AdminWorkerSoakSummary;
}): AdminWorkerReadinessStatus {
  if (
    input.worker.alerts.some((alert) => alert.severity === 'error') ||
    input.soak.status === 'failed'
  ) {
    return 'blocked';
  }
  if (input.worker.alerts.length > 0 || input.soak.status === 'missing') {
    return 'warning';
  }
  return 'ready';
}

function workerActions(input: {
  worker: HostWorkerStatusSnapshot;
  soak: AdminWorkerSoakSummary;
}): string[] {
  const actions: string[] = [];
  if (!input.worker.heartbeatAt) {
    actions.push('Run npm run host:worker-soak or drain the worker once to establish heartbeat.');
  }
  if (input.worker.queue.failed > 0) {
    actions.push('Inspect failed queue records and let retry backoff drain them or discard with audit.');
  }
  if (input.worker.queue.deadLettered > 0) {
    actions.push('Replay or discard dead letters from Admin Webhooks.');
  }
  if (input.worker.queue.lagMs > input.worker.thresholds.queueLagMs) {
    actions.push('Increase worker capacity or drain limit before queued work breaches SLA.');
  }
  if (!input.soak.exists) {
    actions.push('Run npm run host:worker-soak to attach latest worker evidence.');
  } else if (input.soak.status === 'failed') {
    actions.push('Open worker soak report and fix failed drain/dead-letter evidence.');
  }
  return actions.length > 0 ? actions : ['Worker is ready in the current profile.'];
}

export async function getAdminWorkerStatusView(
  options: {
    projectRoot?: string;
    workerStatus?: HostWorkerStatusSnapshot;
  } = {}
): Promise<AdminWorkerStatusView> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const [worker, soak] = await Promise.all([
    options.workerStatus ? Promise.resolve(options.workerStatus) : getHostWorkerStatus(),
    readWorkerSoak(projectRoot),
  ]);
  const view: AdminWorkerStatusView = {
    checkedAt: new Date().toISOString(),
    status: overallStatus({ worker, soak }),
    workerId: worker.workerId,
    heartbeatAt: worker.heartbeatAt,
    heartbeatAgeMs: heartbeatAgeMs(worker),
    heartbeatStatus: heartbeatStatus(worker),
    lastDrainAt: worker.lastDrainAt,
    lastDurationMs: worker.lastDurationMs,
    lastResult: worker.lastResult,
    queue: worker.queue,
    thresholds: worker.thresholds,
    alerts: worker.alerts,
    soak,
    actions: workerActions({ worker, soak }),
  };

  return redactSensitive(view);
}

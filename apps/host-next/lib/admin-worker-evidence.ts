import fs from 'node:fs/promises';
import path from 'node:path';
import type { HostWorkerAlert } from './worker';

export type AdminWorkerEvidenceStatus = 'passed' | 'failed' | 'missing';

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

export async function readAdminWorkerSoakEvidence(
  projectRoot: string
): Promise<AdminWorkerSoakSummary> {
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

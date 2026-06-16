import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import {
  getHostWorkerStatus,
  type HostWorkerStatusSnapshot,
} from './worker';
import {
  readAdminWorkerSoakEvidence,
  type AdminWorkerEvidenceStatus,
  type AdminWorkerSoakSummary,
} from './admin-worker-evidence';
import {
  adminWorkerActions,
  adminWorkerHeartbeatAgeMs,
  adminWorkerHeartbeatStatus,
  adminWorkerOverallStatus,
  type AdminWorkerReadinessStatus,
} from './admin-worker-readiness';

export type { AdminWorkerEvidenceStatus, AdminWorkerSoakSummary } from './admin-worker-evidence';
export type { AdminWorkerReadinessStatus } from './admin-worker-readiness';

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

export async function getAdminWorkerStatusView(
  options: {
    projectRoot?: string;
    workerStatus?: HostWorkerStatusSnapshot;
  } = {}
): Promise<AdminWorkerStatusView> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const [worker, soak] = await Promise.all([
    options.workerStatus ? Promise.resolve(options.workerStatus) : getHostWorkerStatus(),
    readAdminWorkerSoakEvidence(projectRoot),
  ]);
  const view: AdminWorkerStatusView = {
    checkedAt: new Date().toISOString(),
    status: adminWorkerOverallStatus({ worker, soak }),
    workerId: worker.workerId,
    heartbeatAt: worker.heartbeatAt,
    heartbeatAgeMs: adminWorkerHeartbeatAgeMs(worker),
    heartbeatStatus: adminWorkerHeartbeatStatus(worker),
    lastDrainAt: worker.lastDrainAt,
    lastDurationMs: worker.lastDurationMs,
    lastResult: worker.lastResult,
    queue: worker.queue,
    thresholds: worker.thresholds,
    alerts: worker.alerts,
    soak,
    actions: adminWorkerActions({ worker, soak }),
  };

  return redactSensitive(view);
}

import type { HostWorkerStatusSnapshot } from './worker';
import type { AdminWorkerSoakSummary } from './admin-worker-evidence';

export type AdminWorkerReadinessStatus = 'ready' | 'warning' | 'blocked';

export function adminWorkerHeartbeatAgeMs(
  status: HostWorkerStatusSnapshot,
  now = Date.now()
): number | null {
  return status.heartbeatAt
    ? Math.max(0, now - new Date(status.heartbeatAt).getTime())
    : null;
}

export function adminWorkerHeartbeatStatus(
  status: HostWorkerStatusSnapshot
): AdminWorkerReadinessStatus {
  if (status.alerts.some((alert) => alert.code === 'worker.heartbeat.stale')) {
    return 'blocked';
  }
  if (status.alerts.some((alert) => alert.code === 'worker.heartbeat.missing')) {
    return 'warning';
  }
  return 'ready';
}

export function adminWorkerOverallStatus(input: {
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

export function adminWorkerActions(input: {
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

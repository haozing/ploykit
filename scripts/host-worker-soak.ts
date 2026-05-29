import fs from 'node:fs/promises';
import path from 'node:path';
import {
  enqueueHostDemoJob,
  getHostWorkerStatus,
  runHostWorkerLoop,
} from '../apps/host-next/lib/worker';
import { DEFAULT_HOST_PRODUCT_ID } from '../apps/host-next/lib/default-scope';
import { getHostRuntimeStore } from '../apps/host-next/lib/runtime-store';

function readNumberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

const required = process.argv.includes('--required');
const jobs = Math.max(1, Math.floor(readNumberArg('--jobs', 25)));
const limit = Math.max(1, Math.floor(readNumberArg('--limit', jobs)));
const concurrency = Math.max(1, Math.floor(readNumberArg('--concurrency', 2)));
const maxIterations = Math.max(1, Math.floor(readNumberArg('--max-iterations', jobs + 2)));
const intervalMs = Math.max(0, Math.floor(readNumberArg('--interval-ms', 10)));
const retryBackoffMs = readNumberArg('--retry-backoff-ms', 0);
const startedAt = Date.now();
const checkedAt = new Date().toISOString();
const artifactDir = path.join(
  process.cwd(),
  '.runtime',
  'worker-soak',
  checkedAt.replace(/[:.]/g, '-')
);

const enqueued = [];
for (let index = 0; index < jobs; index += 1) {
  enqueued.push(
    await enqueueHostDemoJob(undefined, {
      content: `Worker soak payload ${index + 1}/${jobs}`,
      idempotencyKey: `host-worker-soak:${startedAt}:${index}`,
      priority: jobs - index,
    })
  );
}

const drain = await runHostWorkerLoop({
  limit,
  concurrency,
  maxIterations,
  intervalMs,
  idleIntervalMs: intervalMs,
  retryBackoffMs: retryBackoffMs > 0 ? retryBackoffMs : undefined,
});
const worker = await getHostWorkerStatus();
const runtimeStore = await getHostRuntimeStore();
const deliveries = await runtimeStore.store.listDeliveries({
  productId: DEFAULT_HOST_PRODUCT_ID,
});
const workers = await runtimeStore.store.listWorkers({
  productId: DEFAULT_HOST_PRODUCT_ID,
});
const deliveryLedger = {
  records: deliveries.length,
  delivered: deliveries.filter((record) => record.status === 'delivered').length,
  failed: deliveries.filter((record) => record.status === 'failed').length,
  deadLettered: deliveries.filter((record) => record.status === 'dead_letter').length,
  workerRecords: deliveries.filter((record) => record.kind === 'worker').length,
  workers: deliveries.filter((record) => record.kind !== 'worker').length,
  kinds: [...new Set(deliveries.map((record) => record.kind))].sort(),
};
const latestWorkerHeartbeatAt =
  workers
    .map((record) => record.heartbeatAt)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
const workerRegistry = {
  workers: workers.length,
  activeWorkers: workers.filter((record) => record.status === 'running' || record.status === 'idle')
    .length,
  errorWorkers: workers.filter((record) => record.status === 'error').length,
  latestHeartbeatAt: latestWorkerHeartbeatAt,
  profiles: [...new Set(workers.map((record) => record.profile))].sort(),
  queueProfiles: [...new Set(workers.map((record) => record.queueProfile))].sort(),
};
const blockingAlerts = worker.alerts.filter((alert) => alert.severity === 'error');
const ok =
  drain.processed >= jobs &&
  drain.failed === 0 &&
  drain.deadLettered === 0 &&
  deliveryLedger.records >= jobs + 1 &&
  deliveryLedger.failed === 0 &&
  deliveryLedger.deadLettered === 0 &&
  deliveryLedger.workerRecords >= 1 &&
  workerRegistry.workers >= 1 &&
  workerRegistry.errorWorkers === 0 &&
  (!required || blockingAlerts.length === 0);

const reportPath = path.join(artifactDir, 'soak.json');
const latestPath = path.join(process.cwd(), '.runtime', 'worker-soak', 'latest.json');
const report = {
  ok,
  required,
  checkedAt,
  durationMs: Date.now() - startedAt,
  enqueued: enqueued.length,
  drain: {
    iterations: drain.iterations,
    processed: drain.processed,
    failed: drain.failed,
    deadLettered: drain.deadLettered,
    queueLagMs: drain.queueLagMs,
  },
  worker: {
    workerId: worker.workerId,
    heartbeatAt: worker.heartbeatAt,
    queue: worker.queue,
    alerts: worker.alerts,
  },
  deliveryLedger,
  workerRegistry,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = ok ? 0 : 1;

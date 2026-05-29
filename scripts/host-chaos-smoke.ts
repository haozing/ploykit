import fs from 'node:fs';
import path from 'node:path';
import { createInMemoryRuntimeStore, createRuntimeStoreQueue } from '../src/lib/module-runtime';

const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'chaos',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'chaos.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'chaos', 'latest.json');
const productId = 'chaos-product';
const workspaceId = 'chaos-workspace';
const moduleId = 'chaos-module';

interface ChaosCheck {
  id: string;
  ok: boolean;
  detail: unknown;
}

let currentTime = new Date();
let nextId = 0;
const store = createInMemoryRuntimeStore({
  now: () => currentTime,
  createId: (prefix) => `${prefix}_chaos_${++nextId}`,
});
const queue = createRuntimeStoreQueue({
  store,
  productId,
  workspaceId,
  moduleId,
  defaultMaxAttempts: 2,
});

function advance(ms: number) {
  currentTime = new Date(currentTime.getTime() + ms);
}

function check(id: string, ok: boolean, detail: unknown): ChaosCheck {
  return { id, ok, detail };
}

const checks: ChaosCheck[] = [];

for (let index = 0; index < 5; index += 1) {
  await queue.enqueue({
    name: 'chaos.concurrent',
    payload: { index },
    priority: index,
    idempotencyKey: `chaos.concurrent:${index}`,
  });
}
const processedIndexes: number[] = [];
const concurrentDrain = await queue.drain<{ index: number }>({
  name: 'chaos.concurrent',
  limit: 5,
  concurrency: 3,
  leaseOwner: 'chaos-worker-concurrent',
  handler(message) {
    processedIndexes.push(message.payload.index);
  },
});
checks.push(
  check('queue-concurrency-drain', concurrentDrain.processed === 5 && concurrentDrain.failed === 0, {
    processed: concurrentDrain.processed,
    failed: concurrentDrain.failed,
    deadLettered: concurrentDrain.deadLettered,
    processedIndexes,
  })
);

await queue.enqueue({
  name: 'chaos.backoff',
  payload: { ok: false },
  idempotencyKey: 'chaos.backoff',
  maxAttempts: 2,
});
const backoffFailure = await queue.drain({
  name: 'chaos.backoff',
  limit: 1,
  retryBackoffMs: 60_000,
  handler() {
    throw new Error('temporary chaos failure');
  },
});
const immediateRetry = await queue.drain({
  name: 'chaos.backoff',
  limit: 1,
  handler() {
    throw new Error('should not run before backoff');
  },
});
const retryAt = backoffFailure.records[0]?.scheduledAt;
if (retryAt) {
  currentTime = new Date(new Date(retryAt).getTime() + 1);
} else {
  advance(60_001);
}
const delayedRetry = await queue.drain({
  name: 'chaos.backoff',
  limit: 1,
  handler() {
    return undefined;
  },
});
checks.push(
  check(
    'retry-backoff-delays-reclaim',
    backoffFailure.failed === 1 && immediateRetry.records.length === 0 && delayedRetry.processed === 1,
    {
      failed: backoffFailure.failed,
      scheduledAt: backoffFailure.records[0]?.scheduledAt,
      immediateRecords: immediateRetry.records.length,
      delayedProcessed: delayedRetry.processed,
    }
  )
);

const leased = await store.enqueueOutbox({
  productId,
  workspaceId,
  moduleId,
  name: 'chaos.lease',
  payload: { lease: true },
  idempotencyKey: 'chaos.lease',
});
const firstLease = await store.claimOutbox({
  productId,
  name: 'chaos.lease',
  limit: 1,
  leaseOwner: 'worker-a',
  leaseMs: 1000,
});
advance(1001);
const reclaimedLease = await store.claimOutbox({
  productId,
  name: 'chaos.lease',
  limit: 1,
  leaseOwner: 'worker-b',
  leaseMs: 1000,
});
checks.push(
  check(
    'expired-lease-reclaim',
    firstLease[0]?.id === leased.id &&
      reclaimedLease[0]?.id === leased.id &&
      reclaimedLease[0]?.leaseOwner === 'worker-b' &&
      reclaimedLease[0]?.attempts === 2,
    {
      firstLeaseOwner: firstLease[0]?.leaseOwner,
      reclaimedLeaseOwner: reclaimedLease[0]?.leaseOwner,
      attempts: reclaimedLease[0]?.attempts,
    }
  )
);

const deadLetter = await queue.enqueue({
  name: 'chaos.dead-letter',
  payload: { fail: true },
  idempotencyKey: 'chaos.dead-letter',
  maxAttempts: 1,
});
const deadLetterDrain = await queue.drain({
  name: 'chaos.dead-letter',
  limit: 1,
  handler() {
    throw new Error('dead letter chaos failure');
  },
});
const replayed = await queue.replay(deadLetter.id);
const replayDrain = await queue.drain({
  name: 'chaos.dead-letter',
  limit: 1,
  handler() {
    return undefined;
  },
});
checks.push(
  check(
    'dead-letter-replay-recovers',
    deadLetterDrain.deadLettered === 1 && replayed.status === 'queued' && replayDrain.processed === 1,
    {
      deadLettered: deadLetterDrain.deadLettered,
      replayedStatus: replayed.status,
      replayProcessed: replayDrain.processed,
    }
  )
);

const result = {
  ok: checks.every((item) => item.ok),
  required,
  checkedAt,
  mode: 'runtime-store-queue-chaos-local',
  checks,
  summary: {
    checks: checks.length,
    passed: checks.filter((item) => item.ok).length,
  },
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

import {
  drainHostWorker,
  enqueueHostDemoJob,
  getHostWorkerStatus,
  runHostWorkerLoop,
} from '../apps/host-next/lib/worker';

function readNumberArg(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? Number(process.argv[index + 1]) : NaN;
  return Number.isFinite(value) ? value : fallback;
}

const enqueue = process.argv.includes('--enqueue');
const loop = process.argv.includes('--loop');
const status = process.argv.includes('--status');
const limit = readNumberArg('--limit', 25);
const concurrency = readNumberArg('--concurrency', 1);
const intervalMs = readNumberArg('--interval-ms', 1000);
const idleIntervalMs = readNumberArg('--idle-interval-ms', intervalMs);
const maxIterations = readNumberArg('--max-iterations', Number.POSITIVE_INFINITY);
const leaseMs = readNumberArg('--lease-ms', 60_000);
const retryBackoffMs = readNumberArg('--retry-backoff-ms', NaN);

if (enqueue) {
  const run = await enqueueHostDemoJob();
  process.stdout.write(`enqueued ${run.id}\n`);
}

if (status) {
  process.stdout.write(`${JSON.stringify(await getHostWorkerStatus(), null, 2)}\n`);
} else if (loop) {
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  process.once('SIGTERM', () => abort.abort());
  try {
    const result = await runHostWorkerLoop({
      limit,
      concurrency,
      intervalMs,
      idleIntervalMs,
      maxIterations,
      leaseMs,
      retryBackoffMs: Number.isFinite(retryBackoffMs) ? retryBackoffMs : undefined,
      signal: abort.signal,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.failed === 0 && result.deadLettered === 0 ? 0 : 1;
  } catch (error) {
    if (abort.signal.aborted) {
      process.stdout.write('host worker loop stopped\n');
      process.exitCode = 0;
    } else {
      throw error;
    }
  }
} else {
  const result = await drainHostWorker({
    limit,
    concurrency,
    leaseMs,
    retryBackoffMs: Number.isFinite(retryBackoffMs) ? retryBackoffMs : undefined,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.failed === 0 && result.deadLettered === 0 ? 0 : 1;
}

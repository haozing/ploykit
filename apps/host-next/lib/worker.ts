import os from 'node:os';
import { createInMemoryModuleArtifactRuntime } from '@/lib/module-capabilities/artifacts/artifact-runtime';
import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract';
import { createRuntimeStoreEventBus } from '@/lib/module-capabilities/events/runtime-store-event-bus';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { createRuntimeStoreJobRunner } from '@/lib/module-capabilities/jobs/runtime-store-job-runner';
import { createRuntimeStoreNotificationRuntime } from '@/lib/module-capabilities/notifications/notification-runtime';
import type { RuntimeStoreQueueDrainResult } from '@/lib/module-runtime/queue/runtime-store-queue';
import type {
  RuntimeStoreDeliveryKind,
  RuntimeStoreDeliveryStatus,
  RuntimeStoreOutboxRecord,
} from '@/lib/module-runtime/stores';
import { createRuntimeStoreWebhookRunner } from '@/lib/module-capabilities/webhooks/runtime-store-webhook-gateway';
import type { ModuleAuditRecordInput } from '@ploykit/module-sdk';
import { getHostRuntime } from './create-host';
import {
  createScopedEventsApi,
  createScopedJobsApi,
  createScopedRunsApi,
  createScopedWebhooksApi,
} from './capability-providers';
import { createHostModuleAiApi } from './ai-provider';
import { createHostModuleRagApi } from './rag-provider';
import { createDemoHostSession } from './session';
import { DEFAULT_HOST_PRODUCT_ID, defaultProductId } from './default-scope';
import { getDefaultCatalogModuleOrder } from './default-module-catalog';
import { drainHostEmailOutbox } from './email-provider';

const workerArtifactRuntime = createInMemoryModuleArtifactRuntime();

function defaultDemoJobTarget(
  contracts: readonly ModuleRuntimeContract[]
): { moduleId: string; name: string } | null {
  const contractById = new Map(contracts.map((contract) => [contract.id, contract]));
  const moduleIds = getDefaultCatalogModuleOrder(contracts.map((contract) => contract.id));
  for (const moduleId of moduleIds) {
    const jobs = Object.keys(contractById.get(moduleId)?.jobs ?? {}).sort();
    const name = jobs[0];
    if (name) {
      return { moduleId, name };
    }
  }
  return null;
}

export interface HostWorkerLoopResult {
  workerId: string;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  iterations: number;
  processed: number;
  failed: number;
  deadLettered: number;
  heartbeatAt?: string;
  queueLagMs: number;
  records: RuntimeStoreQueueDrainResult['records'];
}

export interface HostWorkerQueueStatus {
  queued: number;
  processing: number;
  failed: number;
  deadLettered: number;
  oldestPendingAt: string | null;
  lagMs: number;
}

export interface HostWorkerAlert {
  code:
    | 'worker.heartbeat.missing'
    | 'worker.heartbeat.stale'
    | 'worker.queue.lag'
    | 'worker.queue.dead_letters'
    | 'worker.queue.failed_messages';
  severity: 'warning' | 'error';
  message: string;
  metric: string;
  threshold: number;
  value: number;
}

export interface HostWorkerAlertThresholds {
  heartbeatStaleMs: number;
  queueLagMs: number;
  deadLettered: number;
}

export interface HostWorkerStatusSnapshot {
  workerId: string;
  heartbeatAt: string | null;
  lastDrainAt: string | null;
  lastDurationMs: number;
  lastResult: Pick<
    RuntimeStoreQueueDrainResult,
    'processed' | 'failed' | 'deadLettered' | 'durationMs'
  > | null;
  queue: HostWorkerQueueStatus;
  thresholds: HostWorkerAlertThresholds;
  alerts: HostWorkerAlert[];
}

interface HostWorkerRuntimeState {
  heartbeatAt: string | null;
  lastDrainAt: string | null;
  lastDurationMs: number;
  lastResult: HostWorkerStatusSnapshot['lastResult'];
}

const WORKER_PROFILE = process.env.PLOYKIT_WORKER_PROFILE ?? 'default';
const WORKER_QUEUE_PROFILE =
  process.env.PLOYKIT_WORKER_QUEUE_PROFILE ?? 'jobs-events-webhooks-email';

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(new Error('HOST_WORKER_LOOP_ABORTED'));
      },
      { once: true }
    );
  });
}

const workerState: HostWorkerRuntimeState = {
  heartbeatAt: null,
  lastDrainAt: null,
  lastDurationMs: 0,
  lastResult: null,
};
let demoJobSequence = 0;

function toIso(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString();
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getHostWorkerId(): string {
  return process.env.PLOYKIT_WORKER_ID ?? `${os.hostname()}:${process.pid}`;
}

export function getHostWorkerAlertThresholds(): HostWorkerAlertThresholds {
  return {
    heartbeatStaleMs: readPositiveNumberEnv('PLOYKIT_WORKER_HEARTBEAT_STALE_MS', 120_000),
    queueLagMs: readPositiveNumberEnv('PLOYKIT_WORKER_LAG_ALERT_MS', 300_000),
    deadLettered: readPositiveNumberEnv('PLOYKIT_WORKER_DEAD_LETTER_ALERT_THRESHOLD', 0),
  };
}

export function evaluateHostWorkerAlerts(input: {
  heartbeatAt: string | null;
  queue: HostWorkerQueueStatus;
  thresholds?: HostWorkerAlertThresholds;
  now?: number;
}): HostWorkerAlert[] {
  const thresholds = input.thresholds ?? getHostWorkerAlertThresholds();
  const now = input.now ?? Date.now();
  const alerts: HostWorkerAlert[] = [];
  const heartbeatAgeMs = input.heartbeatAt
    ? Math.max(0, now - new Date(input.heartbeatAt).getTime())
    : thresholds.heartbeatStaleMs + 1;

  if (!input.heartbeatAt) {
    alerts.push({
      code: 'worker.heartbeat.missing',
      severity: 'warning',
      message: 'Worker heartbeat has not been observed in this host process.',
      metric: 'heartbeatAgeMs',
      threshold: thresholds.heartbeatStaleMs,
      value: heartbeatAgeMs,
    });
  } else if (heartbeatAgeMs > thresholds.heartbeatStaleMs) {
    alerts.push({
      code: 'worker.heartbeat.stale',
      severity: 'error',
      message: 'Worker heartbeat is stale.',
      metric: 'heartbeatAgeMs',
      threshold: thresholds.heartbeatStaleMs,
      value: heartbeatAgeMs,
    });
  }

  if (input.queue.lagMs > thresholds.queueLagMs) {
    alerts.push({
      code: 'worker.queue.lag',
      severity: 'warning',
      message: 'Worker queue lag is above the configured threshold.',
      metric: 'queueLagMs',
      threshold: thresholds.queueLagMs,
      value: input.queue.lagMs,
    });
  }

  if (input.queue.deadLettered > thresholds.deadLettered) {
    alerts.push({
      code: 'worker.queue.dead_letters',
      severity: 'error',
      message: 'Worker queue has dead-lettered records.',
      metric: 'deadLettered',
      threshold: thresholds.deadLettered,
      value: input.queue.deadLettered,
    });
  }

  if (input.queue.failed > 0) {
    alerts.push({
      code: 'worker.queue.failed_messages',
      severity: 'warning',
      message: 'Worker queue has failed records waiting for retry.',
      metric: 'failed',
      threshold: 0,
      value: input.queue.failed,
    });
  }

  return alerts;
}

function updateWorkerHeartbeat(result?: RuntimeStoreQueueDrainResult): string {
  const heartbeatAt = toIso();
  workerState.heartbeatAt = heartbeatAt;
  if (result) {
    workerState.lastDrainAt = heartbeatAt;
    workerState.lastDurationMs = result.durationMs;
    workerState.lastResult = {
      processed: result.processed,
      failed: result.failed,
      deadLettered: result.deadLettered,
      durationMs: result.durationMs,
    };
  }
  return heartbeatAt;
}

function deliveryKindForOutbox(record: RuntimeStoreOutboxRecord): RuntimeStoreDeliveryKind {
  if (record.name.startsWith('job:')) {
    return 'job';
  }
  if (record.name.startsWith('event:')) {
    return 'event';
  }
  if (record.name.startsWith('webhook:')) {
    return 'webhook';
  }
  if (record.name.startsWith('email:')) {
    return 'email';
  }
  return 'worker';
}

function deliveryStatusForOutbox(record: RuntimeStoreOutboxRecord): RuntimeStoreDeliveryStatus {
  if (record.status === 'processed') {
    return 'delivered';
  }
  if (record.status === 'failed') {
    return 'failed';
  }
  if (record.status === 'dead_letter') {
    return 'dead_letter';
  }
  if (record.status === 'archived') {
    return 'archived';
  }
  return record.status;
}

function deliveryStatusForDrain(
  result: RuntimeStoreQueueDrainResult
): RuntimeStoreDeliveryStatus {
  if (result.deadLettered > 0) {
    return 'dead_letter';
  }
  if (result.failed > 0) {
    return 'failed';
  }
  if (result.processed > 0) {
    return 'delivered';
  }
  return 'skipped';
}

function stringMetadata(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function runIdForOutbox(record: RuntimeStoreOutboxRecord): string | null {
  const payload = record.payload as { runId?: unknown } | undefined;
  return stringMetadata(payload?.runId);
}

function receiptIdForOutbox(record: RuntimeStoreOutboxRecord): string | null {
  const payload = record.payload as { receiptId?: unknown } | undefined;
  return stringMetadata(payload?.receiptId);
}

async function recordWorkerDeliveryLedger(input: {
  session?: ModuleHostSession;
  workerId: string;
  result: RuntimeStoreQueueDrainResult;
}) {
  const hostRuntime = await getHostRuntime();
  const session = input.session ?? createDemoHostSession();
  const productId = defaultProductId(session.productId);
  const workspaceId = session.workspaceId ?? null;
  const actorId = session.actorId ?? session.userId ?? session.user?.id ?? null;
  const store = hostRuntime.runtimeStore.store;

  await store.upsertWorkerHeartbeat({
    productId,
    workspaceId,
    actorId,
    workerId: input.workerId,
    profile: WORKER_PROFILE,
    queueProfile: WORKER_QUEUE_PROFILE,
    status:
      input.result.failed > 0 || input.result.deadLettered > 0
        ? 'error'
        : input.result.records.length > 0
          ? 'running'
          : 'idle',
    heartbeatAt: workerState.heartbeatAt ?? toIso(),
    lastDrainAt: workerState.lastDrainAt,
    lastDurationMs: input.result.durationMs,
    processed: input.result.processed,
    failed: input.result.failed,
    deadLettered: input.result.deadLettered,
    metadata: {
      recordCount: input.result.records.length,
      processId: process.pid,
      host: os.hostname(),
    },
  });

  await Promise.all(
    input.result.records.map((record) =>
      store.recordDelivery({
        productId,
        workspaceId,
        moduleId: record.moduleId ?? null,
        actorId,
        kind: deliveryKindForOutbox(record),
        source: record.name,
        target: record.moduleId ?? 'host',
        status: deliveryStatusForOutbox(record),
        attempts: record.attempts,
        outboxId: record.id,
        runId: runIdForOutbox(record),
        receiptId: receiptIdForOutbox(record),
        workerId: input.workerId,
        correlationId: stringMetadata(record.metadata.correlationId),
        causationId: stringMetadata(record.metadata.causationId),
        nextRetryAt: record.status === 'failed' ? (record.scheduledAt ?? null) : null,
        errorCategory: record.error?.code ?? null,
        error: record.error,
        metadata: {
          outboxStatus: record.status,
          idempotencyKey: record.idempotencyKey,
          priority: record.priority ?? 0,
          processedAt: record.processedAt,
        },
      })
    )
  );

  await store.recordDelivery({
    productId,
    workspaceId,
    actorId,
    kind: 'worker',
    source: `worker:${input.workerId}`,
    target: 'runtime-store-queue',
    status: deliveryStatusForDrain(input.result),
    attempts: 1,
    workerId: input.workerId,
    metadata: {
      processed: input.result.processed,
      failed: input.result.failed,
      deadLettered: input.result.deadLettered,
      durationMs: input.result.durationMs,
      recordIds: input.result.records.map((record) => record.id),
    },
  });
}

async function readWorkerQueueStatus(): Promise<HostWorkerQueueStatus> {
  const hostRuntime = await getHostRuntime();
  const records = await hostRuntime.runtimeStore.store.listOutbox({
    productId: DEFAULT_HOST_PRODUCT_ID,
  });
  const pending = records.filter(
    (record) => record.status === 'queued' || record.status === 'failed'
  );
  const oldestPendingAt =
    pending
      .map((record) => record.scheduledAt ?? record.createdAt)
      .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0] ?? null;
  const lagMs = oldestPendingAt ? Math.max(0, Date.now() - new Date(oldestPendingAt).getTime()) : 0;

  return {
    queued: records.filter((record) => record.status === 'queued').length,
    processing: records.filter((record) => record.status === 'processing').length,
    failed: records.filter((record) => record.status === 'failed').length,
    deadLettered: records.filter((record) => record.status === 'dead_letter').length,
    oldestPendingAt,
    lagMs,
  };
}

async function createHostWorkerRunner(session: ModuleHostSession = createDemoHostSession()) {
  const hostRuntime = await getHostRuntime();
  const commercial = hostRuntime.createCommercialRuntime(session);
  const files = hostRuntime.createFileRuntime(session);
  const notifications = createRuntimeStoreNotificationRuntime({
    store: hostRuntime.runtimeStore.store,
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
  });
  async function recordWorkerAudit(
    moduleId: string | undefined,
    type: string,
    metadata?: Record<string, unknown>
  ) {
    await hostRuntime.runtimeStore.store.recordAudit({
      productId: defaultProductId(session.productId),
      workspaceId: session.workspaceId ?? null,
      moduleId,
      actorId: session.actorId ?? session.userId ?? session.user?.id,
      type,
      metadata,
    });
  }

  function aiForModule(moduleId: string) {
    return createHostModuleAiApi({
      moduleId,
      session,
      commercialForModule(targetModuleId) {
        return commercial.forModule(targetModuleId);
      },
      audit(record) {
        return recordWorkerAudit(record.moduleId, record.type, record.metadata);
      },
    });
  }

  function ragForModule(moduleId: string) {
    return createHostModuleRagApi({
      moduleId,
      session,
      ai: aiForModule(moduleId),
      store: hostRuntime.runtimeStore.store,
      durable: hostRuntime.runtimeStore.durable,
      audit(record) {
        return recordWorkerAudit(record.moduleId, record.type, record.metadata);
      },
    });
  }

  const backgroundCapabilities = {
    ai: aiForModule,
    files: (moduleId: string) => files.forModule(moduleId),
    artifacts: (moduleId: string) => workerArtifactRuntime.forModule(moduleId),
    notifications: (moduleId: string) => notifications.forModule(moduleId),
    rag: ragForModule,
    jobs: (moduleId: string) => {
      const contract = hostRuntime.moduleHost.runtime.getContract(moduleId);
      if (!contract) {
        throw new Error(`MODULE_CONTRACT_NOT_FOUND: ${moduleId}`);
      }
      return createScopedJobsApi({
        contract,
        store: hostRuntime.runtimeStore.store,
        session,
      });
    },
    runs: (moduleId: string) => {
      const contract = hostRuntime.moduleHost.runtime.getContract(moduleId);
      if (!contract) {
        throw new Error(`MODULE_CONTRACT_NOT_FOUND: ${moduleId}`);
      }
      return createScopedRunsApi({
        contract,
        store: hostRuntime.runtimeStore.store,
        session,
      });
    },
    events: (moduleId: string) => {
      const contract = hostRuntime.moduleHost.runtime.getContract(moduleId);
      if (!contract) {
        throw new Error(`MODULE_CONTRACT_NOT_FOUND: ${moduleId}`);
      }
      return createScopedEventsApi({
        contract,
        store: hostRuntime.runtimeStore.store,
        session,
      });
    },
    webhooks: (moduleId: string) => {
      const contract = hostRuntime.moduleHost.runtime.getContract(moduleId);
      if (!contract) {
        throw new Error(`MODULE_CONTRACT_NOT_FOUND: ${moduleId}`);
      }
      return createScopedWebhooksApi({
        contract,
        store: hostRuntime.runtimeStore.store,
        session,
      });
    },
    usage: (moduleId: string) => commercial.forModule(moduleId).usage,
    metering: (moduleId: string) => commercial.forModule(moduleId).metering,
    credits: (moduleId: string) => commercial.forModule(moduleId).credits,
    billing: (moduleId: string) => commercial.forModule(moduleId).billing,
    entitlements: (moduleId: string) => commercial.forModule(moduleId).entitlements,
    commerce: (moduleId: string) => commercial.forModule(moduleId).commerce,
    redeemCodes: (moduleId: string) => commercial.forModule(moduleId).redeemCodes,
    risk: (moduleId: string) => commercial.forModule(moduleId).risk,
    audit: {
      async record(type: string | ModuleAuditRecordInput, metadata?: Record<string, unknown>) {
        if (typeof type === 'string') {
          await recordWorkerAudit(undefined, type, metadata);
          return;
        }
        await recordWorkerAudit(undefined, type.action, {
          ...(type.metadata ?? {}),
          actorKind: type.actorKind,
          actorId: type.actorId,
          action: type.action,
          category: type.category,
          targetKind: type.targetKind,
          targetId: type.targetId,
          decision: type.decision,
          reasonCode: type.reasonCode,
          requestId: type.requestId,
          traceId: type.traceId,
          beforeHash: type.beforeHash,
          afterHash: type.afterHash,
          sync: type.sync,
        });
      },
    },
  };

  const common = {
    store: hostRuntime.runtimeStore.store,
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    session,
    capabilities: backgroundCapabilities,
  };

  return {
    jobs: createRuntimeStoreJobRunner(hostRuntime.moduleHost.runtime, common),
    events: createRuntimeStoreEventBus(hostRuntime.moduleHost.runtime, common),
    webhooks: createRuntimeStoreWebhookRunner(hostRuntime.moduleHost.runtime, common),
  };
}

export async function enqueueHostDemoJob(
  session: ModuleHostSession = createDemoHostSession(),
  options: {
    moduleId?: string;
    name?: string;
    input?: Record<string, unknown>;
    content?: string;
    idempotencyKey?: string;
    scheduledAt?: string;
    priority?: number;
  } = {}
) {
  const hostRuntime = await getHostRuntime();
  const runner = await createHostWorkerRunner(session);
  const sequence = ++demoJobSequence;
  const defaultTarget = defaultDemoJobTarget(hostRuntime.moduleHost.runtime.contracts);
  const moduleId = options.moduleId ?? defaultTarget?.moduleId;
  const name = options.name ?? defaultTarget?.name;
  if (!moduleId || !name) {
    throw new Error('HOST_DEMO_JOB_TARGET_MISSING');
  }
  const defaultInput = options.content ? { content: options.content } : {};
  return runner.jobs.enqueueJob({
    moduleId,
    name,
    input: options.input ?? defaultInput,
    idempotencyKey:
      options.idempotencyKey ?? `host-demo-job:${moduleId}:${name}:${Date.now()}:${sequence}`,
    scheduledAt: options.scheduledAt,
    priority: options.priority,
  });
}

export async function listHostWorkerArtifactsForRun(input: {
  moduleId: string;
  runId: string;
}) {
  return workerArtifactRuntime.forModule(input.moduleId).list({ runId: input.runId });
}

export async function drainHostWorker(
  input: {
    session?: ModuleHostSession;
    limit?: number;
    concurrency?: number;
    leaseMs?: number;
    retryBackoffMs?: number;
    workerId?: string;
  } = {}
): Promise<RuntimeStoreQueueDrainResult> {
  const workerId = input.workerId ?? getHostWorkerId();
  updateWorkerHeartbeat();
  const runner = await createHostWorkerRunner(input.session);
  const jobResult = await runner.jobs.drain({
    limit: input.limit ?? 25,
    concurrency: input.concurrency,
    leaseOwner: workerId,
    leaseMs: input.leaseMs ?? 60_000,
    retryBackoffMs: input.retryBackoffMs,
  });
  const eventResult = await runner.events.drain({
    limit: input.limit ?? 25,
    concurrency: input.concurrency,
    leaseOwner: workerId,
    leaseMs: input.leaseMs ?? 60_000,
    retryBackoffMs: input.retryBackoffMs,
  });
  const webhookResult = await runner.webhooks.drain({
    limit: input.limit ?? 25,
    concurrency: input.concurrency,
    leaseOwner: workerId,
    leaseMs: input.leaseMs ?? 60_000,
    retryBackoffMs: input.retryBackoffMs,
  });
  const session = input.session ?? createDemoHostSession();
  const emailResult = await drainHostEmailOutbox({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    limit: input.limit ?? 25,
    concurrency: input.concurrency,
    leaseOwner: workerId,
    leaseMs: input.leaseMs ?? 60_000,
    retryBackoffMs: input.retryBackoffMs,
  });
  const result: RuntimeStoreQueueDrainResult = {
    processed:
      jobResult.processed + eventResult.processed + webhookResult.processed + emailResult.processed,
    failed: jobResult.failed + eventResult.failed + webhookResult.failed + emailResult.failed,
    deadLettered:
      jobResult.deadLettered +
      eventResult.deadLettered +
      webhookResult.deadLettered +
      emailResult.deadLettered,
    durationMs:
      jobResult.durationMs + eventResult.durationMs + webhookResult.durationMs + emailResult.durationMs,
    records: [...jobResult.records, ...eventResult.records, ...webhookResult.records, ...emailResult.records],
  };
  updateWorkerHeartbeat(result);
  await recordWorkerDeliveryLedger({
    session: input.session,
    workerId,
    result,
  });
  return result;
}

export async function runHostWorkerLoop(
  input: {
    session?: ModuleHostSession;
    limit?: number;
    concurrency?: number;
    intervalMs?: number;
    idleIntervalMs?: number;
    maxIterations?: number;
    leaseMs?: number;
    retryBackoffMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<HostWorkerLoopResult> {
  const workerId = getHostWorkerId();
  const startedAtMs = Date.now();
  const result: HostWorkerLoopResult = {
    workerId,
    startedAt: toIso(startedAtMs),
    durationMs: 0,
    iterations: 0,
    processed: 0,
    failed: 0,
    deadLettered: 0,
    queueLagMs: 0,
    records: [],
  };
  const maxIterations = input.maxIterations ?? Number.POSITIVE_INFINITY;
  const intervalMs = input.intervalMs ?? 1000;
  const idleIntervalMs = input.idleIntervalMs ?? intervalMs;

  while (!input.signal?.aborted && result.iterations < maxIterations) {
    const drained = await drainHostWorker({
      session: input.session,
      limit: input.limit,
      concurrency: input.concurrency,
      leaseMs: input.leaseMs,
      retryBackoffMs: input.retryBackoffMs,
      workerId,
    });
    const queue = await readWorkerQueueStatus();
    result.iterations += 1;
    result.processed += drained.processed;
    result.failed += drained.failed;
    result.deadLettered += drained.deadLettered;
    result.heartbeatAt = workerState.heartbeatAt ?? undefined;
    result.queueLagMs = queue.lagMs;
    result.records.push(...drained.records);

    if (result.iterations >= maxIterations || input.signal?.aborted) {
      break;
    }
    await sleep(drained.records.length > 0 ? intervalMs : idleIntervalMs, input.signal);
  }

  result.completedAt = toIso();
  result.durationMs = Date.now() - startedAtMs;
  return result;
}

export async function getHostWorkerStatus(): Promise<HostWorkerStatusSnapshot> {
  const queue = await readWorkerQueueStatus();
  const thresholds = getHostWorkerAlertThresholds();
  const hostRuntime = await getHostRuntime();
  const workerId = getHostWorkerId();
  const exactWorkers = await hostRuntime.runtimeStore.store.listWorkers({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workerId,
  });
  const fallbackWorkers =
    exactWorkers.length > 0
      ? exactWorkers
      : await hostRuntime.runtimeStore.store.listWorkers({
          productId: DEFAULT_HOST_PRODUCT_ID,
        });
  const persistentWorker = [...fallbackWorkers].sort(
    (left, right) =>
      new Date(right.heartbeatAt).getTime() - new Date(left.heartbeatAt).getTime()
  )[0];
  const heartbeatAt = workerState.heartbeatAt ?? persistentWorker?.heartbeatAt ?? null;
  const lastDrainAt = workerState.lastDrainAt ?? persistentWorker?.lastDrainAt ?? null;
  const lastDurationMs = workerState.lastDurationMs || persistentWorker?.lastDurationMs || 0;
  const lastResult =
    workerState.lastResult ??
    (persistentWorker
      ? {
          processed: persistentWorker.processed,
          failed: persistentWorker.failed,
          deadLettered: persistentWorker.deadLettered,
          durationMs: persistentWorker.lastDurationMs,
        }
      : null);
  return {
    workerId,
    heartbeatAt,
    lastDrainAt,
    lastDurationMs,
    lastResult,
    queue,
    thresholds,
    alerts: evaluateHostWorkerAlerts({
      heartbeatAt,
      queue,
      thresholds,
    }),
  };
}

import type { ModuleRunLogEntry, ModuleRunRecord, ModuleRunStatus } from '../runs';
import { redactSensitive } from '../observability/redaction';
import type {
  CreateRuntimeStoreRunInput,
  CreateRuntimeStoreWebhookReceiptInput,
  EnqueueRuntimeStoreOutboxInput,
  RuntimeStore,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreOutboxStatus,
  RuntimeStoreWebhookReceipt,
  RuntimeStoreWebhookReceiptStatus,
  RuntimeStoreWorkerRecord,
} from './runtime-store-types';

type InMemoryExecutionRuntimeStore = Pick<
  RuntimeStore,
  | 'createRun'
  | 'getRun'
  | 'listRuns'
  | 'updateRunStatus'
  | 'appendRunLog'
  | 'enqueueOutbox'
  | 'listOutbox'
  | 'claimOutbox'
  | 'markOutbox'
  | 'recordDelivery'
  | 'listDeliveries'
  | 'upsertWorkerHeartbeat'
  | 'listWorkers'
  | 'createWebhookReceipt'
  | 'findWebhookReceiptByIdempotencyKey'
  | 'markWebhookReceipt'
  | 'listWebhookReceipts'
>;

interface CreateInMemoryExecutionRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeError(error: Error | string): { code: string; message: string } {
  return typeof error === 'string'
    ? { code: 'RUNTIME_STORE_ERROR', message: error }
    : { code: error.name || 'RUNTIME_STORE_ERROR', message: error.message };
}

function normalizeDeliveryError(
  error?: Error | string | { code: string; message: string }
): { code: string; message: string } | undefined {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'object' && 'code' in error && 'message' in error) {
    return error;
  }
  return normalizeError(error);
}

export function createInMemoryExecutionRuntimeStore({
  now,
  createId,
}: CreateInMemoryExecutionRuntimeStoreInput): InMemoryExecutionRuntimeStore {
  const runs = new Map<string, ModuleRunRecord>();
  const runIdempotency = new Map<string, string>();
  const outbox = new Map<string, RuntimeStoreOutboxRecord>();
  const outboxIdempotency = new Map<string, string>();
  const deliveries = new Map<string, RuntimeStoreDeliveryRecord>();
  const workers = new Map<string, RuntimeStoreWorkerRecord>();
  const receipts = new Map<string, RuntimeStoreWebhookReceipt>();
  const receiptIdempotency = new Map<string, string>();

  function readRun(id: string): ModuleRunRecord {
    const run = runs.get(id);
    if (!run) {
      throw new Error(`RUNTIME_STORE_RUN_NOT_FOUND: ${id}`);
    }
    return run;
  }

  return {
    async createRun<TInput = unknown>(input: CreateRuntimeStoreRunInput<TInput>) {
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = runIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(readRun(existingId) as ModuleRunRecord<TInput>);
        }
      }
      if (input.id && runs.has(input.id)) {
        const existing = readRun(input.id);
        if (input.idempotencyKey && existing.idempotencyKey === input.idempotencyKey) {
          return clone(existing as ModuleRunRecord<TInput>);
        }
        throw new Error(`RUNTIME_STORE_RUN_ID_CONFLICT: ${input.id}`);
      }

      const timestamp = iso(now);
      const run: ModuleRunRecord<TInput> = {
        id: input.id ?? createId('run'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId,
        kind: input.kind,
        name: input.name,
        status: 'queued',
        progress: 0,
        attempt: 0,
        maxAttempts: input.maxAttempts ?? 1,
        input: input.input,
        costRef: input.costRef,
        idempotencyKey: input.idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
        logs: [],
      };
      runs.set(run.id, run);
      if (idempotencyKey) {
        runIdempotency.set(idempotencyKey, run.id);
      }
      return clone(run);
    },
    async getRun(id) {
      const run = runs.get(id);
      return run ? clone(run) : null;
    },
    async listRuns(query = {}) {
      return [...runs.values()]
        .filter((run) => !query.productId || run.productId === query.productId)
        .filter(
          (run) =>
            query.workspaceId === undefined || (run.workspaceId ?? null) === query.workspaceId
        )
        .filter((run) => !query.moduleId || run.moduleId === query.moduleId)
        .filter((run) => !query.status || run.status === query.status)
        .filter((run) => !query.kind || run.kind === query.kind)
        .filter((run) => !query.idempotencyKey || run.idempotencyKey === query.idempotencyKey)
        .map((run) => clone(run));
    },
    async updateRunStatus(id: string, status: ModuleRunStatus, patch = {}) {
      const previous = readRun(id);
      const timestamp = iso(now);
      const next: ModuleRunRecord = {
        ...previous,
        status,
        progress: patch.progress ?? previous.progress,
        result: patch.result,
        error: patch.error,
        updatedAt: timestamp,
        startedAt: status === 'running' ? (previous.startedAt ?? timestamp) : previous.startedAt,
        completedAt: ['succeeded', 'failed', 'canceled'].includes(status)
          ? timestamp
          : previous.completedAt,
        cancelRequestedAt:
          status === 'cancel_requested'
            ? (previous.cancelRequestedAt ?? timestamp)
            : previous.cancelRequestedAt,
        canceledAt:
          status === 'canceled' ? (previous.canceledAt ?? timestamp) : previous.canceledAt,
      };
      runs.set(id, next);
      return clone(next);
    },
    async appendRunLog(id, level: ModuleRunLogEntry['level'], message, metadata) {
      const run = readRun(id);
      const next = {
        ...run,
        logs: [...run.logs, { at: iso(now), level, message, metadata: redactSensitive(metadata) }],
        updatedAt: iso(now),
      };
      runs.set(id, next);
      return clone(next);
    },
    async enqueueOutbox<TPayload = unknown>(input: EnqueueRuntimeStoreOutboxInput<TPayload>) {
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.name}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = outboxIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(outbox.get(existingId) as RuntimeStoreOutboxRecord<TPayload>);
        }
      }

      const timestamp = iso(now);
      const record: RuntimeStoreOutboxRecord<TPayload> = {
        id: createId('outbox'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        name: input.name,
        payload: input.payload,
        metadata: input.metadata ?? {},
        status: 'queued',
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        scheduledAt: input.scheduledAt,
        priority: input.priority ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      outbox.set(record.id, record);
      if (idempotencyKey) {
        outboxIdempotency.set(idempotencyKey, record.id);
      }
      return clone(record);
    },
    async listOutbox(query = {}) {
      return [...outbox.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.name || record.name === query.name)
        .filter((record) => !query.namePrefix || record.name.startsWith(query.namePrefix))
        .map((record) => clone(record));
    },
    async claimOutbox(query = {}) {
      const statuses = query.statuses ?? ['queued', 'failed'];
      const timestamp = now().getTime();
      const leaseExpiresAt = iso(() => new Date(timestamp + (query.leaseMs ?? 60_000)));
      return [...outbox.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.name || record.name === query.name)
        .filter((record) => !query.namePrefix || record.name.startsWith(query.namePrefix))
        .filter((record) => {
          const scheduledDue =
            !record.scheduledAt || new Date(record.scheduledAt).getTime() <= timestamp;
          const expiredLease =
            record.status === 'processing' &&
            record.leaseExpiresAt !== undefined &&
            record.leaseExpiresAt !== null &&
            new Date(record.leaseExpiresAt).getTime() <= timestamp;
          return (statuses.includes(record.status) && scheduledDue) || expiredLease;
        })
        .sort((left, right) => {
          const priorityDiff = (right.priority ?? 0) - (left.priority ?? 0);
          if (priorityDiff !== 0) {
            return priorityDiff;
          }
          return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
        })
        .slice(0, query.limit ?? 50)
        .map((record) => {
          const next: RuntimeStoreOutboxRecord = {
            ...record,
            status: 'processing',
            attempts: record.attempts + 1,
            leaseOwner: query.leaseOwner ?? 'runtime-store-worker',
            leaseExpiresAt,
            heartbeatAt: iso(now),
            updatedAt: iso(now),
          };
          outbox.set(record.id, next);
          return clone(next);
        });
    },
    async markOutbox(
      id: string,
      status: RuntimeStoreOutboxStatus,
      error?: Error | string,
      options = {}
    ) {
      const previous = outbox.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_OUTBOX_NOT_FOUND: ${id}`);
      }
      const timestamp = iso(now);
      const next = {
        ...previous,
        status,
        attempts: status === 'processing' ? previous.attempts + 1 : previous.attempts,
        processedAt: status === 'processed' ? timestamp : previous.processedAt,
        scheduledAt: options.scheduledAt ?? undefined,
        leaseOwner: status === 'processing' ? previous.leaseOwner : null,
        leaseExpiresAt: status === 'processing' ? previous.leaseExpiresAt : null,
        heartbeatAt: status === 'processing' ? (options.heartbeatAt ?? timestamp) : null,
        updatedAt: timestamp,
        error: error ? normalizeError(error) : undefined,
      };
      outbox.set(id, next);
      return clone(next);
    },
    async recordDelivery(input) {
      const timestamp = iso(now);
      const record: RuntimeStoreDeliveryRecord = {
        id: createId('delivery'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        moduleId: input.moduleId ?? null,
        actorId: input.actorId ?? null,
        kind: input.kind,
        source: input.source,
        target: input.target,
        status: input.status,
        attempts: input.attempts ?? 0,
        outboxId: input.outboxId ?? null,
        runId: input.runId ?? null,
        receiptId: input.receiptId ?? null,
        eventId: input.eventId ?? null,
        emailId: input.emailId ?? null,
        workerId: input.workerId ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        nextRetryAt: input.nextRetryAt ?? null,
        errorCategory: input.errorCategory ?? null,
        error: normalizeDeliveryError(input.error),
        metadata: redactSensitive(input.metadata ?? {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      deliveries.set(record.id, record);
      return clone(record);
    },
    async listDeliveries(query = {}) {
      return [...deliveries.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter(
          (record) => query.moduleId === undefined || (record.moduleId ?? null) === query.moduleId
        )
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.outboxId || record.outboxId === query.outboxId)
        .filter((record) => !query.runId || record.runId === query.runId)
        .filter((record) => !query.receiptId || record.receiptId === query.receiptId)
        .filter((record) => !query.eventId || record.eventId === query.eventId)
        .filter((record) => !query.emailId || record.emailId === query.emailId)
        .filter((record) => !query.workerId || record.workerId === query.workerId)
        .filter((record) => !query.correlationId || record.correlationId === query.correlationId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((record) => clone(record));
    },
    async upsertWorkerHeartbeat(input) {
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.workerId}`;
      const existing = workers.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreWorkerRecord = {
        id: existing?.id ?? createId('worker'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        workerId: input.workerId,
        profile: input.profile ?? existing?.profile ?? 'default',
        status: input.status ?? existing?.status ?? 'running',
        queueProfile: input.queueProfile ?? existing?.queueProfile ?? 'default',
        heartbeatAt: input.heartbeatAt ?? timestamp,
        lastDrainAt: input.lastDrainAt ?? existing?.lastDrainAt ?? null,
        lastDurationMs: input.lastDurationMs ?? existing?.lastDurationMs ?? 0,
        processed: input.processed ?? existing?.processed ?? 0,
        failed: input.failed ?? existing?.failed ?? 0,
        deadLettered: input.deadLettered ?? existing?.deadLettered ?? 0,
        metadata: redactSensitive({ ...(existing?.metadata ?? {}), ...(input.metadata ?? {}) }),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      workers.set(key, record);
      return clone(record);
    },
    async listWorkers(query = {}) {
      return [...workers.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.workspaceId === undefined || (record.workspaceId ?? null) === query.workspaceId
        )
        .filter((record) => !query.workerId || record.workerId === query.workerId)
        .filter((record) => !query.status || record.status === query.status)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((record) => clone(record));
    },
    async createWebhookReceipt(input: CreateRuntimeStoreWebhookReceiptInput) {
      const idempotencyKey = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.moduleId}:${input.webhookName}:${input.idempotencyKey}`
        : null;
      if (idempotencyKey) {
        const existingId = receiptIdempotency.get(idempotencyKey);
        if (existingId) {
          return clone(receipts.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const receipt: RuntimeStoreWebhookReceipt = {
        id: createId('wh'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        webhookName: input.webhookName,
        path: input.path,
        method: input.method,
        status: 'received',
        attempts: 0,
        idempotencyKey: input.idempotencyKey,
        signature: input.signature,
        headers: redactSensitive(input.headers ?? {}),
        bodyText: input.bodyText,
        bodyDigest: input.bodyDigest,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      receipts.set(receipt.id, receipt);
      if (idempotencyKey) {
        receiptIdempotency.set(idempotencyKey, receipt.id);
      }
      return clone(receipt);
    },
    async findWebhookReceiptByIdempotencyKey(
      productId,
      workspaceId,
      moduleId,
      webhookName,
      idempotencyKey
    ) {
      const id = receiptIdempotency.get(
        `${productId}:${workspaceId ?? ''}:${moduleId}:${webhookName}:${idempotencyKey}`
      );
      return id ? clone(receipts.get(id)!) : null;
    },
    async markWebhookReceipt(
      id: string,
      status: RuntimeStoreWebhookReceiptStatus,
      error?: Error | string
    ) {
      const previous = receipts.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_WEBHOOK_RECEIPT_NOT_FOUND: ${id}`);
      }
      const timestamp = iso(now);
      const next = {
        ...previous,
        status,
        attempts: status === 'processing' ? previous.attempts + 1 : previous.attempts,
        processedAt: status === 'processed' ? timestamp : previous.processedAt,
        updatedAt: timestamp,
        error: error ? normalizeError(error) : undefined,
      };
      receipts.set(id, next);
      return clone(next);
    },
    async listWebhookReceipts(query = {}) {
      return [...receipts.values()]
        .filter((receipt) => !query.productId || receipt.productId === query.productId)
        .filter((receipt) => !query.moduleId || receipt.moduleId === query.moduleId)
        .filter((receipt) => !query.status || receipt.status === query.status)
        .map((receipt) => clone(receipt));
    },
  };
}

import type { RuntimeStore, RuntimeStoreOutboxRecord, RuntimeStoreOutboxStatus } from '../stores';
import {
  classifyRuntimeRetryError,
  retryPolicyFromOutbox,
  resolveRuntimeRetryPolicy,
  runtimeRetryDelayMs,
  type RuntimeRetryPolicyInput,
} from './retry-policy';

export interface RuntimeStoreQueueMessage<TPayload = unknown> {
  id: string;
  name: string;
  payload: TPayload;
  metadata: Record<string, unknown>;
  attempts: number;
}

export interface RuntimeStoreQueueDrainResult {
  processed: number;
  failed: number;
  deadLettered: number;
  durationMs: number;
  records: RuntimeStoreOutboxRecord[];
}

export interface CreateRuntimeStoreQueueOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  moduleId?: string | null;
  defaultMaxAttempts?: number;
}

export interface RuntimeStoreQueue {
  enqueue<TPayload = unknown>(input: {
    name: string;
    payload: TPayload;
    moduleId?: string | null;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
    maxAttempts?: number;
    retryPolicy?: RuntimeRetryPolicyInput;
    scheduledAt?: string;
    priority?: number;
  }): Promise<RuntimeStoreOutboxRecord<TPayload>>;
  drain<TPayload = unknown>(input: {
    name?: string;
    namePrefix?: string;
    limit?: number;
    concurrency?: number;
    maxAttempts?: number;
    leaseOwner?: string;
    leaseMs?: number;
    retryBackoffMs?: number | ((record: RuntimeStoreOutboxRecord) => number);
    retryPolicy?: RuntimeRetryPolicyInput;
    handler: (message: RuntimeStoreQueueMessage<TPayload>) => Promise<void> | void;
  }): Promise<RuntimeStoreQueueDrainResult>;
  replay(id: string): Promise<RuntimeStoreOutboxRecord>;
  discard(id: string, reason?: string): Promise<RuntimeStoreOutboxRecord>;
  list(query?: {
    status?: RuntimeStoreOutboxStatus;
    name?: string;
    namePrefix?: string;
  }): Promise<RuntimeStoreOutboxRecord[]>;
}

function maxAttemptsFor(record: RuntimeStoreOutboxRecord, fallback: number): number {
  const value = record.metadata.maxAttempts;
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function retryDelayMsFor(
  record: RuntimeStoreOutboxRecord,
  strategy: number | ((record: RuntimeStoreOutboxRecord) => number) | undefined
): number {
  if (typeof strategy === 'function') {
    return Math.max(0, strategy(record));
  }
  if (typeof strategy === 'number' && Number.isFinite(strategy)) {
    return Math.max(0, strategy);
  }
  const metadataDelay = record.metadata.retryBackoffMs;
  if (typeof metadataDelay === 'number' && Number.isFinite(metadataDelay)) {
    return Math.max(0, metadataDelay);
  }
  return 0;
}

export function createRuntimeStoreQueue(
  options: CreateRuntimeStoreQueueOptions
): RuntimeStoreQueue {
  const defaultMaxAttempts = options.defaultMaxAttempts ?? 3;

  return {
    enqueue(input) {
      return options.store.enqueueOutbox({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: input.moduleId ?? options.moduleId,
        name: input.name,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        scheduledAt: input.scheduledAt,
        priority: input.priority,
        metadata: {
          ...(input.metadata ?? {}),
          maxAttempts: input.maxAttempts ?? defaultMaxAttempts,
          ...(input.retryPolicy === undefined ? {} : { retryPolicy: input.retryPolicy }),
        },
      });
    },
    async drain(input) {
      const startedAt = Date.now();
      const records = await options.store.claimOutbox({
        productId: options.productId,
        workspaceId: options.workspaceId,
        name: input.name,
        namePrefix: input.namePrefix,
        limit: input.limit,
        leaseOwner: input.leaseOwner,
        leaseMs: input.leaseMs,
      });
      const result: RuntimeStoreQueueDrainResult = {
        processed: 0,
        failed: 0,
        deadLettered: 0,
        durationMs: 0,
        records: [],
      };
      const concurrency = Math.max(
        1,
        Math.min(records.length || 1, Math.floor(input.concurrency ?? 1))
      );
      let nextIndex = 0;

      async function processRecord(record: RuntimeStoreOutboxRecord) {
        try {
          await input.handler({
            id: record.id,
            name: record.name,
            payload: record.payload as never,
            metadata: record.metadata,
            attempts: record.attempts,
          });
          result.records.push(await options.store.markOutbox(record.id, 'processed'));
          result.processed += 1;
        } catch (error) {
          const maxAttempts = input.maxAttempts ?? maxAttemptsFor(record, defaultMaxAttempts);
          const retryPolicy = input.retryPolicy
            ? resolveRuntimeRetryPolicy(input.retryPolicy, maxAttempts)
            : record.metadata.retryPolicy !== undefined
              ? retryPolicyFromOutbox(record, maxAttempts)
              : null;
          const classification = retryPolicy
            ? classifyRuntimeRetryError(error, retryPolicy)
            : 'retryable';
          const status =
            classification === 'permanent' ||
            record.attempts >= (retryPolicy?.maxAttempts ?? maxAttempts)
              ? 'dead_letter'
              : 'failed';
          const retryDelayMs = retryPolicy
            ? runtimeRetryDelayMs(retryPolicy, record.attempts)
            : retryDelayMsFor(record, input.retryBackoffMs);
          const scheduledAt =
            status === 'failed' && retryDelayMs > 0
              ? new Date(Date.now() + retryDelayMs).toISOString()
              : null;
          result.records.push(
            await options.store.markOutbox(
              record.id,
              status,
              error instanceof Error ? error : String(error),
              { scheduledAt }
            )
          );
          if (status === 'dead_letter') {
            result.deadLettered += 1;
          } else {
            result.failed += 1;
          }
        }
      }

      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (nextIndex < records.length) {
            const record = records[nextIndex++];
            if (record) {
              await processRecord(record);
            }
          }
        })
      );

      result.durationMs = Date.now() - startedAt;
      return result;
    },
    replay(id) {
      return options.store.markOutbox(id, 'queued');
    },
    discard(id, reason = 'Discarded by admin') {
      return options.store.markOutbox(id, 'dead_letter', reason);
    },
    list(query = {}) {
      return options.store.listOutbox({
        productId: options.productId,
        workspaceId: options.workspaceId,
        status: query.status,
        name: query.name,
        namePrefix: query.namePrefix,
      });
    },
  };
}

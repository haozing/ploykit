import type { ModuleContext } from '@ploykit/module-sdk';
import { readModuleDefaultExport } from '../../module-runtime/adapters';
import {
  createModuleBackgroundContext,
  type ModuleBackgroundContextCapabilities,
} from '../../module-runtime/context';
import type { ModuleRuntimeHost } from '../../module-runtime/host';
import { createRuntimeStoreQueue, type RuntimeStoreQueueDrainResult } from '../../module-runtime/queue';
import type { ModuleRunRecord } from '../../module-runtime/runs';
import type { ModuleRuntimeAccessSession } from '../../module-runtime/security';
import type { RuntimeStore, RuntimeStoreOutboxRecord } from '../../module-runtime/stores';
import type { ModuleJobHandler } from './job-runner';

export interface RuntimeStoreJobRunner {
  enqueueJob<TInput = unknown>(input: {
    moduleId: string;
    name: string;
    input?: TInput;
    idempotencyKey?: string;
    maxAttempts?: number;
    scheduledAt?: string;
    priority?: number;
    ownerId?: string;
  }): Promise<ModuleRunRecord<TInput>>;
  drain(input?: {
    limit?: number;
    concurrency?: number;
    maxAttempts?: number;
    leaseOwner?: string;
    leaseMs?: number;
    retryBackoffMs?: number | ((record: RuntimeStoreOutboxRecord) => number);
  }): Promise<RuntimeStoreQueueDrainResult>;
}

export interface CreateRuntimeStoreJobRunnerOptions {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
  session?: ModuleRuntimeAccessSession;
  capabilities?: ModuleBackgroundContextCapabilities;
}

function normalizeModulePath(value: string): string {
  return value.replace(/^\.\//, '');
}

function withRunOwner<TInput>(value: TInput | undefined, ownerId: string | undefined): unknown {
  if (!ownerId) {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>), ownerId };
  }
  if (value === undefined) {
    return { ownerId };
  }
  return { value, ownerId };
}

function asJobHandler(value: unknown): ModuleJobHandler | null {
  const exported = readModuleDefaultExport(value);
  if (typeof exported === 'function') {
    return exported as ModuleJobHandler;
  }
  if (exported && typeof exported === 'object' && 'run' in exported) {
    const run = (exported as { run?: unknown }).run;
    return typeof run === 'function' ? (run as ModuleJobHandler) : null;
  }
  return null;
}

function timeoutAfter(timeoutMs: number, label: string): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`MODULE_JOB_TIMEOUT: ${label}`)), timeoutMs);
  });
}

async function runWithTimeout<TResult>(
  task: Promise<TResult>,
  timeoutMs: number | undefined,
  label: string
): Promise<TResult> {
  if (!timeoutMs) {
    return task;
  }
  return Promise.race([task, timeoutAfter(timeoutMs, label)]);
}

export function createRuntimeStoreJobRunner(
  host: ModuleRuntimeHost,
  options: CreateRuntimeStoreJobRunnerOptions
): RuntimeStoreJobRunner {
  const queue = createRuntimeStoreQueue({
    store: options.store,
    productId: options.productId,
    workspaceId: options.workspaceId,
  });

  return {
    async enqueueJob<TInput = unknown>(input: {
      moduleId: string;
      name: string;
      input?: TInput;
      idempotencyKey?: string;
      maxAttempts?: number;
      scheduledAt?: string;
      priority?: number;
      ownerId?: string;
    }) {
      const contract = host.getContract(input.moduleId);
      const definition = contract?.jobs[input.name];
      if (!contract || !definition) {
        throw new Error(`MODULE_JOB_NOT_FOUND: ${input.moduleId}.${input.name}`);
      }
      const run = await options.store.createRun({
        productId: options.productId,
        workspaceId: options.workspaceId,
        moduleId: input.moduleId,
        kind: 'job',
        name: input.name,
        input: withRunOwner(input.input, input.ownerId),
        maxAttempts: input.maxAttempts ?? (definition.retries ?? 0) + 1,
        idempotencyKey: input.idempotencyKey,
      });
      await queue.enqueue({
        name: `job:${input.moduleId}:${input.name}`,
        moduleId: input.moduleId,
        payload: {
          runId: run.id,
          moduleId: input.moduleId,
          name: input.name,
          input: input.input,
        },
        idempotencyKey: input.idempotencyKey
          ? `job:${input.moduleId}:${input.name}:${input.idempotencyKey}`
          : undefined,
        maxAttempts: input.maxAttempts ?? (definition.retries ?? 0) + 1,
        scheduledAt: input.scheduledAt,
        priority: input.priority,
      });
      return run as ModuleRunRecord<TInput>;
    },
    drain(input: {
      limit?: number;
      concurrency?: number;
      maxAttempts?: number;
      leaseOwner?: string;
      leaseMs?: number;
      retryBackoffMs?: number | ((record: RuntimeStoreOutboxRecord) => number);
    } = {}) {
      return queue.drain({
        namePrefix: 'job:',
        limit: input.limit,
        concurrency: input.concurrency,
        maxAttempts: input.maxAttempts,
        leaseOwner: input.leaseOwner,
        leaseMs: input.leaseMs,
        retryBackoffMs: input.retryBackoffMs,
        handler: async (message) => {
          const payload = message.payload as {
            runId: string;
            moduleId: string;
            name: string;
            input?: unknown;
          };
          const contract = host.getContract(payload.moduleId);
          const definition = contract?.jobs[payload.name];
          if (!contract || !definition) {
            throw new Error(`MODULE_JOB_NOT_FOUND: ${payload.moduleId}.${payload.name}`);
          }
          const current = await options.store.getRun(payload.runId);
          if (current?.status === 'cancel_requested') {
            await options.store.updateRunStatus(payload.runId, 'canceled', {
              error: { code: 'MODULE_RUN_CANCELED', message: 'Canceled before execution.' },
            });
            return;
          }
          await options.store.updateRunStatus(payload.runId, 'running', { progress: 0 });
          try {
            const entry = host.getMapEntry(contract.id);
            const loader = entry?.jobs?.[normalizeModulePath(definition.handler)];
            if (!loader) {
              throw new Error(`MODULE_JOB_HANDLER_MISSING: ${definition.handler}`);
            }
            const handler = asJobHandler(await loader());
            if (!handler) {
              throw new Error(`MODULE_JOB_HANDLER_INVALID: ${definition.handler}`);
            }
            const request = new Request(
              `http://localhost/modules/${contract.id}/jobs/${encodeURIComponent(payload.name)}`,
              { method: 'POST' }
            );
            const ctx = createModuleBackgroundContext({
              host,
              contract,
              request,
              session: options.session,
              capabilities: options.capabilities,
            });
            const result = await runWithTimeout(
              Promise.resolve(handler(ctx, payload.input, current as ModuleRunRecord)),
              definition.timeoutMs,
              `${contract.id}.${payload.name}`
            );
            await options.store.updateRunStatus(payload.runId, 'succeeded', {
              progress: 100,
              result,
            });
          } catch (error) {
            await options.store.appendRunLog(
              payload.runId,
              'error',
              error instanceof Error ? error.message : String(error)
            );
            await options.store.updateRunStatus(payload.runId, 'failed', {
              error: {
                code:
                  error instanceof Error ? error.name || 'MODULE_JOB_FAILED' : 'MODULE_JOB_FAILED',
                message: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          }
        },
      });
    },
  };
}

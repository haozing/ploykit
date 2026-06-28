import type { ModuleRuntimeContract } from '@/lib/module-runtime/contract/types';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import type {
  ModuleEventPublishResult,
  ModuleJobsApi,
  ModuleRunError,
  ModuleRunRecord,
  ModuleRunsApi,
} from '@ploykit/module-sdk';
import { defaultProductId } from '../default-scope';

function sessionOwnerId(session: ModuleHostSession): string | undefined {
  return session.userId ?? session.user?.id ?? session.actorId;
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

function normalizeRunProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function normalizeRunError(error: ModuleRunError | Error | string): {
  code: string;
  message: string;
} {
  if (typeof error === 'string') {
    return { code: 'MODULE_RUN_FAILED', message: error };
  }
  if ('code' in error && typeof error.code === 'string') {
    return { code: error.code, message: error.message };
  }
  return {
    code: error instanceof Error ? error.name || 'MODULE_RUN_FAILED' : 'MODULE_RUN_FAILED',
    message: error.message,
  };
}

export function createScopedJobsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}): ModuleJobsApi {
  return {
    async list() {
      return Object.entries(input.contract.jobs).map(([name, definition]) => ({
        moduleId: input.contract.id,
        name,
        schedule: definition.schedule,
        timeoutMs: definition.timeoutMs,
        retries: definition.retries,
      }));
    },
    async run<TInput = unknown, TResult = unknown>(
      name: string,
      jobInput?: TInput,
      options?: { idempotencyKey?: string }
    ) {
      const definition = input.contract.jobs[name];
      if (!definition) {
        throw new Error(`MODULE_JOB_NOT_FOUND: ${input.contract.id}.${name}`);
      }
      const run = await input.store.createRun({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: input.contract.id,
        kind: 'job',
        name,
        input: withRunOwner(jobInput, sessionOwnerId(input.session)),
        maxAttempts: (definition.retries ?? 0) + 1,
        idempotencyKey: options?.idempotencyKey,
      });
      await input.store.enqueueOutbox({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: input.contract.id,
        name: `job:${input.contract.id}:${name}`,
        payload: {
          runId: run.id,
          moduleId: input.contract.id,
          name,
          input: jobInput,
        },
        idempotencyKey: options?.idempotencyKey
          ? `job:${input.contract.id}:${name}:${options.idempotencyKey}`
          : undefined,
        metadata: {
          maxAttempts: (definition.retries ?? 0) + 1,
        },
      });
      return {
        run: run as ModuleRunRecord<unknown, TResult>,
        result: undefined as TResult | undefined,
      };
    },
  };
}

export function createScopedRunsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}): ModuleRunsApi {
  const productId = defaultProductId(input.session.productId);
  const workspaceId = input.session.workspaceId ?? null;

  function belongsToScope(run: ModuleRunRecord): boolean {
    return (
      run.productId === productId &&
      (run.workspaceId ?? null) === workspaceId &&
      run.moduleId === input.contract.id
    );
  }

  async function readScopedRun(id: string): Promise<ModuleRunRecord> {
    const run = await input.store.getRun(id);
    if (!run || !belongsToScope(run)) {
      throw new Error(`MODULE_RUN_NOT_FOUND: ${input.contract.id}.${id}`);
    }
    return run;
  }

  return {
    async create<TInput = unknown>(runInput: Parameters<ModuleRunsApi['create']>[0]) {
      return input.store.createRun({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        kind: runInput.kind,
        name: runInput.name,
        input: withRunOwner(runInput.input, sessionOwnerId(input.session)) as TInput,
        maxAttempts: runInput.maxAttempts,
        costRef: runInput.costRef,
        idempotencyKey: runInput.idempotencyKey,
      });
    },
    async get<TResult = unknown>(id: string) {
      const run = await input.store.getRun(id);
      return run && belongsToScope(run) ? (run as ModuleRunRecord<unknown, TResult>) : null;
    },
    async list(query = {}) {
      const runs = await input.store.listRuns({
        productId,
        workspaceId,
        moduleId: input.contract.id,
        kind: query.kind,
        status: query.status,
        idempotencyKey: query.idempotencyKey,
      });
      return query.name ? runs.filter((run) => run.name === query.name) : runs;
    },
    async updateProgress(id: string, progress: number) {
      const run = await readScopedRun(id);
      return input.store.updateRunStatus(id, run.status, {
        progress: normalizeRunProgress(progress),
        result: run.result,
        error: run.error,
      });
    },
    async appendLog(id: string, level, message, metadata) {
      await readScopedRun(id);
      return input.store.appendRunLog(id, level, message, metadata);
    },
    async succeed<TResult = unknown>(id: string, result?: TResult) {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'succeeded', {
        progress: 100,
        result,
      }) as Promise<ModuleRunRecord<unknown, TResult>>;
    },
    async fail(id: string, error: ModuleRunError | Error | string) {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'failed', {
        error: normalizeRunError(error),
      });
    },
    async requestCancel(id: string) {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'cancel_requested');
    },
    async cancel(id: string, reason = 'Canceled') {
      await readScopedRun(id);
      return input.store.updateRunStatus(id, 'canceled', {
        error: { code: 'MODULE_RUN_CANCELED', message: reason },
      });
    },
  };
}

export function createScopedEventsApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}) {
  return {
    async publish<TPayload = unknown>(
      name: string,
      payload: TPayload,
      options?: {
        correlationId?: string;
        causationId?: string;
        idempotencyKey?: string;
      }
    ): Promise<ModuleEventPublishResult<TPayload>> {
      if (!input.contract.events.publishes.includes(name)) {
        throw new Error(`MODULE_EVENT_NOT_DECLARED: ${input.contract.id}.${name}`);
      }
      const record = await input.store.enqueueOutbox({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        moduleId: input.contract.id,
        name: `event:${name}`,
        payload,
        idempotencyKey: options?.idempotencyKey,
        metadata: {
          eventName: name,
          correlationId: options?.correlationId,
          causationId: options?.causationId,
          sourceModuleId: input.contract.id,
        },
      });
      return {
        id: record.id,
        name,
        payload,
        metadata: record.metadata,
        status: 'queued' as const,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    },
  };
}

export function createScopedWebhooksApi(input: {
  contract: ModuleRuntimeContract;
  store: RuntimeStore;
  session: ModuleHostSession;
}) {
  return {
    async list() {
      return Object.entries(input.contract.webhooks).map(([name, definition]) => ({
        name,
        path: definition.path,
        methods: definition.methods ?? ['POST'],
        signature: definition.signature ?? 'none',
      }));
    },
    async getReceipt(id: string) {
      const receipts = await input.store.listWebhookReceipts({
        productId: defaultProductId(input.session.productId),
        moduleId: input.contract.id,
      });
      const receipt = receipts.find((candidate) => candidate.id === id);
      return receipt
        ? {
            id: receipt.id,
            webhookName: receipt.webhookName,
            status: receipt.status,
            createdAt: receipt.createdAt,
            processedAt: receipt.processedAt,
            error: receipt.error?.message,
          }
        : null;
    },
  };
}

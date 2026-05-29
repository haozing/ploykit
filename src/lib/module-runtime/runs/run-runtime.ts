import { randomUUID } from 'node:crypto';

export type ModuleRunKind = 'manual' | 'job' | 'event' | 'webhook' | 'lifecycle';

export type ModuleRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'canceled';

export interface ModuleRunLogEntry {
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ModuleRunError {
  code: string;
  message: string;
  stack?: string;
}

export interface ModuleRunRecord<TInput = unknown, TResult = unknown> {
  id: string;
  productId?: string;
  workspaceId?: string | null;
  moduleId: string;
  kind: ModuleRunKind;
  name: string;
  status: ModuleRunStatus;
  progress: number;
  attempt: number;
  maxAttempts: number;
  input?: TInput;
  result?: TResult;
  error?: ModuleRunError;
  costRef?: string;
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelRequestedAt?: string;
  canceledAt?: string;
  logs: ModuleRunLogEntry[];
}

export interface CreateModuleRunInput<TInput = unknown> {
  moduleId: string;
  kind: ModuleRunKind;
  name: string;
  input?: TInput;
  maxAttempts?: number;
  costRef?: string;
  idempotencyKey?: string;
}

export interface ListModuleRunsQuery {
  moduleId?: string;
  kind?: ModuleRunKind;
  name?: string;
  status?: ModuleRunStatus;
  idempotencyKey?: string;
}

export interface ModuleRunRuntime {
  createRun<TInput = unknown>(input: CreateModuleRunInput<TInput>): ModuleRunRecord<TInput>;
  getRun<TResult = unknown>(id: string): ModuleRunRecord<unknown, TResult> | null;
  listRuns(query?: ListModuleRunsQuery): ModuleRunRecord[];
  startRun(id: string): ModuleRunRecord;
  updateProgress(id: string, progress: number): ModuleRunRecord;
  appendLog(
    id: string,
    level: ModuleRunLogEntry['level'],
    message: string,
    metadata?: Record<string, unknown>
  ): ModuleRunRecord;
  succeedRun<TResult = unknown>(id: string, result?: TResult): ModuleRunRecord<unknown, TResult>;
  failRun(id: string, error: Error | ModuleRunError | string): ModuleRunRecord;
  requestCancel(id: string): ModuleRunRecord;
  cancelRun(id: string, reason?: string): ModuleRunRecord;
}

export interface CreateInMemoryModuleRunRuntimeOptions {
  now?: () => Date;
  createId?: () => string;
}

function cloneRun<TInput = unknown, TResult = unknown>(
  run: ModuleRunRecord<TInput, TResult>
): ModuleRunRecord<TInput, TResult> {
  return {
    ...run,
    logs: run.logs.map((log) => ({
      ...log,
      metadata: log.metadata ? { ...log.metadata } : undefined,
    })),
  };
}

function toIso(now: () => Date): string {
  return now().toISOString();
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(progress)));
}

function normalizeError(error: Error | ModuleRunError | string): ModuleRunError {
  if (typeof error === 'string') {
    return { code: 'MODULE_RUN_FAILED', message: error };
  }

  if ('code' in error && typeof error.code === 'string') {
    return {
      code: error.code,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    code: error instanceof Error ? error.name || 'MODULE_RUN_FAILED' : 'MODULE_RUN_FAILED',
    message: error.message,
    stack: error.stack,
  };
}

export function createInMemoryModuleRunRuntime(
  options: CreateInMemoryModuleRunRuntimeOptions = {}
): ModuleRunRuntime {
  const runs = new Map<string, ModuleRunRecord>();
  const idempotencyIndex = new Map<string, string>();
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? (() => `run_${randomUUID()}`);

  function read<TInput = unknown, TResult = unknown>(id: string): ModuleRunRecord<TInput, TResult> {
    const run = runs.get(id);
    if (!run) {
      throw new Error(`MODULE_RUN_NOT_FOUND: ${id}`);
    }
    return run as ModuleRunRecord<TInput, TResult>;
  }

  function save<TInput = unknown, TResult = unknown>(
    run: ModuleRunRecord<TInput, TResult>
  ): ModuleRunRecord<TInput, TResult> {
    runs.set(run.id, run);
    return cloneRun(run);
  }

  return {
    createRun<TInput = unknown>(input: CreateModuleRunInput<TInput>) {
      if (input.idempotencyKey) {
        const existingId = idempotencyIndex.get(input.idempotencyKey);
        if (existingId) {
          return cloneRun(read<TInput>(existingId));
        }
      }

      const timestamp = toIso(now);
      const run: ModuleRunRecord<TInput> = {
        id: createId(),
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
      if (input.idempotencyKey) {
        idempotencyIndex.set(input.idempotencyKey, run.id);
      }
      return cloneRun(run);
    },
    getRun<TResult = unknown>(id: string) {
      const run = runs.get(id);
      return run ? (cloneRun(run) as ModuleRunRecord<unknown, TResult>) : null;
    },
    listRuns(query = {}) {
      return [...runs.values()]
        .filter((run) => !query.moduleId || run.moduleId === query.moduleId)
        .filter((run) => !query.kind || run.kind === query.kind)
        .filter((run) => !query.name || run.name === query.name)
        .filter((run) => !query.status || run.status === query.status)
        .filter((run) => !query.idempotencyKey || run.idempotencyKey === query.idempotencyKey)
        .map((run) => cloneRun(run));
    },
    startRun(id) {
      const run = read(id);
      const timestamp = toIso(now);
      return save({
        ...run,
        status: 'running',
        attempt: run.attempt + 1,
        startedAt: run.startedAt ?? timestamp,
        updatedAt: timestamp,
      });
    },
    updateProgress(id, progress) {
      const run = read(id);
      return save({
        ...run,
        progress: normalizeProgress(progress),
        updatedAt: toIso(now),
      });
    },
    appendLog(id, level, message, metadata) {
      const run = read(id);
      return save({
        ...run,
        logs: [
          ...run.logs,
          {
            at: toIso(now),
            level,
            message,
            metadata,
          },
        ],
        updatedAt: toIso(now),
      });
    },
    succeedRun<TResult = unknown>(id: string, result?: TResult) {
      const run = read<unknown, TResult>(id);
      const timestamp = toIso(now);
      return save({
        ...run,
        status: 'succeeded',
        progress: 100,
        result,
        error: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
    },
    failRun(id, error) {
      const run = read(id);
      const timestamp = toIso(now);
      return save({
        ...run,
        status: 'failed',
        error: normalizeError(error),
        completedAt: timestamp,
        updatedAt: timestamp,
      });
    },
    requestCancel(id) {
      const run = read(id);
      const timestamp = toIso(now);
      return save({
        ...run,
        status: 'cancel_requested',
        cancelRequestedAt: timestamp,
        updatedAt: timestamp,
      });
    },
    cancelRun(id, reason = 'Canceled') {
      const run = read(id);
      const timestamp = toIso(now);
      return save({
        ...run,
        status: 'canceled',
        error: { code: 'MODULE_RUN_CANCELED', message: reason },
        canceledAt: timestamp,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
    },
  };
}

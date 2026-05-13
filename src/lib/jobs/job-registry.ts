/**
 * Job Registry
 *
 * Central registry for background jobs.
 * Provides type-safe job definitions and execution tracking.
 */

import { logger } from '@/lib/_core/logger';

export type JobPriority = 'low' | 'normal' | 'high' | 'critical';
export type JobRunStatus = 'running' | 'succeeded' | 'failed';

export interface JobDefinition<TPayload = unknown> {
  name: string;
  description?: string;
  priority: JobPriority;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
  handler: (payload: TPayload) => Promise<void>;
}

export interface RunJobOptions {
  idempotencyKey?: string;
}

export interface JobRunRecord {
  id: string;
  jobName: string;
  status: JobRunStatus;
  attempts: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  idempotencyKey?: string;
}

const registry = new Map<string, JobDefinition>();
const runs = new Map<string, JobRunRecord>();
const idempotencyIndex = new Map<string, string>();

function generateRunId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, jobName: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Job "${jobName}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

async function findPersistedRun(idempotencyKey: string | undefined): Promise<JobRunRecord | null> {
  if (!idempotencyKey) {
    return null;
  }

  try {
    const { findPersistedJobRunByIdempotencyKey } = await import('./job-run-store.server');
    return findPersistedJobRunByIdempotencyKey(idempotencyKey);
  } catch (error) {
    logger.warn(
      { idempotencyKey, error: error instanceof Error ? error.message : String(error) },
      'Failed to read persisted job run'
    );
    return null;
  }
}

async function persistRunStarted<TPayload>(
  run: JobRunRecord,
  definition: JobDefinition<TPayload>,
  payload: TPayload
): Promise<void> {
  try {
    const { persistJobRunStarted } = await import('./job-run-store.server');
    await persistJobRunStarted(run, definition, payload);
  } catch (error) {
    logger.warn(
      {
        jobName: run.jobName,
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to persist job run start'
    );
  }
}

async function persistRunCompleted(run: JobRunRecord): Promise<void> {
  try {
    const { persistJobRunCompleted } = await import('./job-run-store.server');
    await persistJobRunCompleted(run);
  } catch (error) {
    logger.warn(
      {
        jobName: run.jobName,
        runId: run.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to persist job run completion'
    );
  }
}

export function registerJob<TPayload>(definition: JobDefinition<TPayload>): void {
  registry.set(definition.name, definition as JobDefinition);
  logger.debug(
    { jobName: definition.name, priority: definition.priority },
    'Background job registered'
  );
}

export function unregisterJob(name: string): void {
  registry.delete(name);
  logger.debug({ jobName: name }, 'Background job unregistered');
}

export function unregisterJobsForPlugin(pluginId: string): number {
  const prefix = `${pluginId}.`;
  let removed = 0;

  for (const name of Array.from(registry.keys())) {
    if (name.startsWith(prefix)) {
      registry.delete(name);
      removed += 1;
    }
  }

  logger.debug({ pluginId, removed }, 'Background jobs unregistered for plugin');
  return removed;
}

export function getJob(name: string): JobDefinition | undefined {
  return registry.get(name);
}

export function listJobs(): JobDefinition[] {
  return Array.from(registry.values());
}

export async function runJob<TPayload>(
  name: string,
  payload: TPayload,
  options: RunJobOptions = {}
): Promise<JobRunRecord> {
  const definition = registry.get(name) as JobDefinition<TPayload> | undefined;

  if (!definition) {
    throw new Error(`Job "${name}" is not registered`);
  }

  if (options.idempotencyKey) {
    const existingRunId = idempotencyIndex.get(options.idempotencyKey);
    if (existingRunId) {
      const existingRun = runs.get(existingRunId);
      if (existingRun) {
        logger.debug(
          { jobName: name, runId: existingRun.id, idempotencyKey: options.idempotencyKey },
          'Returning existing job run for idempotency key'
        );
        return existingRun;
      }
    }
  }

  const persistedRun = await findPersistedRun(options.idempotencyKey);
  if (persistedRun) {
    runs.set(persistedRun.id, persistedRun);
    if (options.idempotencyKey) {
      idempotencyIndex.set(options.idempotencyKey, persistedRun.id);
    }
    logger.debug(
      { jobName: name, runId: persistedRun.id, idempotencyKey: options.idempotencyKey },
      'Returning persisted job run for idempotency key'
    );
    return persistedRun;
  }

  const run: JobRunRecord = {
    id: generateRunId(),
    jobName: name,
    status: 'running',
    attempts: 0,
    startedAt: new Date(),
    idempotencyKey: options.idempotencyKey,
  };

  runs.set(run.id, run);
  if (options.idempotencyKey) {
    idempotencyIndex.set(options.idempotencyKey, run.id);
  }
  await persistRunStarted(run, definition, payload);

  const maxAttempts = definition.maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    run.attempts = attempt;

    try {
      await withTimeout(definition.handler(payload), definition.timeoutMs, definition.name);
      run.status = 'succeeded';
      run.completedAt = new Date();
      run.error = undefined;

      logger.info(
        { jobName: name, runId: run.id, attempts: run.attempts },
        'Background job completed'
      );

      await persistRunCompleted(run);
      return run;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.error = message;

      if (attempt >= maxAttempts) {
        run.status = 'failed';
        run.completedAt = new Date();

        logger.error(
          { jobName: name, runId: run.id, attempts: run.attempts, error: message },
          'Background job failed'
        );

        await persistRunCompleted(run);
        return run;
      }

      logger.warn(
        { jobName: name, runId: run.id, attempt, error: message },
        'Background job attempt failed, retrying'
      );
      await sleep(definition.retryDelayMs);
    }
  }

  return run;
}

export function getJobRun(id: string): JobRunRecord | undefined {
  return runs.get(id);
}

export function listJobRuns(name?: string): JobRunRecord[] {
  const allRuns = Array.from(runs.values());
  return name ? allRuns.filter((run) => run.jobName === name) : allRuns;
}

export function getJobRegistryStats(): {
  jobs: number;
  runs: number;
  running: number;
  succeeded: number;
  failed: number;
  criticalJobs: number;
} {
  const allRuns = Array.from(runs.values());
  const allJobs = Array.from(registry.values());

  return {
    jobs: allJobs.length,
    runs: allRuns.length,
    running: allRuns.filter((run) => run.status === 'running').length,
    succeeded: allRuns.filter((run) => run.status === 'succeeded').length,
    failed: allRuns.filter((run) => run.status === 'failed').length,
    criticalJobs: allJobs.filter((job) => job.priority === 'critical').length,
  };
}

export function clearJobRegistry(): void {
  registry.clear();
  runs.clear();
  idempotencyIndex.clear();
}

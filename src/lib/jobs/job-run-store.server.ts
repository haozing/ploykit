import { desc, eq } from 'drizzle-orm';
import { env } from '@/lib/_core/env';
import { withSystemContext } from '@/lib/db/client.server';
import { pluginJobRuns, type PluginJobRunEntry } from '@/lib/db/schema/reliability';
import type { JobDefinition, JobRunRecord } from './job-registry';

export interface PersistedPluginJobRun {
  id: string;
  pluginId: string;
  jobName: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  startedAt: Date;
  completedAt: Date | null;
  deadLetteredAt: Date | null;
  error: string | null;
  idempotencyKey: string | null;
}

function hasDatabaseConfiguration(): boolean {
  if (env.NODE_ENV === 'test') {
    return false;
  }

  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

function inferPluginId(jobName: string): string {
  return jobName.includes('.') ? (jobName.split('.')[0] ?? '') : '';
}

function toPersistedStatus(run: JobRunRecord): PluginJobRunEntry['status'] {
  return run.status === 'failed' ? 'dead_letter' : run.status;
}

function toJobRunRecord(entry: PluginJobRunEntry): JobRunRecord {
  return {
    id: entry.id,
    jobName: entry.jobName,
    status: entry.status === 'dead_letter' ? 'failed' : entry.status,
    attempts: entry.attempts,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt ?? undefined,
    error: entry.error ?? undefined,
    idempotencyKey: entry.idempotencyKey ?? undefined,
  };
}

export async function findPersistedJobRunByIdempotencyKey(
  idempotencyKey: string | undefined
): Promise<JobRunRecord | null> {
  if (!idempotencyKey || !hasDatabaseConfiguration()) {
    return null;
  }

  return withSystemContext(async (database) => {
    const [entry] = await database
      .select()
      .from(pluginJobRuns)
      .where(eq(pluginJobRuns.idempotencyKey, idempotencyKey))
      .limit(1);

    return entry ? toJobRunRecord(entry) : null;
  });
}

export async function persistJobRunStarted<TPayload>(
  run: JobRunRecord,
  definition: JobDefinition<TPayload>,
  payload: TPayload
): Promise<void> {
  if (!hasDatabaseConfiguration()) {
    return;
  }

  await withSystemContext(async (database) => {
    await database
      .insert(pluginJobRuns)
      .values({
        id: run.id,
        pluginId: inferPluginId(run.jobName),
        jobName: run.jobName,
        status: 'running',
        priority: definition.priority,
        payload: payload ?? {},
        attempts: run.attempts,
        maxAttempts: definition.maxRetries + 1,
        idempotencyKey: run.idempotencyKey,
        startedAt: run.startedAt,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();
  });
}

export async function persistJobRunCompleted(run: JobRunRecord): Promise<void> {
  if (!hasDatabaseConfiguration()) {
    return;
  }

  const status = toPersistedStatus(run);
  await withSystemContext(async (database) => {
    await database
      .update(pluginJobRuns)
      .set({
        status,
        attempts: run.attempts,
        error: run.error,
        completedAt: run.completedAt,
        deadLetteredAt: status === 'dead_letter' ? (run.completedAt ?? new Date()) : null,
        updatedAt: new Date(),
      })
      .where(eq(pluginJobRuns.id, run.id));
  });
}

export async function listPersistedPluginJobRuns(
  pluginId: string,
  limit = 5
): Promise<PersistedPluginJobRun[]> {
  if (!hasDatabaseConfiguration()) {
    return [];
  }

  return withSystemContext(async (database) =>
    database
      .select({
        id: pluginJobRuns.id,
        pluginId: pluginJobRuns.pluginId,
        jobName: pluginJobRuns.jobName,
        status: pluginJobRuns.status,
        attempts: pluginJobRuns.attempts,
        maxAttempts: pluginJobRuns.maxAttempts,
        startedAt: pluginJobRuns.startedAt,
        completedAt: pluginJobRuns.completedAt,
        deadLetteredAt: pluginJobRuns.deadLetteredAt,
        error: pluginJobRuns.error,
        idempotencyKey: pluginJobRuns.idempotencyKey,
      })
      .from(pluginJobRuns)
      .where(eq(pluginJobRuns.pluginId, pluginId))
      .orderBy(desc(pluginJobRuns.startedAt))
      .limit(limit)
  );
}

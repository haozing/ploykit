import {
  PluginError,
  type PluginContext,
  type PluginResourceScope,
  type PluginServiceJsonResult,
} from '@ploykit/plugin-sdk';

export interface RunLynkProject {
  id: string;
  name: string;
  slug: string;
  status?: string;
}

export interface RunLynkTaskType {
  id: string;
  project_id: string;
  task_key: string;
  name: string;
  description?: string;
  status: string;
}

export interface RunLynkWorkerContract {
  contract_version: 'runlynk.worker.v1';
  project_id: string;
  task_type_id: string;
  task_key: string;
  name: string;
  description?: string;
  input_schema: unknown;
  output_schema: unknown;
  required_worker_tags: readonly string[];
  worker_pool_id?: string | null;
  max_jobs_per_pull: number;
  lease_sec: number;
  timeout_sec: number;
  max_retry: number;
  producer_enabled: boolean;
  callbacks_enabled: boolean;
  scheduler_enabled: boolean;
  storage_enabled: boolean;
  allow_encrypted_payload: boolean;
  allow_encrypted_result: boolean;
  worker_protocol: {
    pull: string;
    renew: string;
    success: string;
    failure: string;
    progress: string;
    logs: string;
  };
  starter_defaults: Record<string, unknown>;
  mock_input: unknown;
}

export interface RunLynkWorkerToken {
  id: string;
  token?: string;
  name: string;
  status: string;
}

export interface RunLynkJob {
  id: string;
  project_id: string;
  task_key: string;
  status: string;
  progress?: number;
  attempt_count?: number;
  max_retry?: number;
  input?: unknown;
  result?: unknown;
  encrypted_payload?: unknown;
  encrypted_result?: unknown;
  error_code?: string | null;
  error_message?: string | null;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface RunLynkJobEvent {
  id: string;
  event_type: string;
  message?: string;
  metadata?: unknown;
  created_at?: string;
}

export interface RunLynkJobLog {
  id: string;
  level: string;
  message: string;
  metadata?: unknown;
  created_at?: string;
}

export interface ValidatorStatus {
  job: RunLynkJob;
  events: RunLynkJobEvent[];
  logs: RunLynkJobLog[];
  state: 'waiting' | 'running' | 'passed' | 'failed' | 'cancelled' | 'unknown';
  checks: Array<{ key: string; label: string; passed: boolean }>;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nestedError = record.error;
    if (nestedError && typeof nestedError === 'object') {
      const message = (nestedError as Record<string, unknown>).message;
      if (typeof message === 'string' && message) {
        return message;
      }
    }
    if (typeof record.message === 'string' && record.message) {
      return record.message;
    }
  }
  return fallback;
}

function unwrapCoreResult<T>(result: PluginServiceJsonResult<T>, template: string): T {
  if (result.ok) {
    return result.data;
  }

  throw new PluginError({
    code: 'RUNLYNK_CORE_REQUEST_FAILED',
    message: errorMessage(result.error, `RunLynk Core request failed with HTTP ${result.status}.`),
    statusCode: result.status,
    details: {
      template,
      status: result.status,
      error: result.error,
    },
  });
}

export async function createProject(
  ctx: PluginContext,
  body: unknown,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects';
  const result = await ctx.services.requestJson<RunLynkProject>('runlynk-core', {
    template: '/v1/projects',
    method: 'POST',
    json: body,
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function getProject(
  ctx: PluginContext,
  projectId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId';
  const result = await ctx.services.requestJson<RunLynkProject>('runlynk-core', {
    template: '/v1/projects/:projectId',
    params: { projectId },
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function listTaskTypes(
  ctx: PluginContext,
  projectId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/task-types';
  const result = await ctx.services.requestJson<{ task_types: RunLynkTaskType[] }>('runlynk-core', {
    template: '/v1/projects/:projectId/task-types',
    params: { projectId },
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function getWorkerContract(
  ctx: PluginContext,
  projectId: string,
  taskTypeId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/task-types/:taskTypeId/worker-contract';
  const result = await ctx.services.requestJson<RunLynkWorkerContract>('runlynk-core', {
    template: '/v1/projects/:projectId/task-types/:taskTypeId/worker-contract',
    params: { projectId, taskTypeId },
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function createWorkerToken(
  ctx: PluginContext,
  projectId: string,
  body: unknown,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/worker-tokens';
  const result = await ctx.services.requestJson<RunLynkWorkerToken>('runlynk-core', {
    template: '/v1/projects/:projectId/worker-tokens',
    params: { projectId },
    method: 'POST',
    json: body,
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function createJob(
  ctx: PluginContext,
  projectId: string,
  body: unknown,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/jobs';
  const result = await ctx.services.requestJson<RunLynkJob>('runlynk-core', {
    template: '/v1/projects/:projectId/jobs',
    params: { projectId },
    method: 'POST',
    json: body,
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function getJob(
  ctx: PluginContext,
  projectId: string,
  jobId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/jobs/:jobId';
  const result = await ctx.services.requestJson<RunLynkJob>('runlynk-core', {
    template: '/v1/projects/:projectId/jobs/:jobId',
    params: { projectId, jobId },
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function listJobEvents(
  ctx: PluginContext,
  projectId: string,
  jobId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/jobs/:jobId/events';
  const result = await ctx.services.requestJson<{ events: RunLynkJobEvent[] }>('runlynk-core', {
    template: '/v1/projects/:projectId/jobs/:jobId/events',
    params: { projectId, jobId },
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function listJobLogs(
  ctx: PluginContext,
  projectId: string,
  jobId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/jobs/:jobId/logs';
  const result = await ctx.services.requestJson<{ logs: RunLynkJobLog[] }>('runlynk-core', {
    template: '/v1/projects/:projectId/jobs/:jobId/logs',
    params: { projectId, jobId },
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

export async function getValidatorStatus(
  ctx: PluginContext,
  projectId: string,
  jobId: string,
  scope?: PluginResourceScope
): Promise<ValidatorStatus> {
  const [job, events, logs] = await Promise.all([
    getJob(ctx, projectId, jobId, scope),
    listJobEvents(ctx, projectId, jobId, scope),
    listJobLogs(ctx, projectId, jobId, scope),
  ]);
  return buildValidatorStatus(job, events.events ?? [], logs.logs ?? []);
}

export function buildValidatorStatus(
  job: RunLynkJob,
  events: RunLynkJobEvent[],
  logs: RunLynkJobLog[]
): ValidatorStatus {
  const eventTypes = new Set(events.map((event) => event.event_type));
  const checks = [
    { key: 'created', label: 'Mock job created', passed: eventTypes.has('job.created') },
    { key: 'claimed', label: 'Worker pulled the job', passed: eventTypes.has('job.claimed') },
    { key: 'progress', label: 'Worker reported progress', passed: eventTypes.has('job.progress') },
    {
      key: 'completed',
      label: 'Worker reported a terminal result',
      passed: ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(job.status),
    },
    { key: 'logs', label: 'Worker sent logs', passed: logs.length > 0 },
  ];
  const state =
    job.status === 'SUCCEEDED'
      ? 'passed'
      : job.status === 'FAILED'
        ? 'failed'
        : job.status === 'CANCELLED'
          ? 'cancelled'
          : job.status === 'RUNNING'
            ? 'running'
            : job.status === 'WAITING' || job.status === 'SCHEDULED'
              ? 'waiting'
              : 'unknown';

  return { job, events, logs, state, checks };
}

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
  status: string;
  producer_enabled?: boolean;
  callbacks_enabled?: boolean;
}

export interface RunLynkWorkerContract {
  contract_version: string;
  project_id: string;
  task_type_id: string;
  task_key: string;
  name: string;
  description?: string;
  input_schema: unknown;
  output_schema: unknown;
  producer_enabled: boolean;
  callbacks_enabled: boolean;
  allow_encrypted_payload: boolean;
  allow_encrypted_result: boolean;
  mock_input: unknown;
}

export interface RunLynkProducerKey {
  id: string;
  project_id: string;
  name: string;
  key?: string;
  scopes?: string[];
  rate_limit_per_minute?: number;
  status: string;
  last_used_at?: string | null;
  created_at?: string;
  updated_at?: string;
  revoked_at?: string | null;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const nested = record.error;
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message;
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

export async function listProducerKeys(
  ctx: PluginContext,
  projectId: string,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/producer-keys';
  const result = await ctx.services.requestJson<{ producer_keys: RunLynkProducerKey[] }>(
    'runlynk-core',
    {
      template: '/v1/projects/:projectId/producer-keys',
      params: { projectId },
      scope,
      errorMode: 'preserve',
    }
  );
  return unwrapCoreResult(result, template);
}

export async function createProducerKey(
  ctx: PluginContext,
  projectId: string,
  body: unknown,
  scope?: PluginResourceScope
) {
  const template = '/v1/projects/:projectId/producer-keys';
  const result = await ctx.services.requestJson<RunLynkProducerKey>('runlynk-core', {
    template: '/v1/projects/:projectId/producer-keys',
    params: { projectId },
    method: 'POST',
    json: body,
    scope,
    errorMode: 'preserve',
  });
  return unwrapCoreResult(result, template);
}

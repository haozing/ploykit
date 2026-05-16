import { Permission } from '@ploykit/plugin-sdk';
import {
  createPluginTestHost,
  createPluginTestHostStore,
  testPlugin,
  type PluginTestServiceHandler,
} from '@ploykit/plugin-sdk/testing';
import plugin from '../plugin';
import fixPromptApi from '../api/fix-prompt';
import mockJobApi from '../api/mock-job';
import promptApi from '../api/prompt';
import projectsApi from '../api/projects';
import starterApi from '../api/starter';
import taskTypesApi from '../api/task-types';
import validatorApi from '../api/validator';
import workerContractApi from '../api/worker-contract';
import { generateStarter, generateWorkerPrompt } from '../lib/generators';
import WorkerContractPage from '../pages/WorkerContractPage';
import WorkerDxHome from '../pages/WorkerDxHome';
import WorkerStarterPage from '../pages/WorkerStarterPage';
import WorkerValidatorPage from '../pages/WorkerValidatorPage';

const workerContract = {
  contract_version: 'runlynk.worker.v1',
  project_id: 'project-1',
  task_type_id: 'task-type-1',
  task_key: 'demo.echo',
  name: 'Demo Echo',
  description: '',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  required_worker_tags: ['local'],
  worker_pool_id: null,
  max_jobs_per_pull: 1,
  lease_sec: 60,
  timeout_sec: 300,
  max_retry: 1,
  producer_enabled: true,
  callbacks_enabled: true,
  scheduler_enabled: true,
  storage_enabled: false,
  allow_encrypted_payload: false,
  allow_encrypted_result: false,
  worker_protocol: {
    pull: '/v1/workers/pull',
    renew: '/v1/workers/jobs/{worker_job_id}/renew',
    success: '/v1/workers/jobs/{worker_job_id}/success',
    failure: '/v1/workers/jobs/{worker_job_id}/failure',
    progress: '/v1/workers/jobs/{worker_job_id}/progress',
    logs: '/v1/workers/jobs/{worker_job_id}/logs',
  },
  starter_defaults: {
    worker_name: 'demo.echo-worker',
    worker_version: '0.1.0',
    max_jobs: 1,
    max_concurrent_jobs: 1,
    poll_interval_sec: 2,
    renew_margin_sec: 30,
  },
  mock_input: { message: 'RunLynk validator mock job' },
} as const;

const serviceRequests: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];

const runlynkCoreService: PluginTestServiceHandler = async (request) => {
  if (request.scope?.type !== 'workspace' || request.scope.id !== 'workspace-1') {
    return Response.json({ message: 'workspace scope is required' }, { status: 403 });
  }
  serviceRequests.push({
    method: request.method,
    path: request.path,
    body: requestBody(request),
  });

  if (request.method === 'POST' && request.path === '/v1/projects') {
    return Response.json(
      { id: 'project-1', name: 'Workspace', slug: 'workspace', status: 'active' },
      { status: 201 }
    );
  }
  if (request.method === 'GET' && request.path === '/v1/projects/project-1') {
    return Response.json({
      id: 'project-1',
      name: 'Workspace',
      slug: 'workspace',
      status: 'active',
    });
  }
  if (request.method === 'GET' && request.path === '/v1/projects/project-1/task-types') {
    return Response.json({
      task_types: [
        {
          id: 'task-type-1',
          project_id: 'project-1',
          task_key: 'demo.echo',
          name: 'Demo Echo',
          status: 'active',
        },
      ],
    });
  }
  if (
    request.method === 'GET' &&
    request.path === '/v1/projects/project-1/task-types/task-type-1/worker-contract'
  ) {
    return Response.json(workerContract);
  }
  if (request.method === 'POST' && request.path === '/v1/projects/project-1/worker-tokens') {
    return Response.json(
      { id: 'token-1', name: 'validator-demo.echo', token: 'rlwk_validator', status: 'active' },
      { status: 201 }
    );
  }
  if (request.method === 'POST' && request.path === '/v1/projects/project-1/jobs') {
    return Response.json(
      {
        id: 'job-1',
        project_id: 'project-1',
        task_key: 'demo.echo',
        status: 'WAITING',
        progress: 0,
      },
      { status: 201 }
    );
  }
  if (request.method === 'GET' && request.path === '/v1/projects/project-1/jobs/job-1') {
    return Response.json({
      id: 'job-1',
      project_id: 'project-1',
      task_key: 'demo.echo',
      status: 'SUCCEEDED',
      progress: 100,
    });
  }
  if (request.method === 'GET' && request.path === '/v1/projects/project-1/jobs/job-1/events') {
    return Response.json({
      events: [
        { id: 'event-1', event_type: 'job.created' },
        { id: 'event-2', event_type: 'job.claimed' },
        { id: 'event-3', event_type: 'job.progress' },
      ],
    });
  }
  if (request.method === 'GET' && request.path === '/v1/projects/project-1/jobs/job-1/logs') {
    return Response.json({ logs: [{ id: 'log-1', level: 'info', message: 'ok' }] });
  }
  return Response.json({ message: `unexpected Core path ${request.path}` }, { status: 404 });
};

export default testPlugin(plugin, async ({ plugin }) => {
  if (plugin.id !== 'runlynk-worker-dx') {
    throw new Error('Plugin id must stay aligned with the directory name.');
  }
  if (!plugin.permissions?.includes(Permission.ServicesInvoke)) {
    throw new Error('Worker DX must call RunLynk Core through internal services.');
  }
  if (plugin.egress?.length) {
    throw new Error('Worker DX must not use external egress.');
  }
  if (!plugin.services?.some((service) => service.name === 'runlynk-core' && service.actorClaims)) {
    throw new Error('Worker DX must declare the RunLynk Core internal service with actor claims.');
  }

  for (const [name, component] of Object.entries({
    WorkerDxHome,
    WorkerContractPage,
    WorkerStarterPage,
    WorkerValidatorPage,
  })) {
    if (typeof component !== 'function') {
      throw new Error(`${name} page must be importable.`);
    }
  }

  const python = generateStarter(workerContract, 'python');
  if (!python.includes('/v1/workers/pull') || !python.includes('RUNLYNK_WORKER_TOKEN')) {
    throw new Error('Python starter must include Worker API calls and token env wiring.');
  }
  if (!generateWorkerPrompt(workerContract).includes('Worker Contract')) {
    throw new Error('Worker prompt must include the contract.');
  }

  serviceRequests.length = 0;
  const store = createPluginTestHostStore();
  const now = new Date();
  store.workspaces.set('workspace-1', {
    id: 'workspace-1',
    name: 'Demo Workspace',
    ownerUserId: 'test-user',
    createdAt: now,
    updatedAt: now,
  });
  const serviceHost = createPluginTestHost(plugin, {
    store,
    services: {
      'runlynk-core': runlynkCoreService,
    },
  });
  const ctx = serviceHost.ctx;
  await ctx.resourceBindings.upsert({
    scope: { type: 'workspace', id: 'workspace-1' },
    resourceType: 'project',
    resourceId: 'project-1',
    displayName: 'Project 1',
    metadata: { slug: 'project-1' },
  });

  serviceHost.setRequest({
    method: 'GET',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects',
  });
  await projectsApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'GET',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/task-types',
    params: { projectId: 'project-1' },
  });
  await taskTypesApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'GET',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/task-types/task-type-1/contract',
    params: { projectId: 'project-1', taskTypeId: 'task-type-1' },
  });
  await workerContractApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/task-types/task-type-1/starter',
    params: { projectId: 'project-1', taskTypeId: 'task-type-1' },
    json: { language: 'python' },
  });
  await starterApi.post?.(ctx);

  serviceHost.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/task-types/task-type-1/prompt',
    params: { projectId: 'project-1', taskTypeId: 'task-type-1' },
    json: {},
  });
  await promptApi.post?.(ctx);

  serviceHost.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/task-types/task-type-1/mock-job',
    params: { projectId: 'project-1', taskTypeId: 'task-type-1' },
    json: {},
  });
  await mockJobApi.post?.(ctx);

  serviceHost.setRequest({
    method: 'GET',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/jobs/job-1/validator',
    params: { projectId: 'project-1', jobId: 'job-1' },
  });
  await validatorApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/api/plugins/runlynk-worker-dx/projects/project-1/jobs/job-1/fix-prompt',
    params: { projectId: 'project-1', jobId: 'job-1' },
    json: { task_type_id: 'task-type-1' },
  });
  await fixPromptApi.post?.(ctx);

  for (const expected of [
    '/v1/projects/project-1',
    '/v1/projects/project-1/task-types',
    '/v1/projects/project-1/task-types/task-type-1/worker-contract',
    '/v1/projects/project-1/worker-tokens',
    '/v1/projects/project-1/jobs',
    '/v1/projects/project-1/jobs/job-1',
    '/v1/projects/project-1/jobs/job-1/events',
    '/v1/projects/project-1/jobs/job-1/logs',
  ]) {
    if (!serviceHost.state.services.some((call) => call.path === expected)) {
      throw new Error(`Expected Core path ${expected} to be called.`);
    }
  }

  const mockJobBody = serviceRequests.find(
    (call) => call.method === 'POST' && call.path === '/v1/projects/project-1/jobs'
  )?.body;
  if (mockJobBody?.task_key !== 'demo.echo') {
    throw new Error('Mock job must be created for the contract task key.');
  }
});

function requestBody(request: { body?: unknown }): Record<string, unknown> {
  return request.body && typeof request.body === 'object'
    ? (request.body as Record<string, unknown>)
    : {};
}

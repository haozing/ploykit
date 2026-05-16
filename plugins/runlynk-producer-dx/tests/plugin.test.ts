import { Permission } from '@ploykit/plugin-sdk';
import {
  createPluginTestHost,
  createPluginTestHostStore,
  testPlugin,
  type PluginTestServiceHandler,
} from '@ploykit/plugin-sdk/testing';
import integrationApi from '../api/integration';
import producerKeysApi from '../api/producer-keys';
import projectsApi from '../api/projects';
import taskTypesApi from '../api/task-types';
import { generateProducerPrompt, generateProducerSnippet } from '../lib/generators';
import plugin from '../plugin';
import ProducerDxHome from '../pages/ProducerDxHome';
import ProducerIntegrationPage from '../pages/ProducerIntegrationPage';

const contract = {
  contract_version: 'runlynk.worker.v1',
  project_id: 'project-1',
  task_type_id: 'task-type-1',
  task_key: 'demo.echo',
  name: 'Demo Echo',
  description: '',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  producer_enabled: true,
  callbacks_enabled: true,
  allow_encrypted_payload: false,
  allow_encrypted_result: false,
  mock_input: { message: 'hello from producer dx' },
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
          producer_enabled: true,
          callbacks_enabled: true,
        },
      ],
    });
  }
  if (
    request.method === 'GET' &&
    request.path === '/v1/projects/project-1/task-types/task-type-1/worker-contract'
  ) {
    return Response.json(contract);
  }
  if (request.method === 'GET' && request.path === '/v1/projects/project-1/producer-keys') {
    return Response.json({
      producer_keys: [
        {
          id: 'producer-key-1',
          project_id: 'project-1',
          name: 'Existing Producer',
          scopes: ['jobs:create'],
          rate_limit_per_minute: 60,
          status: 'active',
        },
      ],
    });
  }
  if (request.method === 'POST' && request.path === '/v1/projects/project-1/producer-keys') {
    return Response.json(
      {
        id: 'producer-key-2',
        project_id: 'project-1',
        name: requestBody(request).name,
        key: 'rlpk_plaintext',
        scopes: requestBody(request).scopes,
        rate_limit_per_minute: requestBody(request).rate_limit_per_minute,
        status: 'active',
      },
      { status: 201 }
    );
  }
  return Response.json({ message: `unexpected Core path ${request.path}` }, { status: 404 });
};

export default testPlugin(plugin, async ({ plugin }) => {
  if (plugin.id !== 'runlynk-producer-dx') {
    throw new Error('Plugin id must stay aligned with the directory name.');
  }
  if (!plugin.permissions?.includes(Permission.ServicesInvoke)) {
    throw new Error('Producer DX must call RunLynk Core through internal services.');
  }
  if (plugin.egress?.length) {
    throw new Error('Producer DX must not use external egress.');
  }
  if (!plugin.services?.some((service) => service.name === 'runlynk-core' && service.actorClaims)) {
    throw new Error(
      'Producer DX must declare the RunLynk Core internal service with actor claims.'
    );
  }

  for (const [name, component] of Object.entries({
    ProducerDxHome,
    ProducerIntegrationPage,
  })) {
    if (typeof component !== 'function') {
      throw new Error(`${name} page must be importable.`);
    }
  }

  const snippet = generateProducerSnippet({
    projectId: 'project-1',
    contract,
    language: 'typescript',
  });
  if (!snippet.includes('/v1/projects/project-1/tasks/demo.echo/jobs')) {
    throw new Error('Producer snippet must include the create-job endpoint.');
  }
  if (
    !generateProducerPrompt({ projectId: 'project-1', contract, language: 'typescript' }).includes(
      'Producer API'
    )
  ) {
    throw new Error('Producer prompt must include API context.');
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
    url: 'https://ploykit.test/api/plugins/runlynk-producer-dx/projects',
  });
  await projectsApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'GET',
    url: 'https://ploykit.test/api/plugins/runlynk-producer-dx/projects/project-1/task-types',
    params: { projectId: 'project-1' },
  });
  await taskTypesApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'GET',
    url: 'https://ploykit.test/api/plugins/runlynk-producer-dx/projects/project-1/producer-keys',
    params: { projectId: 'project-1' },
  });
  await producerKeysApi.get?.(ctx);

  serviceHost.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/api/plugins/runlynk-producer-dx/projects/project-1/producer-keys',
    params: { projectId: 'project-1' },
    json: { name: 'Created By Test', rate_limit_per_minute: 30 },
  });
  await producerKeysApi.post?.(ctx);

  serviceHost.setRequest({
    method: 'POST',
    url: 'https://ploykit.test/api/plugins/runlynk-producer-dx/projects/project-1/task-types/task-type-1/integration',
    params: { projectId: 'project-1', taskTypeId: 'task-type-1' },
    json: { language: 'python' },
  });
  await integrationApi.post?.(ctx);

  for (const expected of [
    '/v1/projects/project-1',
    '/v1/projects/project-1/task-types',
    '/v1/projects/project-1/producer-keys',
    '/v1/projects/project-1/task-types/task-type-1/worker-contract',
  ]) {
    if (!serviceHost.state.services.some((call) => call.path === expected)) {
      throw new Error(`Expected Core path ${expected} to be called.`);
    }
  }

  const keyBody = serviceRequests.find(
    (call) => call.method === 'POST' && call.path === '/v1/projects/project-1/producer-keys'
  )?.body;
  if (!Array.isArray(keyBody?.scopes) || !keyBody.scopes.includes('jobs:create')) {
    throw new Error('Producer key must be created with producer job scopes.');
  }
});

function requestBody(request: { body?: unknown }): Record<string, unknown> {
  return request.body && typeof request.body === 'object'
    ? (request.body as Record<string, unknown>)
    : {};
}

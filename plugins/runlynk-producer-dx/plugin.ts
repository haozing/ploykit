import { definePlugin, Permission } from '@ploykit/plugin-sdk';

const producerDxPermissions = [
  Permission.WorkspaceRead,
  Permission.ResourceBindingsRead,
  Permission.ResourceBindingsWrite,
  Permission.ServicesInvoke,
  Permission.AuditWrite,
  Permission.UsageWrite,
  Permission.NavigationExtend,
] as const;

export default definePlugin({
  id: 'runlynk-producer-dx',
  name: 'RunLynk Producer DX',
  version: '0.1.0',
  description:
    'Producer API keys, integration snippets, prompts, and callback signing guides for RunLynk.',
  kind: 'app',
  trustLevel: 'trusted',
  permissions: producerDxPermissions,
  resourceBindings: [
    {
      type: 'project',
      scope: 'workspace',
      owner: 'suite',
      visibility: 'suite',
      cardinality: 'one',
      permissions: {
        read: ['owner', 'admin', 'editor', 'viewer'],
        write: ['owner', 'admin'],
      },
    },
  ],
  services: [
    {
      name: 'runlynk-core',
      methods: ['GET', 'POST'],
      paths: [
        '/v1/projects',
        '/v1/projects/:projectId',
        '/v1/projects/:projectId/task-types',
        '/v1/projects/:projectId/task-types/:taskTypeId/worker-contract',
        '/v1/projects/:projectId/producer-keys',
      ],
      actorClaims: true,
    },
  ],
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/ProducerDxHome',
        auth: 'auth',
        layout: 'dashboard',
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/integration',
        component: './pages/ProducerIntegrationPage',
        auth: 'auth',
        layout: 'dashboard',
      },
    ],
    apis: [
      {
        path: '/projects',
        handler: './api/projects',
        auth: 'auth',
        methods: ['GET'],
        permissions: producerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types',
        handler: './api/task-types',
        auth: 'auth',
        methods: ['GET'],
        permissions: producerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/integration',
        handler: './api/integration',
        auth: 'auth',
        methods: ['POST'],
        permissions: producerDxPermissions,
      },
      {
        path: '/projects/:projectId/producer-keys',
        handler: './api/producer-keys',
        auth: 'auth',
        methods: ['GET', 'POST'],
        permissions: producerDxPermissions,
      },
    ],
  },
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
  },
  menu: {
    location: 'dashboard.sidebar',
    labelKey: 'menu.producerDx',
    fallbackLabel: 'Producer DX',
    icon: 'Send',
    path: '/',
    group: 'runlynk',
    groupKey: 'menu.groups.apps',
    fallbackGroup: 'Apps',
    weight: 12,
    visibility: 'signedIn',
    requires: {
      servicesBound: ['runlynk-core'],
      resourceBindings: ['project'],
    },
  },
});

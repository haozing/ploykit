import { definePlugin, Permission } from '@ploykit/plugin-sdk';

const workerDxPermissions = [
  Permission.WorkspaceRead,
  Permission.ResourceBindingsRead,
  Permission.ResourceBindingsWrite,
  Permission.ServicesInvoke,
  Permission.AuditWrite,
  Permission.UsageWrite,
  Permission.NavigationExtend,
] as const;

export default definePlugin({
  id: 'runlynk-worker-dx',
  name: 'RunLynk Worker DX',
  version: '0.1.0',
  description: 'Worker contract, starter, prompt, and validator tools for RunLynk.',
  kind: 'app',
  trustLevel: 'trusted',
  permissions: workerDxPermissions,
  resourceBindings: [
    {
      type: 'project',
      scope: 'workspace',
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
        '/v1/projects/:projectId/jobs',
        '/v1/projects/:projectId/jobs/:jobId',
        '/v1/projects/:projectId/jobs/:jobId/events',
        '/v1/projects/:projectId/jobs/:jobId/logs',
        '/v1/projects/:projectId/worker-tokens',
      ],
      actorClaims: true,
    },
  ],
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/WorkerDxHome',
        auth: 'auth',
        layout: 'dashboard',
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/contract',
        component: './pages/WorkerContractPage',
        auth: 'auth',
        layout: 'dashboard',
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/starter',
        component: './pages/WorkerStarterPage',
        auth: 'auth',
        layout: 'dashboard',
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/validator',
        component: './pages/WorkerValidatorPage',
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
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types',
        handler: './api/task-types',
        auth: 'auth',
        methods: ['GET'],
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/contract',
        handler: './api/worker-contract',
        auth: 'auth',
        methods: ['GET'],
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/starter',
        handler: './api/starter',
        auth: 'auth',
        methods: ['POST'],
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/prompt',
        handler: './api/prompt',
        auth: 'auth',
        methods: ['POST'],
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/task-types/:taskTypeId/mock-job',
        handler: './api/mock-job',
        auth: 'auth',
        methods: ['POST'],
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/jobs/:jobId/validator',
        handler: './api/validator',
        auth: 'auth',
        methods: ['GET'],
        permissions: workerDxPermissions,
      },
      {
        path: '/projects/:projectId/jobs/:jobId/fix-prompt',
        handler: './api/fix-prompt',
        auth: 'auth',
        methods: ['POST'],
        permissions: workerDxPermissions,
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
    labelKey: 'menu.workerDx',
    fallbackLabel: 'Worker DX',
    icon: 'Code2',
    path: '/',
    group: 'runlynk',
    groupKey: 'menu.groups.apps',
    fallbackGroup: 'Apps',
    weight: 11,
  },
});

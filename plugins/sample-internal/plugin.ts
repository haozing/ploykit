import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'sample-internal',
  name: 'Sample Internal',
  version: '0.1.0',
  description: 'Internal sample plugin used to verify the plugin runtime path.',
  kind: 'app',
  trustLevel: 'trusted',
  permissions: [
    Permission.StorageRead,
    Permission.StorageWrite,
    Permission.UiToast,
    Permission.ResourceBindingsRead,
    Permission.ResourceBindingsWrite,
    Permission.ServicesInvoke,
  ],
  resourceBindings: [
    {
      type: 'project',
      scope: 'workspace',
      cardinality: 'one',
    },
  ],
  services: [
    {
      name: 'core-api',
      methods: ['GET'],
      paths: ['/v1/projects/:projectId'],
    },
  ],
  data: {
    collections: {
      sample_internal_notes: {
        fields: {
          title: { type: 'string', required: true, maxLength: 120 },
          status: { type: 'string', required: true, enum: ['open', 'done'] },
          body: 'text?',
        },
        indexes: [{ fields: ['status'] }],
      },
    },
  },
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/SamplePage',
        auth: 'auth',
        layout: 'dashboard',
      },
      {
        path: '/',
        component: './pages/SamplePage',
        auth: 'admin',
        layout: 'dashboard-admin',
      },
    ],
    apis: [
      {
        path: '/notes/:projectId',
        handler: './api/notes',
        auth: 'auth',
        methods: ['GET', 'POST'],
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    label: 'Sample Internal',
    icon: 'ListChecks',
    path: '/',
    group: 'Plugins',
    weight: 50,
  },
});

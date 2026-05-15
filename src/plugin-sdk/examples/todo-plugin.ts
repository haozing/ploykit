import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export const todoPlugin = definePlugin({
  id: 'todo',
  name: 'Todo',
  version: '1.0.0',
  kind: 'app',
  permissions: [
    Permission.StorageRead,
    Permission.StorageWrite,
    Permission.FilesRead,
    Permission.EventsEmit,
    Permission.EventsSubscribe,
    Permission.JobsEnqueue,
    Permission.JobsRegister,
    Permission.WebhookReceive,
    Permission.AuditWrite,
    Permission.UsageWrite,
    Permission.UiToast,
  ],
  data: {
    collections: {
      todos: {
        fields: {
          title: { type: 'string', required: true, maxLength: 120 },
          description: 'text?',
          completed: { type: 'boolean', default: false },
          due_at: 'datetime?',
          priority: { type: 'integer', default: 0 },
        },
        indexes: [{ fields: ['completed', 'due_at'] }, { fields: ['priority'], order: 'desc' }],
      },
    },
  },
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/TodoPage',
        layout: 'dashboard',
        auth: 'auth',
      },
    ],
    apis: [
      {
        path: '/todos',
        handler: './api/todos',
        methods: ['GET', 'POST'],
        auth: 'auth',
      },
      {
        path: '/todos/:id',
        handler: './api/todo-detail',
        methods: ['PATCH', 'DELETE'],
        auth: 'auth',
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    labelKey: 'menu.label',
    fallbackLabel: 'Todo',
    icon: 'CheckSquare',
    path: '/',
  },
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
    assets: ['./assets/icon.png'],
  },
  config: {
    defaults: {
      defaultPriority: 0,
    },
    component: './config/TodoSettings',
  },
  events: {
    publishes: ['todo.created', 'todo.completed'],
    subscribes: {
      'platform.user.deleted': './events/user-deleted',
    },
  },
  jobs: {
    'todo.cleanup': {
      handler: './jobs/cleanup',
      schedule: '0 0 * * *',
      timeoutMs: 30_000,
      retries: 3,
    },
  },
  webhooks: {
    import: {
      path: '/webhooks/import',
      handler: './webhooks/import',
      methods: ['POST'],
      signature: 'hmac-sha256',
    },
  },
  lifecycle: {
    install: './lifecycle/install',
    enable: './lifecycle/enable',
  },
});

export default todoPlugin;

import { defineModule, jsonb, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  id: 'hello',
  name: 'Hello Module',
  contractVersion: 1,
  version: '0.1.0',
  description: 'Minimal module used to verify the v2 local module runtime skeleton.',
  permissions: [
    Permission.DataDocumentRead,
    Permission.DataDocumentWrite,
    Permission.DataTableRead,
    Permission.DataTableWrite,
    Permission.ArtifactsWrite,
    Permission.AuditWrite,
    Permission.EventsEmit,
    Permission.EventsSubscribe,
    Permission.FilesWrite,
    Permission.JobsRegister,
    Permission.NotificationsSend,
    Permission.SurfaceContribute,
    Permission.WebhookReceive,
  ],
  data: {
    version: 1,
    documents: {
      hello_messages: {
        scope: 'user',
        fields: {
          message: { type: 'string', required: true, maxLength: 200 },
        },
      },
    },
    tables: {
      hello_posts: table({
        scope: 'public-read',
        columns: {
          title: text().notNull(),
          status: text().notNull().default('draft'),
          metadata: jsonb().notNull().default({ featured: false }),
          published_at: timestamp().nullable(),
        },
        unique: [['title']],
        indexes: [['status'], ['published_at']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
  routes: {
    dashboard: [
      {
        path: '/hello',
        component: './pages/HelloPage',
        auth: 'auth',
      },
    ],
    api: [
      {
        path: '/hello',
        handler: './api/hello',
        methods: ['GET'],
        auth: 'auth',
      },
    ],
  },
  actions: {
    ping: {
      handler: './actions/ping',
      auth: 'auth',
      sideEffect: 'none',
    },
  },
  jobs: {
    say_hello: {
      handler: './jobs/say-hello',
      timeoutMs: 5000,
      retries: 1,
    },
  },
  events: {
    publishes: ['hello.greeted'],
    subscribes: {
      'hello.greeted': './events/hello-greeted',
    },
  },
  webhooks: {
    echo: {
      path: '/hello-webhook',
      handler: './webhooks/echo',
      methods: ['POST'],
      signature: 'hmac-sha256',
    },
  },
  lifecycle: {
    install: './lifecycle/install',
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: 'Hello',
    path: '/hello',
    weight: 10,
    requires: {
      entitlements: ['ploykit.demo_modules'],
    },
  },
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/HelloWidget',
      priority: 10,
      permissions: [Permission.SurfaceContribute],
    },
  },
});

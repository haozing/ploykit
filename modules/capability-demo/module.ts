import { defineModule, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  id: 'capability-demo',
  name: 'Capability Demo',
  contractVersion: 1,
  version: '0.1.0',
  description:
    'Demo product module covering public routes, Data v2, files, jobs, events, webhooks, billing, AI and RAG.',
  permissions: [
    Permission.DataTableRead,
    Permission.DataTableWrite,
    Permission.FilesRead,
    Permission.FilesWrite,
    Permission.ArtifactsWrite,
    Permission.AiGenerate,
    Permission.AiEmbed,
    Permission.RagRead,
    Permission.RagWrite,
    Permission.UsageWrite,
    Permission.AuditWrite,
    Permission.MeteringWrite,
    Permission.CreditsRead,
    Permission.CreditsConsume,
    Permission.EventsEmit,
    Permission.EventsSubscribe,
    Permission.JobsEnqueue,
    Permission.JobsRegister,
    Permission.WebhookReceive,
    Permission.NotificationsSend,
  ],
  data: {
    version: 1,
    tables: {
      demo_notes: table({
        scope: 'workspace',
        columns: {
          title: text().notNull(),
          body: text().notNull(),
          note_updated_at: timestamp().nullable(),
        },
        indexes: [['note_updated_at']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
  routes: {
    site: [
      {
        path: '/demo',
        component: './pages/PublicToolPage',
        metadata: './loaders/public-tool-metadata',
        auth: 'public',
        cache: {
          strategy: 'public',
          revalidateSeconds: 60,
          tags: ['capability-demo'],
        },
      },
    ],
    dashboard: [
      {
        path: '/capability-demo',
        component: './pages/DashboardPage',
        auth: 'auth',
        commercial: {
          credits: { amount: 1 },
        },
      },
      {
        path: '/capability-demo/workflow',
        component: './pages/JobPage',
        auth: 'auth',
      },
    ],
    api: [
      {
        path: '/capability-demo/ask',
        handler: './api/ask',
        methods: ['POST'],
        auth: 'public',
        anonymousPolicy: {
          rateLimit: {
            bucket: 'ip',
            limit: 10,
            window: '1m',
          },
          allowHighCostActions: false,
        },
        commercial: {
          credits: { amount: 1 },
        },
      },
      {
        path: '/capability-demo/workflow/status',
        handler: './api/workflow-status',
        methods: ['GET'],
        auth: 'auth',
      },
    ],
  },
  actions: {
    ask: {
      handler: './actions/ask',
      auth: 'auth',
      commercial: {
        credits: { amount: 1 },
      },
    },
    enqueueReport: {
      handler: './actions/enqueue-report',
      auth: 'auth',
      sideEffect: 'write',
      permissions: [Permission.UsageWrite],
    },
  },
  jobs: {
    reindex: {
      handler: './jobs/reindex',
      retries: 2,
      timeoutMs: 10000,
    },
    generate_report: {
      handler: './jobs/generate-report',
      timeoutMs: 15000,
      retries: 2,
    },
  },
  events: {
    publishes: ['capability-demo.indexed', 'capability-demo.reported'],
    subscribes: {
      'capability-demo.indexed': './events/indexed',
      'capability-demo.reported': './events/reported',
    },
  },
  webhooks: {
    ingest: {
      path: '/capability-demo/webhook',
      handler: './webhooks/ingest',
      methods: ['POST'],
      signature: 'hmac-sha256',
    },
    workflow: {
      path: '/capability-demo/workflow/webhook',
      handler: './webhooks/workflow-ingest',
      methods: ['POST'],
      signature: 'none',
    },
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: 'Capability Demo',
    path: '/capability-demo',
    weight: 30,
    requires: {
      entitlements: ['ploykit.demo_modules'],
    },
  },
});

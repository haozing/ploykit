import {
  api,
  booleanField,
  defineModule,
  page,
  Permission,
  schema,
  stringField,
  textField,
} from '@ploykit/module-sdk';

const pingInputSchema = schema({
  name: 'PlatformSmokePingInput',
  fields: {
    request_id: stringField(),
  },
});

const pingOutputSchema = schema({
  name: 'PlatformSmokePingOutput',
  fields: {
    ok: booleanField({ required: true }),
    module_id: stringField(),
    message: textField(),
  },
});

export default defineModule({
  id: 'platform-smoke',
  name: 'Platform Smoke',
  version: '0.1.0',
  description: 'Minimal current-contract fixture for host runtime pages, APIs, actions and workers.',
  permissions: [
    Permission.ArtifactsWrite,
    Permission.AuditWrite,
    Permission.EventsEmit,
    Permission.EventsSubscribe,
    Permission.FilesWrite,
    Permission.JobsRegister,
    Permission.NotificationsSend,
    Permission.SurfaceContribute,
    Permission.UsageWrite,
    Permission.WebhookReceive,
  ],
  pages: [
    page({
      id: 'platform-smoke.home',
      area: 'dashboard',
      path: '/platform-smoke',
      frame: 'workspace',
      component: './pages/PlatformSmokePage.tsx',
      auth: 'auth',
    }),
  ],
  apis: [
    api({
      id: 'platform-smoke.ping',
      path: '/platform-smoke/ping',
      handler: './api/ping',
      methods: ['GET'],
      input: pingInputSchema,
      output: pingOutputSchema,
      auth: 'auth',
    }),
  ],
  actions: {
    ping: {
      handler: './actions/ping',
      input: pingInputSchema,
      output: pingOutputSchema,
      auth: 'auth',
      sideEffect: 'none',
    },
  },
  jobs: {
    generate_report: {
      handler: './jobs/generate-report',
      timeoutMs: 15000,
      retries: 2,
    },
  },
  events: {
    publishes: ['platform-smoke.reported'],
    subscribes: {
      'platform-smoke.reported': './events/reported',
    },
  },
  webhooks: {
    ingest: {
      path: '/platform-smoke/webhook',
      handler: './webhooks/ingest',
      methods: ['POST'],
      signature: 'hmac-sha256',
    },
    workflow: {
      path: '/platform-smoke/workflow/webhook',
      handler: './webhooks/workflow-ingest',
      methods: ['POST'],
      signature: 'none',
    },
  },
  lifecycle: {
    install: './lifecycle/install',
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: 'Platform Smoke',
    path: '/platform-smoke',
    weight: 10,
  },
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/PlatformSmokeWidget.tsx',
      priority: 10,
      permissions: [Permission.SurfaceContribute],
    },
  },
});

import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'connector',
  name: 'Connector Template',
  version: '0.1.0',
  description: 'A connector plugin template with settings, webhooks, and background sync.',
  kind: 'connector',
  trustLevel: 'untrusted',
  permissions: [
    Permission.ConfigRead,
    Permission.ConfigWrite,
    Permission.SecretsRead,
    Permission.SecretsWrite,
    Permission.WebhookReceive,
    Permission.JobsRegister,
    Permission.EventsEmit,
    Permission.AuditWrite,
  ],
  config: {
    defaults: {
      endpoint: 'https://example.com',
    },
  },
  routes: {
    apis: [
      {
        path: '/settings',
        handler: './api/settings',
        auth: 'admin',
        methods: ['GET', 'POST'],
      },
    ],
  },
  webhooks: {
    ingest: {
      path: '/ingest',
      handler: './webhooks/ingest',
      methods: ['POST'],
      signature: 'hmac-sha256',
    },
  },
  jobs: {
    'connector.sync': {
      handler: './jobs/sync',
      timeoutMs: 30000,
      retries: 3,
    },
  },
  events: {
    publishes: ['connector.received'],
  },
});

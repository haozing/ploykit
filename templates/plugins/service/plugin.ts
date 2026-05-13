import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'service',
  name: 'Service Template',
  version: '0.1.0',
  description: 'A service plugin template for event-driven background work.',
  kind: 'service',
  trustLevel: 'untrusted',
  permissions: [
    Permission.EventsEmit,
    Permission.EventsSubscribe,
    Permission.JobsEnqueue,
    Permission.JobsRegister,
    Permission.ConfigRead,
    Permission.ConfigWrite,
    Permission.AuditWrite,
    Permission.UsageWrite,
  ],
  routes: {
    apis: [
      {
        path: '/health',
        handler: './api/health',
        auth: 'admin',
        methods: ['GET'],
      },
    ],
  },
  lifecycle: {
    enable: './lifecycle/enable',
  },
  jobs: {
    'service.worker': {
      handler: './jobs/worker',
      timeoutMs: 20000,
      retries: 2,
    },
  },
  events: {
    publishes: ['service.completed'],
    subscribes: {
      'service.requested': './events/requested',
    },
  },
});

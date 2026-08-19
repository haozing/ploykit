import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'executor-extension-smoke',
  name: 'Executor Extension Smoke',
  version: '0.1.0',
  description: 'Small host-extension fixture for trusted capability and admin operation wiring.',
  kind: 'host-extension',
  permissions: [Permission.AdminResourcesRead],
  provides: {
    capabilities: {
      executor: {
        provider: './capabilities/executor',
        description: 'Minimal executor capability used to verify host-extension mounting.',
      },
    },
    adminResources: {
      executorHealth: {
        label: 'Executor Health',
        operations: {
          read: {
            handler: './admin/executor-health.read',
            permission: Permission.AdminResourcesRead,
            risk: 'read',
            auditEvent: 'executorExtension.health.read',
          },
        },
      },
    },
  },
});

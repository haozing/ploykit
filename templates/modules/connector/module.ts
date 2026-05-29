import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [
    Permission.ConnectorsRead,
    Permission.ConnectorsInvoke,
    Permission.JobsRegister,
    Permission.FilesWrite,
  ],
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/ConnectorPage',
        auth: 'auth',
      },
    ],
  },
  jobs: {
    sync: {
      handler: './jobs/sync',
      timeoutMs: 10000,
      retries: 2,
    },
  },
});

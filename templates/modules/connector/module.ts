import { defineModule, page, Permission } from '@ploykit/module-sdk';

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
  pages: [
    page({
      id: '__MODULE_ID__.connector',
      area: 'dashboard',
      path: '/__MODULE_ID__',
      frame: 'workspace',
      component: './pages/ConnectorPage.tsx',
      auth: 'auth',
    }),
  ],
  jobs: {
    sync: {
      handler: './jobs/sync',
      timeoutMs: 10000,
      retries: 2,
    },
  },
});

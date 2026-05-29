import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [Permission.JobsRegister, Permission.ArtifactsWrite, Permission.NotificationsSend],
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/JobPage',
        auth: 'auth',
      },
    ],
  },
  actions: {
    enqueueReport: {
      handler: './actions/enqueue-report',
      auth: 'auth',
    },
  },
  jobs: {
    generate_report: {
      handler: './jobs/generate-report',
      timeoutMs: 15000,
      retries: 1,
    },
  },
});

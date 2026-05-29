import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [
    Permission.AiGenerate,
    Permission.AiEmbed,
    Permission.RagRead,
    Permission.RagWrite,
    Permission.FilesRead,
    Permission.FilesWrite,
    Permission.UsageWrite,
    Permission.MeteringWrite,
    Permission.CreditsConsume,
  ],
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/AiRagPage',
        auth: 'auth',
        commercial: {
          credits: { amount: 1 },
        },
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
  },
});

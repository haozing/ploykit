import { defineModule, Permission } from '@ploykit/module-sdk';

const anonymousPolicy = {
  rateLimit: {
    bucket: 'ip' as const,
    limit: 30,
    window: '1m' as const,
  },
  allowHighCostActions: false,
};

export default defineModule({
  id: 'public-tools-demo',
  name: 'Public Tools Demo',
  contractVersion: 1,
  version: '0.1.0',
  description: 'Public JSON, CSV, and text utility module served by the module runtime.',
  permissions: [Permission.UsageWrite, Permission.CreditsConsume],
  routes: {
    site: [
      {
        path: '/public-tools',
        component: './pages/PublicToolsPage',
        metadata: './loaders/public-tools-metadata',
        publicAliases: ['/tools/json', '/tools/csv'],
        auth: 'public',
        cache: {
          strategy: 'public',
          revalidateSeconds: 300,
          tags: ['public-tools-demo'],
        },
      },
    ],
    api: [
      {
        path: '/public-tools/format-json',
        handler: './api/format-json',
        methods: ['POST'],
        auth: 'public',
        anonymousPolicy,
      },
      {
        path: '/public-tools/csv-to-json',
        handler: './api/csv-to-json',
        methods: ['POST'],
        auth: 'public',
        anonymousPolicy,
      },
      {
        path: '/public-tools/json-to-csv',
        handler: './api/json-to-csv',
        methods: ['POST'],
        auth: 'public',
        anonymousPolicy,
      },
      {
        path: '/public-tools/text-utils',
        handler: './api/text-utils',
        methods: ['POST'],
        auth: 'public',
        anonymousPolicy,
      },
    ],
  },
  actions: {
    formatSample: {
      handler: './actions/format-sample',
      auth: 'auth',
      commercial: {
        credits: { amount: 1 },
      },
    },
  },
});

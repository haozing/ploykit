import {
  action,
  api,
  booleanField,
  defineModule,
  page,
  Permission,
  schema,
  textField,
} from '@ploykit/module-sdk';

const anonymousPolicy = {
  rateLimit: {
    bucket: 'ip' as const,
    limit: 30,
    window: '1m' as const,
  },
  allowHighCostActions: false,
};

const toolInputSchema = schema({
  name: 'PublicToolSmokeInput',
  fields: {
    source: textField({ required: true }),
  },
});

const toolOutputSchema = schema({
  name: 'PublicToolSmokeOutput',
  fields: {
    ok: booleanField({ required: true }),
    output: textField(),
  },
});

export default defineModule({
  id: 'public-tool-smoke',
  name: 'Public Tool Smoke',
  version: '0.1.0',
  description: 'Current-contract public page and anonymous API fixture.',
  permissions: [Permission.UsageWrite, Permission.CreditsConsume],
  pages: [
    page({
      id: 'public-tool-smoke.home',
      area: 'site',
      path: '/public-tool-smoke',
      frame: 'site',
      component: './pages/PublicToolPage.tsx',
      metadata: './loaders/public-tool-metadata',
      publicAliases: ['/tools/json'],
      auth: 'public',
      cache: {
        strategy: 'public',
        revalidateSeconds: 300,
        tags: ['public-tool-smoke'],
      },
    }),
  ],
  navigation: {
    location: 'site.header',
    fallbackLabel: 'JSON Tool',
    path: '/tools/json',
    weight: 30,
  },
  apis: [
    api({
      id: 'public-tool-smoke.format-json',
      path: '/public-tool-smoke/format-json',
      handler: './api/format-json',
      methods: ['POST'],
      input: toolInputSchema,
      output: toolOutputSchema,
      auth: 'public',
      anonymousPolicy,
    }),
  ],
  actions: {
    formatSample: action({
      input: toolInputSchema,
      output: toolOutputSchema,
      handler: './actions/format-sample',
      sideEffect: 'none',
      auth: 'auth',
      commercial: {
        credits: { amount: 1 },
      },
    }),
  },
});

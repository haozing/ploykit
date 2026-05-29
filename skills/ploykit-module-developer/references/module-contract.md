# PloyKit Module Contract Patterns

`module.ts` is the authoritative contract. The host scans it into the module map
and derives pages, APIs, actions, jobs, events, webhooks, surfaces, navigation,
resources, dependencies, egress, Data v2 artifacts, and lifecycle hooks.

## Minimal Shape

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'sample-tool',
  name: 'Sample Tool',
  version: '0.1.0',
  resources: {
    locales: {
      zh: './locales/zh.json',
      en: './locales/en.json',
    },
  },
  i18n: {
    defaultLanguage: 'zh',
    requiredLanguages: ['zh', 'en'],
    namespaces: ['nav'],
    strict: true,
  },
  permissions: [Permission.AuditWrite],
  routes: {
    dashboard: [
      {
        path: '/sample-tool',
        component: './pages/SampleToolPage',
        auth: 'auth',
      },
    ],
    api: [
      {
        path: '/sample-tool/run',
        handler: './api/run',
        methods: ['POST'],
        auth: 'auth',
      },
    ],
  },
  actions: {
    run: {
      handler: './actions/run',
      auth: 'auth',
    },
  },
  navigation: {
    location: 'dashboard.sidebar',
    labelKey: 'nav.sampleTool',
    fallbackLabel: 'Sample Tool',
    icon: 'WandSparkles',
    path: '/sample-tool',
    weight: 50,
  },
});
```

Navigation should render through `labelKey` and module locale resources.
`fallbackLabel` remains a required contract fallback for diagnostics, but new
modules should not rely on it as the normal UI text source.

## Data v2 Tables

Declare tables before using `ctx.data.table(...)`.

```ts
import { defineModule, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  id: 'notes',
  name: 'Notes',
  version: '0.1.0',
  permissions: [Permission.DataTableRead, Permission.DataTableWrite],
  data: {
    version: 1,
    tables: {
      notes: table({
        scope: 'workspace',
        columns: {
          title: text().notNull(),
          status: text().notNull().default('draft'),
          published_at: timestamp().nullable(),
        },
        indexes: [['status']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
});
```

Then synchronize generated artifacts:

```bash
npm run data:generate -- modules/notes
npm run data:types -- modules/notes
```

## Public APIs

Public APIs must declare explicit anonymous behavior:

```ts
{
  path: '/public/run',
  handler: './api/public-run',
  methods: ['POST'],
  auth: 'public',
  anonymousPolicy: {
    rateLimit: { bucket: ['ip', 'route'], limit: 10, window: '1m' },
    captcha: 'never',
    allowHighCostActions: false,
  },
}
```

Use `allowHighCostActions: false` for any route that could invoke AI, RAG,
commercial metering, file processing, or connector calls.

## External HTTP

Declare the permission and egress origin:

```ts
permissions: [Permission.ExternalHttp],
egress: ['https://api.example.com'],
```

Handler code should call:

```ts
const response = await ctx.http.fetch('https://api.example.com/v1/items');
```

Never call global `fetch()` from module code.

## Surfaces

Surface contribution requires a surface declaration and permission:

```ts
surfaces: {
  'dashboard.home:widgets': {
    mode: 'panel',
    component: './surfaces/SampleWidget',
    priority: 10,
    permissions: [Permission.SurfaceContribute],
  },
}
```

Use `Permission.SurfaceOverride` only for intentional host page replacement.

## White-label Presentation

White-label modules are product presentation contributors, not loose pages.
Declare their public contract in `module.ts`:

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: 'acme-site',
  name: 'Acme Site',
  version: '0.1.0',
  permissions: [Permission.SurfaceOverride, Permission.NavigationExtend, Permission.ThemeWrite],
  resources: {
    locales: {
      zh: './locales/zh.json',
      en: './locales/en.json',
    },
  },
  i18n: {
    defaultLanguage: 'zh',
    requiredLanguages: ['zh', 'en'],
    namespaces: ['nav', 'pages', 'seo'],
    strict: true,
  },
  presentation: {
    whiteLabel: true,
    replaces: ['host.page:site.home'],
    seoNamespaces: ['seo'],
    themeScope: 'site',
  },
  theme: {
    tokens: {
      colorPrimary: '#2563eb',
      radiusControl: '8px',
    },
  },
  surfaces: {
    'host.page:site.home': {
      mode: 'replace',
      component: './surfaces/HomePage',
      loader: './loaders/home-meta',
      permissions: [Permission.SurfaceOverride],
    },
  },
});
```

The loader should return `definePagePresentation(...)` with shell, SEO, cache,
i18n, and optional theme metadata. Visible copy belongs in locale JSON files.

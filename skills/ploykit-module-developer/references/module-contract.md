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

## Privileged Service Requirements

Use `serviceRequirements` for services that need secrets, runtime signing,
dynamic claims, private network access, or strong audit. Module code should call
one module-local service client, not scatter raw `ctx.services.invoke(...)`
calls across pages, loaders, and actions.

```ts
import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  contractVersion: 2,
  id: 'service-console',
  name: 'Service Console',
  version: '0.1.0',
  permissions: [Permission.ServicesInvoke, Permission.AuditWrite],
  serviceRequirements: {
    serviceCore: {
      required: true,
      provider: 'service-core',
      kind: 'signed-http',
      connection: {
        baseUrl: 'https://core.example.com',
        egress: ['https://core.example.com'],
        timeoutMs: 8000,
      },
      secrets: {
        bearerToken: { required: true },
        hmacSecret: { required: true },
      },
      claims: {
        requestId: '${ctx.request.id}',
        correlationId: '${ctx.request.correlationId}',
        actorId: '${ctx.auth.actorId}',
        workspaceId: '${ctx.scope.workspaceId}',
        tenantId: '${input.tenantId}',
        moduleId: '${ctx.module.id}',
      },
      operations: {
        request: {
          input: { allow: ['path', 'method', 'query', 'json', 'tenantId'] },
          auth: { type: 'bearer', secret: 'bearerToken' },
          signing: {
            type: 'hmac-sha256',
            secret: 'hmacSecret',
            header: 'x-service-signature',
            timestampHeader: 'x-service-timestamp',
            claimsHeader: 'x-service-claims',
          },
          request: {
            body: 'json',
            allowHeaders: ['content-type', 'idempotency-key', 'x-request-id'],
            denyHeaders: ['authorization', 'cookie'],
          },
          response: { body: 'json', maxBytes: 1048576 },
          audit: { event: 'service.core.requested' },
        },
      },
    },
  },
});
```

For service-backed modules, use OpenAPI or an equivalent machine contract as the
source for endpoint/schema/error shape. Generate or maintain contract/fixture
mocks for development, but keep live smoke evidence for signing, tenant,
idempotency, quota, one-time token, lease/retry, and state-machine behavior.

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

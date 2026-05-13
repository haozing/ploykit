# PloyKit Plugin Contract Patterns

`plugin.ts` is the authoritative contract. The host scans it into the runtime
plugin map and derives routes, capabilities, storage, menu entries, jobs,
events, webhooks, assets, and lifecycle hooks from it.

## Minimal Shape

```ts
import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'sample-tool',
  name: 'Sample Tool',
  version: '0.1.0',
  kind: 'tool',
  trustLevel: 'untrusted',
  permissions: [Permission.AuditWrite, Permission.UsageWrite, Permission.UiToast],
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/ToolPage',
        auth: 'auth',
        layout: 'dashboard',
      },
    ],
    apis: [
      {
        path: '/run',
        handler: './api/run',
        auth: 'auth',
        methods: ['POST'],
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    label: 'Sample Tool',
    icon: 'WandSparkles',
    path: '/',
    group: 'Tools',
    weight: 50,
  },
});
```

## Structured Storage

Declare collections before using `ctx.storage`.

```ts
data: {
  collections: {
    sample_items: {
      fields: {
        title: { type: 'string', required: true, maxLength: 160 },
        status: { type: 'string', required: true, enum: ['draft', 'active'] },
        metadata: 'json?',
      },
      indexes: [{ fields: ['status'] }],
    },
  },
}
```

Also declare `Permission.StorageRead` and/or `Permission.StorageWrite` when the
code uses the collection.

## Public APIs And Tools

Public APIs and public tool routes must include explicit anonymous behavior.

```ts
anonymousPolicy: {
  rateLimit: { bucket: ['ip', 'route'], limit: 10, window: '1m' },
  captcha: 'never',
  allowHighCostActions: false,
}
```

Public tool pages should include SEO, sitemap, cache, and canonical metadata.

## External HTTP

External HTTP must go through the host egress guard:

```ts
permissions: [Permission.ExternalHttp],
egress: ['https://api.example.com'],
```

Handler code should call:

```ts
const response = await ctx.http.fetch('https://api.example.com/v1/items');
```

Do not call raw external `fetch()` from plugin code.

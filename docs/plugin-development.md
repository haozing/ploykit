# Plugin Development

Plugins live under `plugins/<plugin-id>/`. The contract file is the only required
entry point, and the host derives runtime loading from that contract.

```text
plugins/<plugin-id>/
|-- plugin.ts
|-- pages/
|-- api/
|-- lifecycle/
|-- jobs/
|-- events/
|-- webhooks/
|-- assets/
`-- tests/
```

## Contract Entry

`plugin.ts` is the contract. The host scans plugin contracts with
`scripts/generate-plugin-map.ts`, writes `src/lib/plugin-map.ts`, and loads
runtime pages, APIs, jobs, events, webhooks, lifecycle handlers, slots, menus,
assets, and capabilities from that generated map.

Minimal plugin:

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

## Public Tool Pages

Public tool pages can declare SEO, sitemap, cache, alias, rate limit, and
anonymous policy metadata:

```ts
export default definePlugin({
  id: 'json-tools',
  name: 'JSON Tools',
  version: '0.1.0',
  kind: 'tool',
  routes: {
    tools: [
      {
        path: '/json-format',
        component: './pages/JsonFormatTool',
        auth: 'public',
        seo: {
          title: 'JSON Formatter',
          description: 'Format JSON in your browser.',
          canonical: '/tools/json-format',
          robots: { index: true, follow: true },
        },
        sitemap: { include: true, changeFrequency: 'weekly', priority: 0.8 },
        cache: { strategy: 'public', maxAgeSeconds: 3600 },
        anonymousPolicy: {
          rateLimit: { bucket: ['ip', 'route'], limit: 60, window: '1m' },
          captcha: 'never',
          allowHighCostActions: false,
        },
      },
    ],
  },
});
```

## API Handlers

Plugin API handlers use lowercase method names:

```ts
import { defineApi, z } from '@ploykit/plugin-sdk';

const inputSchema = z.object({
  title: z.string().min(1),
});

export default defineApi({
  async post(ctx) {
    const input = await ctx.request.json(inputSchema);
    await ctx.audit.record('sample-tool.run', input);
    await ctx.usage.increment('sample_tool.runs');
    return ctx.json({ ok: true });
  },
});
```

## Structured Storage

Plugins with structured storage declare collections in the contract and request
storage permissions:

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

Then access storage through `ctx`:

```ts
const items = await ctx.storage.collection('sample_items').findMany({
  orderBy: { title: 'asc' },
  limit: 50,
});
```

## Host Capabilities

Plugins should treat `ctx` as their host boundary. They should not import
`src/lib/*`, read `process.env`, access the database directly, or call external
services through raw `fetch()`.

| Capability                               | Permissions                                              | Purpose                                                             |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `ctx.storage`                            | `StorageRead`, `StorageWrite`                            | Plugin-owned structured collections                                 |
| `ctx.config`, `ctx.secrets`              | `Config*`, `Secrets*`                                    | Plugin config and encrypted secrets                                 |
| `ctx.files`                              | `FilesRead`, `FilesWrite`                                | Signed upload/download and file metadata                            |
| `ctx.runs`                               | `RunsRead`, `RunsWrite`                                  | User-visible or internal long-running work                          |
| `ctx.connectors`                         | `ConnectorsRead`, `ConnectorsInvoke`, `ConnectorsManage` | External service profiles, credentials, retry, redaction, call logs |
| `ctx.workspace`                          | `WorkspaceRead`, `WorkspaceWrite`                        | Workspace creation, membership, roles, invitations                  |
| `ctx.apiKeys`, `ctx.rateLimit`           | `ApiKeys*`, `RateLimitCheck`                             | Plugin API keys and scoped rate limits                              |
| `ctx.metering`, `ctx.usage`, `ctx.audit` | `MeteringWrite`, `UsageWrite`, `AuditWrite`              | Usage, action meters, audit trail                                   |
| `ctx.artifacts`, `ctx.rag`               | `Artifacts*`, `Rag*`                                     | Text artifacts, indexing, context packs                             |
| `ctx.ai`                                 | `AiGenerate`, `AiEmbed`                                  | Host-injected model gateway                                         |
| `ctx.credits`, `ctx.billing`             | `Credits*`, `Billing*`                                   | Commercial entitlements, credits, redemption                        |
| `ctx.notifications`                      | `NotificationsSend`                                      | In-app notifications                                                |
| `ctx.http.fetch`                         | `ExternalHttp` plus `egress`                             | External HTTP through SSRF-aware guard                              |

Example egress declaration:

```ts
export default definePlugin({
  id: 'seo-checker',
  name: 'SEO Checker',
  version: '0.1.0',
  permissions: [Permission.ExternalHttp],
  egress: ['https://example.com'],
});

const response = await ctx.http.fetch('https://example.com/', {
  method: 'GET',
});
```

The host egress guard rejects localhost, private networks, link-local addresses,
metadata hosts, multicast targets, and DNS resolutions that point to those
ranges.

## Public API Policy

Public plugin APIs must declare `anonymousPolicy`. Anonymous requests are not
allowed to trigger high-cost work unless the route explicitly opts in.

High-cost work includes:

- AI generation or embedding
- connector calls
- file uploads
- run creation

Example:

```ts
anonymousPolicy: {
  rateLimit: { bucket: ['ip', 'route'], limit: 10, window: '1m' },
  maxUploadBytes: 5 * 1024 * 1024,
  captcha: 'always',
  allowHighCostActions: true,
}
```

## Tooling

```bash
npm run plugins:scan
npm run plugins:check
npm run plugins:templates
npm run plugin:create -- my-plugin --template crud
npm run plugin:check -- plugins/my-plugin
npm run plugin:test -- plugins/my-plugin
npm run plugin:build -- plugins/my-plugin
npm run plugin:inspect -- plugins/my-plugin
npm run plugin:dev -- plugins/my-plugin --watch
```

# Plugin Development

Plugins normally live under `plugins/<plugin-id>/`. The contract file is the
only required entry point, and the host derives runtime loading from that
contract.

```text
plugins/<plugin-id>/
|-- plugin.ts
|-- plugin.dependencies.json
|-- pages/
|-- api/
|-- components/
|-- slots/
|-- lifecycle/
|-- jobs/
|-- events/
|-- webhooks/
|-- locales/
|-- assets/
`-- tests/
```

External plugin source directories are supported for local development and
self-hosted deployments. Set `PLOYKIT_PLUGIN_DIRS` to one or more extra
directories, separated by semicolons or commas:

```bash
PLOYKIT_PLUGIN_DIRS="../my-ploykit-plugins;D:/shared/ploykit-plugins" npm run plugins:scan
```

PowerShell:

```powershell
$env:PLOYKIT_PLUGIN_DIRS = 'D:\work\ploykit-plugins;..\shared-plugins'
npm run plugins:scan
```

Each external source can either be a directory containing plugin subdirectories
or a direct plugin root containing `plugin.ts`. The default `plugins/` directory
is always scanned as well. After changing the value, rerun `npm run
plugins:scan`. The committed `src/lib/plugin-map.ts` tracks the default
`plugins/` tree; external plugin entries are written to the runtime artifact
`.runtime/plugin-map.ts` by default, or to `PLOYKIT_PLUGIN_MAP_FILE` when set.
Product shells that only need runtime artifacts can run
`npm run plugins:scan:runtime`; that command updates the active runtime map
without touching the committed default map.

Run `npm run plugins:check` to validate every configured source directory, or a
targeted check such as `npm run plugin:doctor -- ../my-ploykit-plugins/invoices`.
On Windows, external plugin modules must be on the same drive as the project
because the generated map uses relative static imports; use a symlink or junction
inside the project when the plugin source lives elsewhere.

`plugin:test` and `plugin:doctor` create a temporary dependency bridge for
external plugin roots, so tests can resolve host dependencies such as React from
the PloyKit install without copying the plugin or installing per-plugin
dependencies. Use `--dependency-root <host-root>` when the dependency root is
not the PloyKit project root.

For standalone deployments, the configured external directories must be present
at the same relative paths used during build, or mounted into the runtime
environment. External source directories inside the project are copied by the
standalone asset script; directories outside the project should be mounted.

## Contract Entry

`plugin.ts` is the contract. The host scans plugin contracts from `plugins/`
and `PLOYKIT_PLUGIN_DIRS` with `scripts/generate-plugin-map.ts`, writes the
default map to `src/lib/plugin-map.ts`, writes external entries to the active
runtime map, and loads runtime pages, APIs, jobs, events, webhooks, lifecycle
handlers, slots, menus, assets, and capabilities from those generated maps.
Use `--runtime-only` or `npm run plugins:scan:runtime` when a product shell
should prepare only `.runtime/plugin-map.*`.

The generated map is a module index only. It does not assign plugins to
products, suites, or bundles; those runtime placement decisions live in
installation/catalog state. External products can provide that placement with
`PLOYKIT_RUNTIME_CATALOG_FILE` or `plugins:apply -- --catalog <file>`.
`plugins:apply` automatically prepares the runtime map only when plugin source
inputs such as `PLOYKIT_PLUGIN_DIRS` are present; `PLOYKIT_PLUGIN_MAP_FILE`
only selects the active runtime map artifact path.

For plugins that need to extend or override host-owned pages such as the home,
about, or pricing pages, see [host page slots and overrides](host-page-overrides.md).

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

## External npm Dependencies

Plugins may import npm packages that the host has installed and declared as
runtime dependencies, such as UI component libraries, charting libraries, and
flow editors. Plugins do not run install scripts themselves and should not rely
on accidental transitive dependencies.

Declare plugin-owned npm imports in `plugin.dependencies.json` at the plugin
root:

```json
{
  "dependencies": {
    "@xyflow/react": "^12.10.2",
    "recharts": "^3.8.1"
  }
}
```

Then import them from plugin code:

```tsx
import { ReactFlow } from '@xyflow/react';
```

The host must also list those packages in the repository root `package.json`
`dependencies` or `optionalDependencies` and run `npm install`. `plugin:doctor`
rejects these cases:

- `plugin.dependencies.json` is not valid JSON.
- The plugin declares a dependency that the host has not installed.
- The package resolves, but only as a dev or transitive dependency rather than a
  host runtime dependency.

`react`, `react-dom`, `@ploykit/plugin-sdk`, `@ploykit/plugin-sdk/react`, and
`@ploykit/plugin-sdk/testing` are base imports allowed by the host and do not
need to be listed in `plugin.dependencies.json`.

If a dependency is really a model provider, database driver, credentialed
external service, or complex domain ability, prefer exposing it as `ctx.ai`,
`ctx.services`, `ctx.connectors`, or another host capability. The plugin should
consume that capability through `ctx.*` instead of pulling the package directly
into plugin runtime code.

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

For database-shaped work beyond plugin-owned records, expose a host service and
call it through `ctx.services`; ordinary plugins do not access the database
directly.

## Host Capabilities

Plugins should treat `ctx` as their host boundary. They should not import
`src/lib/*`, read `process.env`, access the database directly, or call external
services through raw `fetch()`.

| Capability                               | Permissions                                              | Purpose                                                              |
| ---------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| `ctx.storage`                            | `StorageRead`, `StorageWrite`                            | Plugin-owned structured collections                                  |
| `ctx.config`, `ctx.secrets`              | `Config*`, `Secrets*`                                    | Plugin config and encrypted secrets                                  |
| `ctx.files`                              | `FilesRead`, `FilesWrite`                                | Signed upload/download and file metadata                             |
| `ctx.runs`                               | `RunsRead`, `RunsWrite`                                  | User-visible or internal long-running work                           |
| `ctx.connectors`                         | `ConnectorsRead`, `ConnectorsInvoke`, `ConnectorsManage` | External service profiles, credentials, retry, redaction, call logs  |
| `ctx.services`                           | `ServicesInvoke`                                         | Host-managed service connections for complex domain or database work |
| `ctx.workspace`                          | `WorkspaceRead`, `WorkspaceWrite`                        | Workspace creation, membership, roles, invitations                   |
| `ctx.apiKeys`, `ctx.rateLimit`           | `ApiKeys*`, `RateLimitCheck`                             | Plugin API keys and scoped rate limits                               |
| `ctx.metering`, `ctx.usage`, `ctx.audit` | `MeteringWrite`, `UsageWrite`, `AuditWrite`              | Usage, action meters, audit trail                                    |
| `ctx.artifacts`, `ctx.rag`               | `Artifacts*`, `Rag*`                                     | Text artifacts, indexing, context packs                              |
| `ctx.ai`                                 | `AiGenerate`, `AiEmbed`                                  | Host-injected model gateway                                          |
| `ctx.credits`, `ctx.billing`             | `Credits*`, `Billing*`                                   | Commercial entitlements, credits, redemption                         |
| `ctx.notifications`                      | `NotificationsSend`                                      | In-app notifications                                                 |
| `ctx.http.fetch`                         | `ExternalHttp` plus `egress`                             | External HTTP through SSRF-aware guard                               |

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

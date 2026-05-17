# PloyKit

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

PloyKit is a pluggable SaaS and public tool-site host built on Next.js App Router.
It combines a product shell, admin console, billing boundaries, file storage,
auditability, and a local plugin runtime whose contract entry is `plugin.ts`.

The project is designed for teams that want to ship many small SaaS tools,
internal tools, or product plugins without letting every feature reinvent auth,
storage, billing, routing, and operational boundaries.

![PloyKit social preview](public/media/social/github-preview.png)

## Highlights

- Next.js App Router application with `zh` and `en` locales.
- Better Auth email/password auth, optional OAuth hooks, password reset flow,
  profile APIs, and avatar APIs.
- RBAC, admin console, user management, roles, permissions, system settings,
  audit logs, and analytics pages.
- Entitlement plans, user subscriptions, credits, billing records, Stripe
  checkout, and webhook handling boundaries.
- Platform file APIs plus plugin file uploads and downloads through signed URLs.
- Local plugin runtime with page, API, webhook, job, event, lifecycle, menu,
  slot, asset, and capability adapters.
- Public tool pages with SEO metadata, sitemap entries, route aliases,
  anonymous policies, rate limits, captcha hooks, cache policy, and SSRF-aware
  egress controls.
- Verification scripts for code quality, plugin contracts, database migrations,
  runtime checks, E2E flows, accessibility, storage, Stripe, observability,
  upgrades, capacity, soak, backup/restore, security audit, chaos, and delivery
  documentation.

## Preview

| Admin dashboard                                                  | Plugin dev console                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ![Admin dashboard](public/media/screenshots/dashboard-admin.png) | ![Plugin dev console](public/media/screenshots/plugin-dev-console.png) |

| Public plugin tool                                                 | AI plugin workflow                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| ![Public JSON tool](public/media/screenshots/public-json-tool.png) | ![AI plugin workflow](public/media/screenshots/ai-plugin-workflow.png) |

| Plugin management                                                    | Runtime sample                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ![Plugin management](public/media/screenshots/plugin-management.png) | ![Plugin runtime sample](public/media/screenshots/plugin-runtime-sample.png) |

## Design Philosophy

PloyKit follows a small set of development conventions. They are not only style
preferences; they are the guardrails that keep the host extensible as plugin
capability grows.

```text
few entry points
strong declarations
hard boundaries
clear capabilities
precise errors
stable tests
```

In practice:

- A simple plugin can declare one page or one API. Advanced plugins opt into
  files, runs, connectors, metering, AI, billing, jobs, events, and webhooks only
  when needed.
- `plugins/<plugin-id>/plugin.ts` is the authoritative declaration for metadata,
  routes, data collections, resources, permissions, meters, lifecycle, and
  egress.
- Plugins compose host capabilities through `ctx` instead of importing host
  internals, reading process secrets, or bypassing platform policy.
- Plugin UI, APIs, jobs, events, webhooks, lifecycle hooks, and assets each have
  explicit entry shapes and runtime adapters.
- Generated maps, contract checks, migration checks, runtime checks, TypeScript,
  ESLint, Prettier, Vitest, and Playwright are routine gates.
- The same contract, template, and diagnostic loop makes PloyKit especially
  suitable for AI-assisted plugin development.

## Tech Stack

- Next.js `16.2.6`, App Router, standalone output
- React `19.2.6`
- TypeScript `6.0.3`, ESLint `10.4.0`, Prettier `3.8.3`
- Tailwind CSS `4.3.0`, Radix UI, Lucide React, Recharts `3.8.1`, Sonner
- Better Auth `1.6.11`
- PostgreSQL, Drizzle ORM `0.45.2`, Drizzle Kit `0.31.10`
- next-intl with `zh` and `en`
- Vitest, Testing Library, Playwright
- Stripe SDK `22.1.1`
- Zod `4.4.3`

## Repository Layout

```text
.
|-- src/
|   |-- app/                 # Next.js pages and route handlers
|   |-- components/          # Shared UI, layouts, admin, auth, files, plugins
|   |-- config/              # Admin menu and system-facing configuration
|   |-- contexts/            # React contexts
|   |-- hooks/               # SWR and business hooks
|   |-- i18n/                # next-intl locale config and request loader
|   |-- lib/                 # Core services, auth, DB, middleware, runtime
|   `-- plugin-sdk/          # Plugin author SDK
|-- plugins/                 # Local plugins
|-- templates/plugins/       # Plugin templates
|-- skills/                  # Optional Codex skills for plugin authors
|-- scripts/                 # Database, plugin, runtime, QA, and Stripe scripts
|-- drizzle/migrations/      # Drizzle SQL migrations
|-- locales/                 # zh/en application messages
|-- tests/e2e/               # Playwright E2E
`-- docs/                    # Detailed project documentation
```

## Brand And Media

Public assets live under `public/` and the app-facing paths are mirrored in
`site.config.ts` under `siteConfig.assets`.

- Browser icons: `public/favicon.svg`, `public/favicon.ico`, and
  `public/brand/apple-touch-icon.png`.
- Brand and social images: `public/brand/ploykit-logo.svg`,
  `public/brand/ploykit-mark.svg`, `public/brand/og-default.png`,
  `public/media/social/github-preview.png`, and
  `public/media/social/docs-preview.png`.
- Product screenshots: `public/media/screenshots/*.png`.
- Demo loop: `public/media/demo/plugin-create-doctor-loop.gif` and
  `public/media/demo/plugin-create-doctor-loop.mp4`.

Refresh generated media with:

```bash
npm run media:generate
```

## Quick Start

Prerequisites:

- Node.js `>=22 <26`
- npm `>=10`
- PostgreSQL, or Docker for the bundled local PostgreSQL service

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

For the bundled Docker database, set these values in `.env`:

```env
DB_PROVIDER=postgres
DATABASE_URL=postgresql://ploykit:ploykit@localhost:55432/ploykit
FILE_STORAGE_ENABLED=true
FILE_STORAGE_DRIVER=local
FILE_STORAGE_LOCAL_ROOT=.data/blobs
```

Start and wait for PostgreSQL:

```bash
npm run db:docker:up
npm run db:docker:wait
```

Initialize schema and seed data:

```bash
npm run db:init
```

`db:init` runs migrations and `seed:tool-site`. The seed creates a local-only
admin user:

```text
email: admin@example.com
password: Admin@123456
```

These credentials are test fixtures for local development. Do not reuse them in
a deployed environment.

Start development:

```bash
npm run dev
```

Useful local URLs:

- Home: `http://localhost:3000/zh`
- Login: `http://localhost:3000/zh/login`
- Admin console: `http://localhost:3000/zh/admin`
- Public plugin tool: `http://localhost:3000/zh/tools/json-format`
- Public alias example: `http://localhost:3000/zh/json`

## Configuration

`.env.example` is the general template. `.env.docker.example` documents the
local Docker defaults used by the `db:docker:*` scripts.

Important production-facing values include:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-with-openssl-rand-base64-32
PLUGIN_SECRET_ENCRYPTION_KEY=replace-with-a-stable-32-byte-secret
PLUGIN_FILE_SIGNING_SECRET=replace-with-a-stable-32-byte-secret
DB_PROVIDER=postgres
DATABASE_URL=postgresql://ploykit:ploykit@localhost:55432/ploykit
SUPPORTED_LANGUAGES=en,zh
```

Billing, file storage, password reset delivery, captcha, and external provider
settings are documented in the environment templates and the detailed docs.

## Common Commands

```bash
npm run dev               # Start Next.js and the plugin map watcher
npm run build             # Build the app
npm run start             # Start the standalone production server
npm run verify            # Main repository verification gate
npm run verify:runtime    # Database and runtime verification
npm run db:init           # Run migrations and seed local data
npm run plugins:scan      # Regenerate the plugin map
npm run plugins:check     # Check plugin contracts
npm run test:run          # Run Vitest
npm run test:human        # Run browser E2E flow
```

For the larger script catalog, see [scripts/README.md](scripts/README.md).

## Documentation

| Topic                          | English                                                                          | Chinese                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Documentation index            | [docs/README.md](docs/README.md)                                                 | [docs/README.zh-CN.md](docs/README.zh-CN.md)                                                 |
| Project scope                  | [docs/project-scope.md](docs/project-scope.md)                                   | [docs/project-scope.zh-CN.md](docs/project-scope.zh-CN.md)                                   |
| Plugin development             | [docs/plugin-development.md](docs/plugin-development.md)                         | [docs/plugin-development.zh-CN.md](docs/plugin-development.zh-CN.md)                         |
| AI-assisted plugin development | [docs/ai-assisted-plugin-development.md](docs/ai-assisted-plugin-development.md) | [docs/ai-assisted-plugin-development.zh-CN.md](docs/ai-assisted-plugin-development.zh-CN.md) |
| AI plugin quickstart           | [docs/ai-plugin-quickstart.md](docs/ai-plugin-quickstart.md)                     | [docs/ai-plugin-quickstart.zh-CN.md](docs/ai-plugin-quickstart.zh-CN.md)                     |
| Codex skill for plugins        | [docs/codex-skill.md](docs/codex-skill.md)                                       | [docs/codex-skill.zh-CN.md](docs/codex-skill.zh-CN.md)                                       |
| Plugin capabilities            | [docs/plugin-capabilities.md](docs/plugin-capabilities.md)                       | [docs/plugin-capabilities.zh-CN.md](docs/plugin-capabilities.zh-CN.md)                       |
| Host page slots and overrides  | [docs/host-page-overrides.md](docs/host-page-overrides.md)                       | [docs/host-page-overrides.zh-CN.md](docs/host-page-overrides.zh-CN.md)                       |
| Plugin diagnostics             | [docs/plugin-diagnostics.md](docs/plugin-diagnostics.md)                         | [docs/plugin-diagnostics.zh-CN.md](docs/plugin-diagnostics.zh-CN.md)                         |
| Database and migrations        | [docs/database-and-migrations.md](docs/database-and-migrations.md)               | [docs/database-and-migrations.zh-CN.md](docs/database-and-migrations.zh-CN.md)               |
| Routes and API surface         | [docs/routes-and-apis.md](docs/routes-and-apis.md)                               | [docs/routes-and-apis.zh-CN.md](docs/routes-and-apis.zh-CN.md)                               |

## Deployment

Build:

```bash
npm run build
```

Start the standalone server:

```bash
npm run start
```

Build a Docker image:

```bash
docker build -t ploykit .
```

Run database migrations before serving traffic:

```bash
npm run db:migrate
```

Production deployments need database credentials, app URLs, auth secrets, plugin
secret keys, file storage settings when enabled, and Stripe settings when billing
is enabled.

## License

PloyKit is released under the [MIT License](LICENSE).

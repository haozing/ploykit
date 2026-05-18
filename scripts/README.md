# Scripts

This directory contains project maintenance scripts that are intended to be
usable from a fresh checkout: database setup, plugin development, runtime
checks, release verification, and Stripe setup.

Ad hoc database inspection, one-off migration repair, and provider-specific
private smoke scripts should not live here. Keep those in a local scratch space
or in a clearly documented example package if they are useful to publish.

## Database Scripts

### `init-database.ts`

Runs the standard database initialization flow.

```bash
npm run db:init
npm run db:init:stripe
```

`db:init:stripe` also runs Stripe product setup.

### `setup-database.ts`

Checks database connectivity and applies migrations.

```bash
npm run db:setup
```

### `verify-migrations.ts`

Validates migration journal/file consistency.

```bash
npm run db:verify
```

### `seed-tool-site.ts`

Seeds base roles, sample plans, and the default admin account.

```bash
npm run seed:tool-site
```

### `run-migrations.ts`

Applies pending database migrations.

```bash
npm run db:migrate
```

## Plugin Runtime Scripts

### `generate-plugin-map.ts`

Scans the default `plugins/` directory and any external plugin source
directories configured with `PLOYKIT_PLUGIN_DIRS`. Default plugins are generated
into `src/lib/plugin-map.ts`; external plugin entries are generated into the
active runtime artifact `.runtime/plugin-map.ts` by default, or
`PLOYKIT_PLUGIN_MAP_FILE` when configured.

Current plugin entrypoint:

```text
plugins/<plugin-id>/plugin.ts
```

External source directories can be plugin collections or direct plugin roots:

```bash
PLOYKIT_PLUGIN_DIRS="../shared-plugins,/opt/ploykit-plugins" npm run plugins:scan
```

The generated map can include loaders for:

- `plugin.ts`
- `components/**`
- `pages/**`
- `api/**`
- `jobs/**`
- `webhooks/**`
- `lifecycle/**`

Commands:

```bash
npm run plugins:scan
npm run plugins:check
```

`npm run plugins:check` verifies the generated maps are current and then runs
the plugin runtime checker across all configured plugin source directories.

### `watch-plugins.ts`

Watches runtime plugin files in development and regenerates the active plugin
map files.

```bash
npm run dev:watch
npm run dev
```

Watched plugin files include:

- `plugin.ts`
- `components/**`
- `pages/**`
- `api/**`
- `jobs/**`
- `webhooks/**`
- `lifecycle/**`
- `slots/**`

### `ploykit-plugin.ts`

CLI for plugin authoring checks.

```bash
npm run plugin:create -- <plugin-id>
npm run plugin:check -- plugins/<plugin-id>
npm run plugin:test -- plugins/<plugin-id>
npm run plugin:build -- plugins/<plugin-id>
npm run plugin:inspect -- plugins/<plugin-id>
npm run plugin:doctor -- plugins/<plugin-id>
```

Templates are verified with:

```bash
npm run plugins:templates
```

### `generate-open-source-media.ts`

Generates open-source brand, social, demo, and screenshot assets under
`public/brand` and `public/media`. It also refreshes the browser SVG favicon at
`public/favicon.svg`; `public/favicon.ico` remains the checked-in ICO fallback.
Product screenshots are captured only when the configured app URL is reachable.

```bash
npm run media:generate
```

### `check-plugin-runtime.ts`

Runs runtime-level plugin checks.

```bash
npm run runtime:check
```

## Stripe Scripts

### `setup-stripe-products.ts`

Creates Stripe products/prices and updates plan rows.

```bash
npm run stripe:setup
```

Requires `STRIPE_SECRET_KEY`.

## Verification Scripts

The larger matrix scripts are wired through `package.json` as release and
acceptance checks. They are intentionally kept in the repository so contributors
can reproduce the same verification flow locally or in CI.

Representative commands:

```bash
npm run test:real
npm run test:browser-matrix:build
npm run test:workspace-scope
npm run test:stripe-provider
npm run test:storage-drivers
npm run test:plugin-scale
npm run test:accessibility:build
npm run test:data-export-audit:build
npm run test:observability:build
npm run test:upgrade-migration
npm run test:capacity:build
npm run test:soak:build
npm run test:backup-restore
npm run test:security-audit
npm run test:chaos
npm run test:delivery-docs
```

Local-only credentials used by these scripts, such as `admin@example.com`,
`Admin@123456`, and fake Stripe keys, are test fixtures. Do not reuse them for
deployed environments.

## Environment Variables

Common variables used by scripts:

- `DATABASE_URL`
- `DIRECT_URL`
- `NEON_DATABASE_URL`
- `DB_PROVIDER`
- `STRIPE_SECRET_KEY`
- `NODE_ENV`

At least one database URL must be configured for database scripts.

## Script Guidelines

- Prefer TypeScript scripts with `.ts` and npm aliases in `package.json`.
- Keep scripts idempotent where possible.
- Print clear progress and actionable errors.
- Use the runtime plugin contract (`plugin.ts`) for all plugin tooling.
- Avoid committing scripts that directly mutate production-like data unless they
  are documented, idempotent, and exposed through an npm alias.

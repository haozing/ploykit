# Database And Migrations

Schemas live in `src/lib/db/schema/*` and are split by domain: core auth, RBAC,
entitlements, billing extensions, plugins, plugin storage, plugin platform,
files, notifications, audit logs, webhook reliability, and system settings.

## Drizzle Configuration

```ts
schema: './src/lib/db/schema/*';
out: './drizzle/migrations';
dialect: 'postgresql';
```

The migration journal currently contains 24 entries, through
`0023_workspace_scope_consistency`.

## Database Providers

- `DB_PROVIDER=postgres`: use `DATABASE_URL`, or all of `POSTGRES_HOST`,
  `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`.
- `DB_PROVIDER=neon`: use `NEON_DATABASE_URL`.
- `DB_PROVIDER=supabase`: use `DATABASE_URL`.

## Commands

```bash
npm run db:generate
npm run db:migrate
npm run db:verify
npm run db:verify:structure
npm run db:init
npm run db:setup
npm run db:setup:seed
npm run seed:tool-site
```

Docker database helpers:

```bash
npm run db:docker:up
npm run db:docker:down
npm run db:docker:reset
npm run db:docker:wait
npm run db:docker:verify
npm run db:docker:check
```

## Migration Rules

- After changing `src/lib/db/schema/*`, generate or maintain
  `drizzle/migrations` and run `npm run db:verify`.
- Use `npm run db:verify:structure` when schema shape or migration structure
  changes.
- Run `npm run verify:runtime` for runtime-sensitive changes involving plugin
  storage, files, connectors, metering, credits, billing, or webhook reliability.
- Run migrations before serving production traffic.

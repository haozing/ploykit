# Testing And Maintenance Gates

Use the smallest gate that covers the risk of the change, and broaden the gate
when a change touches shared runtime behavior, database contracts, public routes,
or user-facing flows.

## Fast Local Checks

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:run
```

## Repository Verification

```bash
npm run verify
npm run plugins:check
npm run plugins:templates
npm run runtime:check
```

## Real-Chain Smoke

```bash
npm run test:real
npm run test:real:reset
npm run test:real:prepare
```

## Browser And Human-Style E2E

```bash
npm run test:human
npm run test:human:headed
npm run test:admin:human
```

## Acceptance Matrices

Acceptance matrices are available as npm scripts such as:

```bash
npm run test:browser-matrix:build
npm run test:workspace-scope
npm run test:stripe-provider
npm run test:storage-drivers
npm run test:accessibility:build
npm run test:upgrade-migration
npm run test:capacity:build
npm run test:soak:build
npm run test:backup-restore
npm run test:security-audit
npm run test:chaos
npm run test:delivery-docs
```

Most long-running scripts write summaries under `test-results/`.

## Maintenance Rules

- After changing `src/lib/db/schema/*`, generate or maintain
  `drizzle/migrations` and run `npm run db:verify`.
- After changing `plugins/*/plugin.ts` or plugin pages, APIs, jobs, events,
  webhooks, lifecycle handlers, or assets, run `npm run plugins:scan`.
- After changing the plugin contract, SDK, runtime checks, or templates, run
  `npm run plugins:check` and `npm run plugins:templates`.
- For database, files, connectors, metering, anonymous public APIs, egress, or
  runtime capability changes, run at least `npm run test:real`.
- For user-facing pages or admin workflows, add `npm run test:human` or the
  relevant Playwright spec.
- Before merging broad changes, run `npm run verify`. For runtime-sensitive
  changes, also run `npm run verify:runtime`.

# Database And Runtime Validation

## Use Local Or Docker Only

Use local or Docker databases for destructive or migration-sensitive checks.
Refuse to run destructive tests against a non-local `DATABASE_URL`.

Recommended Docker flow:

```bash
npm run db:up
npm run runtime:stores:migrate
npm run runtime:stores:verify
npm run data:migrate -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
npm run data:verify-db -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
```

Track whether Docker was already running before the test. Do not stop a
preexisting shared database unless the user explicitly asks.

## Data v2 Checks

Run these when a module declares or changes `data`:

```bash
npm run data:generate -- modules/<module-id>
npm run data:types -- modules/<module-id>
npm run data:verify -- --module <module-id>
npm run data:diff
```

Use Postgres verification when persistence, migrations, transactions, SQL
refs, rollback, or product/workspace/user scope matters:

```bash
npm run test:data-runtime
```

## Runtime Store Checks

Use runtime store validation when changes touch catalog, runs, jobs, events,
webhooks, files metadata, audit, commercial ledger, dead-letter queues, admin
operations, or product scope:

```bash
npm run test:runtime-stores
npm run test:admin-operations
npm run test:commercial-ledger
npm run test:files-storage
npm run test:background-reliability
```

If a seed or test needs a deterministic run record, `createRun` now accepts a
stable `id` and rejects conflicting ids unless the idempotency key matches.

## Runtime Health Check

For production-like checks, set explicit env values and run:

```powershell
$env:DATABASE_URL='postgres://ploykit:ploykit@127.0.0.1:55432/ploykit'
$env:PLOYKIT_HOST_URL='https://app.example.com'
$env:PLOYKIT_AUTH_PROVIDER='host'
$env:PLOYKIT_PRODUCT_ID='runtime-check-clean'
npm run runtime:check
```

Mask database URLs in final reports. Keep full values only in local command logs
when necessary and never include credentials in public-facing output.

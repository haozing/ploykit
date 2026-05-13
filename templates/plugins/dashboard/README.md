# Dashboard Template

Use this template for read-heavy reporting, summaries, and operational dashboards.

## Shape

- Keep `plugin.ts` as the only contract entry.
- Use `kind: 'dashboard'`.
- Declare read permissions only unless the dashboard writes data.
- Put read APIs in `api/**` and dashboard components in `pages/**`.
- Keep API responses compact and shaped for the page that consumes them.

## Implementation Rules

- Read records through `ctx.storage.collection(...).findMany(...)`.
- Avoid writes from dashboard APIs unless the contract declares `Permission.StorageWrite`.
- Aggregate in API handlers when the page needs summary numbers.
- Keep UI components importable without server-only host modules.
- Add menu entries only when the page route is declared in `plugin.ts`.

## Tests

`tests/plugin.test.ts` uses the SDK fake host to run contract, API, storage read, aggregation, and UI import smoke checks.

## Validate

```bash
npm run plugin:check -- templates/plugins/dashboard
npm run plugin:test -- templates/plugins/dashboard
npm run plugin:build -- templates/plugins/dashboard
```

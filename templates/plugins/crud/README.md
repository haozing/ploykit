# Crud Template

Use this template for plugins that own a small user-facing data model and expose dashboard CRUD flows.

## Shape

- Keep `plugin.ts` as the only contract entry.
- Declare storage collections under `data.collections`.
- Declare page and API routes with plugin-local paths such as `/` and `/items`.
- Put API handlers in `api/**`, page components in `pages/**`, and lifecycle handlers in `lifecycle/**`.
- Emit plugin-namespaced events such as `crud.item.created`.

## Implementation Rules

- Access records only through `ctx.storage.collection(...)`.
- Keep lifecycle handlers idempotent. This template stores `lifecycle.installed` in `ctx.config` before skipping repeat install work.
- Record user-visible mutations with `ctx.audit.record(...)`.
- Track metered actions with `ctx.usage.increment(...)`.
- Use `ctx.ui.toast` only for optional user feedback.

## Tests

`tests/plugin.test.ts` uses the SDK fake host to run contract, lifecycle idempotency, API, storage, events, audit, usage, and UI import smoke checks.

## Validate

```bash
npm run plugin:check -- templates/plugins/crud
npm run plugin:test -- templates/plugins/crud
npm run plugin:build -- templates/plugins/crud
```

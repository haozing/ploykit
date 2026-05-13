# Tool Template

Use this template for focused, user-triggered utilities that take input, perform one action, and return a result.

## Shape

- Keep `plugin.ts` as the only contract entry.
- Use `kind: 'tool'`.
- Declare a dashboard page for the form surface.
- Declare one action API, usually `/run`, with `POST`.
- Keep tool output deterministic and easy to test.

## Implementation Rules

- Parse request input with `z` schemas from `@ploykit/plugin-sdk`.
- Return results through `ctx.json(...)`.
- Record action execution with `ctx.audit.record(...)`.
- Track usage with `ctx.usage.increment(...)`.
- Keep external network calls behind `ctx.http.fetch(...)` and declare `Permission.ExternalHttp` plus `egress` when needed.

## Tests

`tests/plugin.test.ts` uses the SDK fake host to run contract, API, audit, usage, and UI import smoke checks.

## Validate

```bash
npm run plugin:check -- templates/plugins/tool
npm run plugin:test -- templates/plugins/tool
npm run plugin:build -- templates/plugins/tool
```

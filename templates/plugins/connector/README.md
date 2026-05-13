# Connector Template

Use this template for integrations that store settings, receive webhooks, and run background sync jobs.

## Shape

- Keep `plugin.ts` as the only contract entry.
- Use `kind: 'connector'`.
- Declare settings APIs under `routes.apis`.
- Declare incoming webhooks under `webhooks`.
- Declare sync jobs under `jobs`.
- Emit connector-namespaced events such as `connector.received`.

## Implementation Rules

- Store non-secret settings with `ctx.config`.
- Store API keys and signing material with `ctx.secrets`, never `process.env`.
- Verify incoming webhook payloads with `ctx.webhooks.verify(...)`.
- Return webhook acknowledgements with `ctx.webhooks.respondAccepted()`.
- Use background jobs for retries, polling, and deferred sync work.

## Tests

`tests/plugin.test.ts` uses the SDK fake host to run contract, settings API, config, secrets, webhook, job, audit, and events smoke checks.

## Validate

```bash
npm run plugin:check -- templates/plugins/connector
npm run plugin:test -- templates/plugins/connector
npm run plugin:build -- templates/plugins/connector
```

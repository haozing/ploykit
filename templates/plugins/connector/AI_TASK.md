# AI Task Guide: Connector Plugin

Use this template for integrations that store settings, receive webhooks, and run
background sync jobs.

## Agent Rules

- Keep edits inside this plugin directory.
- Update `plugin.ts` first, especially permissions, webhooks, jobs, events, and
  egress.
- Store non-secret settings with `ctx.config`.
- Store API keys and signing material with `ctx.secrets`.
- Never read connector secrets from `process.env`.
- Verify incoming webhooks with `ctx.webhooks.verify(...)`.
- Return webhook acknowledgements with `ctx.webhooks.respondAccepted()`.
- Use jobs for retries, polling, and deferred sync work.
- Use `ctx.connectors` or `ctx.http.fetch(...)`, not raw external `fetch()`.

## Validate

```bash
npm run plugin:doctor -- plugins/__PLUGIN_ID__
```

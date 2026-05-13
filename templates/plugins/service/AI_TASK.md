# AI Task Guide: Service Plugin

Use this template for event-driven background services that react to platform or
plugin events.

## Agent Rules

- Keep edits inside this plugin directory.
- Update `plugin.ts` first.
- Declare event subscriptions in `events.subscribes`.
- Keep event handlers small and enqueue jobs for long-running work.
- Keep job handlers idempotent and observable with audit or usage records.
- Declare `Permission.EventsSubscribe`, `Permission.EventsEmit`,
  `Permission.JobsEnqueue`, and `Permission.JobsRegister` when needed.
- Avoid user-only assumptions when service jobs run with system context.

## Validate

```bash
npm run plugin:doctor -- plugins/__PLUGIN_ID__
```

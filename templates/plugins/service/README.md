# Service Template

Use this template for event-driven background services that react to platform or plugin events.

## Shape

- Keep `plugin.ts` as the only contract entry.
- Use `kind: 'service'`.
- Declare event subscriptions as `events.subscribes: { eventName: './events/handler' }`.
- Put event handlers in `events/**` and job handlers in `jobs/**`.
- Keep a small health API for admin diagnostics.

## Implementation Rules

- Keep lifecycle handlers idempotent. This template stores `lifecycle.enabled` in `ctx.config` before skipping repeat enable work.
- Event handlers should enqueue jobs instead of doing long-running work inline.
- Job handlers should emit completion events and avoid user-only capabilities when running with system context.
- Use plugin-namespaced events such as `service.completed`.
- Declare `Permission.EventsSubscribe`, `Permission.EventsEmit`, `Permission.JobsEnqueue`, and `Permission.JobsRegister` together when the service uses all four surfaces.

## Tests

`tests/plugin.test.ts` uses the SDK fake host to run contract, health API, lifecycle idempotency, event handler, job handler, audit, usage, and events smoke checks.

## Validate

```bash
npm run plugin:check -- templates/plugins/service
npm run plugin:test -- templates/plugins/service
npm run plugin:build -- templates/plugins/service
```

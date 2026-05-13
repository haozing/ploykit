# AI Task Guide: CRUD Plugin

Use this template for plugins that own a small data model and expose dashboard
CRUD flows.

## Agent Rules

- Keep edits inside this plugin directory.
- Update `plugin.ts` first, especially `data.collections`, routes, menu, and
  permissions.
- Access data only through `ctx.storage.collection(...)`.
- Keep lifecycle handlers idempotent.
- Record user-visible mutations with `ctx.audit.record(...)`.
- Track usage with `ctx.usage.increment(...)`.
- Emit plugin-namespaced events such as `<plugin-id>.item.created`.
- Add fake host tests for storage, API handlers, lifecycle, audit, usage, and
  events.

## Validate

```bash
npm run plugin:doctor -- plugins/__PLUGIN_ID__
```

# AI Task Guide: Tool Plugin

Use this template for focused utilities that take input, perform one action, and
return a result.

## Agent Rules

- Keep edits inside this plugin directory.
- Update `plugin.ts` before handlers or pages.
- Use `kind: 'tool'`.
- Prefer one page and one `POST /run` API.
- Validate request input with `z` from `@ploykit/plugin-sdk`.
- Return data with `ctx.json(...)`.
- Record execution with `ctx.audit.record(...)`.
- Track usage with `ctx.usage.increment(...)`.
- Use `ctx.http.fetch(...)` plus `Permission.ExternalHttp` and `egress` for
  external calls.

## Validate

```bash
npm run plugin:doctor -- plugins/__PLUGIN_ID__
```

# PloyKit Agent Instructions

Use these rules when an AI coding agent edits this repository.

## Plugin Work

- Prefer plugin-scoped changes. For a plugin task, work inside `plugins/<plugin-id>/`
  unless the user explicitly asks for host, docs, or template changes.
- Start from `plugin.ts`. It is the source of truth for routes, permissions,
  storage, resources, jobs, events, webhooks, meters, lifecycle, and egress.
- Use `@ploykit/plugin-sdk`, `@ploykit/plugin-sdk/react`, and
  `@ploykit/plugin-sdk/testing`.
- Use `ctx.*` capabilities for host behavior.
- Do not import `src/lib/*` from plugin code.
- Do not read `process.env` from plugin code.
- Do not access the database directly from plugin code.
- Do not use raw external `fetch()` from plugin code. Use `ctx.http.fetch(...)`,
  declare `Permission.ExternalHttp`, and add a narrow `egress` origin.
- Add permissions that match capability usage.
- Public plugin APIs must declare `anonymousPolicy`.
- Plugin module paths must be local paths like `./api/run` or
  `./pages/ToolPage`.

## Plugin Validation Loop

For plugin changes, run the tight loop before broader checks:

```bash
npm run plugin:doctor -- plugins/<plugin-id>
```

If `plugin:doctor` fails, use the JSON diagnostics. Fix the first error by
`path` and `fix`, rerun the command, and repeat.

When the plugin contract changes, run:

```bash
npm run plugins:scan
```

For runtime-sensitive changes, also run:

```bash
npm run test:real
npm run verify:runtime
```

## Documentation

- Keep root `README.md` concise.
- Put detailed plugin, boundary, testing, route, and release material under
  `docs/`.
- Keep English docs free of CJK characters.
- Keep Chinese docs in the matching `*.zh-CN.md` file.

# PloyKit Plugin Workflow

## Template Selection

| Template    | Use when the plugin is mainly...                                      | Typical files                                          |
| ----------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| `tool`      | A focused utility that takes input and returns a result.              | `plugin.ts`, `pages/ToolPage.tsx`, `api/run.ts`        |
| `crud`      | A records app with structured storage and list/detail/edit flows.     | `plugin.ts`, `pages/CrudPage.tsx`, `api/items.ts`      |
| `dashboard` | A read-heavy reporting surface or summary view.                       | `plugin.ts`, `pages/DashboardPage.tsx`, `api/*`        |
| `connector` | External service configuration, webhooks, secrets, and sync jobs.     | `plugin.ts`, `api/settings.ts`, `jobs/*`, `webhooks/*` |
| `service`   | Background behavior, events, jobs, and internal APIs without much UI. | `plugin.ts`, `jobs/*`, `events/*`, `api/health.ts`     |

## Create A Plugin

```bash
npm run plugin:create -- <plugin-id> --template <template>
```

Then read:

- `plugins/<plugin-id>/plugin.ts`
- `plugins/<plugin-id>/AI_TASK.md`
- matching `templates/plugins/<template>/AI_TASK.md` when template behavior is unclear

## Work Order

1. Update `plugin.ts`.
2. Implement pages, API handlers, jobs, events, webhooks, or lifecycle handlers.
3. Add or update tests in `tests/plugin.test.ts`.
4. Run `npm run plugin:doctor -- plugins/<plugin-id>`.
5. Repair the first error diagnostic and rerun.
6. Run `npm run plugins:scan` if the contract changed.

## Plugin-Local Boundary

Default to editing only `plugins/<plugin-id>/`. Change host files only when the
user asks for a new host capability, SDK type, runtime adapter, documentation,
or template behavior.

Never solve plugin work by importing host internals from `src/lib/*`, reading
`process.env`, touching database clients directly, or calling raw external
`fetch()`.

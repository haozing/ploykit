# Code-Level Plugin Validation

## Read First

Read these files before selecting tests:

- `AGENTS.md`
- `plugins/<plugin-id>/plugin.ts`
- `plugins/<plugin-id>/plugin.dependencies.json` when present
- plugin-local `tests/`
- touched host files under `src/lib/plugin-*`, `src/plugin-sdk`, `src/lib/host-pages`,
  `src/components/plugins`, or `src/lib/ui/slots`

## Review Checklist

Check that `plugin.ts` and source usage match:

- routes: page/tool/API/webhook paths are local and not conflicting
- permissions: every used `ctx.*` capability has the matching `Permission.*`
- public APIs: `anonymousPolicy` exists and blocks unintended high-cost work
- external HTTP: `ctx.http.fetch`, `Permission.ExternalHttp`, and narrow `egress`
- storage: collections, fields, indexes, and scopes match expected behavior
- services: `ctx.services` calls are declared with allowed methods and paths
- host pages: slots/overrides declare permissions, SEO, i18n, cache, and local
  component modules
- i18n: locale resource files contain visible UI strings and SEO strings used
  by pages, host page overrides, menus, and slots
- npm dependencies: `plugin.dependencies.json` dependencies are installed and
  declared in host root `package.json` runtime dependencies
- boundaries: no `src/lib/*` imports from plugin code, no `process.env`, no
  database client imports, no raw external `fetch()`, no Node builtins unless
  explicitly allowed by the plugin contract/checker

## Command Order

Start narrow:

```bash
npm run plugin:doctor -- plugins/<plugin-id>
npm run plugin:check -- plugins/<plugin-id>
npm run plugin:test -- plugins/<plugin-id>
npm run plugin:build -- plugins/<plugin-id>
```

If the contract changed:

```bash
npm run plugins:scan
npm run plugins:check
```

For host runtime changes, run targeted tests first, then broader checks:

```bash
npx vitest run <changed-test-file-or-folder>
npm run typecheck
npm run lint
npm run test:run
```

For database/runtime-sensitive changes:

```bash
npm run db:verify
npm run verify:runtime
```

Use Docker when the test needs real migrations, plugin installation state,
runtime reconciliation, or storage:

```bash
npm run db:docker:up
npm run db:docker:wait
npm run db:migrate
npm run seed:tool-site
npm run runtime:check
```

## Failure Handling

- For `plugin:doctor`, fix the first `severity: "error"` diagnostic by `file`
  and `path`, then rerun.
- For type or lint failures, fix the local cause rather than masking the rule.
- For generated plugin map failures, run `npm run plugins:scan` only after
  confirming the contract change is intended.
- Do not continue to API/browser testing if core plugin contract checks fail.

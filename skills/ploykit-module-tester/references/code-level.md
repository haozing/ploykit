# Code-Level PloyKit Validation

## Read First

Read these files before selecting tests:

- `AGENTS.md` when present
- `modules/<module-id>/module.ts` for module work
- module-local `tests/`
- touched files under `src/module-sdk`, `src/lib/module-runtime`,
  `apps/host-next`, `templates/modules`, or `tests`
- `package.json` scripts

## Review Checklist

Check that contract and source usage match:

- routes: page/API paths are local, explicit, and non-conflicting
- handlers: API uses `defineApi(...)`; actions use `action(...)` or
  `defineAction(...)`
- permissions: every used `ctx.*` capability has the matching `Permission.*`
- public APIs: `anonymousPolicy` exists and blocks unintended high-cost work
- external HTTP: `ctx.http.fetch`, `Permission.ExternalHttp`, and narrow egress
- Data v2: tables/documents, generated artifacts, migrations, and types are
  synchronized with `module.ts`
- surfaces/navigation: contribution or override permissions are declared
- resources: locales and assets exist; workers and WASM declare `kind`
- dependencies: `dependencies.npm` entries exist in host `package.json`
- boundaries: no host internal imports, `process.env`, database clients, global
  `fetch()`, Node builtins, `eval`, `Function`, or dynamic `ctx[...]`
- host capability changes: capability is mounted in fake/testing host, shared
  runtime contexts, and app host integration

## Command Order

Start narrow for a module:

```bash
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
```

If contract or generated files changed:

```bash
npm run modules:scan
npm run modules:check
npm run host:boundary-check
```

For Data v2 contract changes:

```bash
npm run data:generate -- modules/<module-id>
npm run data:types -- modules/<module-id>
npm run data:verify -- --module <module-id>
npm run data:diff
```

For shared runtime changes:

```bash
npm run typecheck
npm run test:host-runtime
npm run test:web-shell
```

Before RC-level claims:

```bash
npm run release:rc-gate
```

RC-level claims are for host/product release readiness. Do not add
module-specific required checks to the global RC gate; module-owned external E2E
belongs in module README instructions until a generic module E2E entry exists.

## Failure Handling

- For `module:doctor`, fix the first `severity: "error"` diagnostic by `file`,
  `path`, and `fix`, then rerun.
- For type or runtime test failures, fix the local cause rather than weakening
  validation.
- For stale map failures, run `npm run modules:scan` only after confirming the
  contract change is intended.
- Do not continue to API/browser testing if core module contract checks fail.

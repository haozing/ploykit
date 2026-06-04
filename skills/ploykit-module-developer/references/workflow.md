# PloyKit Module Workflow

## Create A Module

Use the target template model when designing new module work:

```text
product        main preset: minimal + product + white-label + Data v2 CRUD
service-backed extension: OpenAPI/serviceRequirements/service client/mock/live smoke
background     extension: jobs/events/webhooks/lifecycle
```

Use the product preset by default and add extensions only when the module needs
those capabilities:

```bash
npm run module:create -- <module-id>
npm run module:create -- <module-id> --template product
npm run module:create -- <module-id> --template product --with service-backed
npm run module:create -- <module-id> --template product --with background
npm run module:create -- <module-id> --template product --with service-backed,background
```

The CLI still exposes transitional templates (`basic`, `dashboard`, `crud`,
`connector`, `signed-service`, `job`, `white-label`, `product-app`) for
compatibility. Use them as historical references when repairing existing
modules, not as the default shape for new product work.

After creation, read:

- `modules/<module-id>/module.ts`
- generated files under `modules/<module-id>/.ploykit/generated/` when the
  module declares Data v2
- matching files under `templates/modules/product/` and
  `templates/module-extensions/<extension>/` when template behavior is unclear
- `templates/modules/white-label/` when product presentation or page replacement behavior is unclear

For service-backed modules, also read the service machine contract
(`openapi.yaml`, AsyncAPI, JSON Schema, or Proto) before implementing pages or
actions. If only handwritten Markdown exists, report the missing machine
contract first.

For product modules that need page replacement and Data v2, prefer one product
module root from the `product` preset over separate white-label and CRUD
modules.

## Work Order

1. Update `module.ts` first.
2. Implement pages, loaders, API handlers, actions, jobs, events, webhooks,
   surfaces, lifecycle handlers, resources, or Data v2 files.
3. Generate Data v2 artifacts when the data contract changed.
4. Add or update module-local tests.
5. Run `npm run module:doctor -- modules/<module-id>`.
6. Fix the first error diagnostic by `path` and `fix`, then rerun.
7. For service-backed modules, run
   `npm run module:service-contract -- modules/<module-id> --openapi <openapi.yaml>`.
   Add `--write-fixtures` when OpenAPI examples/schema should refresh generated
   mock fixtures.
8. Run `npm run module:test -- modules/<module-id>`.
9. Run `npm run modules:scan` after contract or file path changes.

## Service-Backed Work

Use this path for modules backed by an independent service such as a Go Core:

1. Treat the service machine contract as the API source of truth.
2. Declare `contractVersion: 2`, `serviceRequirements`, resource bindings, and
   `Permission.ServicesInvoke` in `module.ts`.
3. Keep a single `lib/service-client.ts` or equivalent as the only
   `ctx.services.invoke(...)` entry point.
4. Let pages, loaders, and actions call semantic functions from that client
   (`listProjects`, `createJob`, `rotateToken`), not raw service paths.
5. Use OpenAPI examples/schema and module-local fixtures for mock tests.
6. Use `createTestingModuleContext({ serviceHandlers })` for fixture-backed
   `ctx.services.invoke(...)` tests; do not branch page/action code for mock
   mode.
7. Keep `tests/service-contract.json` current when the service client uses
   dynamic paths that static source scanning cannot fully infer.
8. Do not claim release readiness from mock tests. Signing, tenant isolation,
   idempotency, quota, one-time token, lease/retry, and state-machine behavior
   need live smoke or service blackbox evidence.
9. Switch mock/live by service connection base URL and secret refs, not by
   branching UI or action code.

## Module-Local Boundary

Default to editing only `modules/<module-id>/`.

Change host files only when the user asks for one of these:

- new `@ploykit/module-sdk` type or helper
- host runtime adapter or capability mounting
- Web Shell, admin, public route, or surface integration
- module template behavior
- repo documentation
- shared testing infrastructure

When the requested behavior cannot be expressed through the current module
contract, do not patch host/shared code with a module-specific branch. Report
the missing generic registry, catalog, manifest, or contribution seam first,
then implement that seam if the user asks for host work.

Module development may also refresh generated module map files:

- `src/lib/module-map.ts`
- `src/lib/module-map.manifest.json`

Do not promote module acceptance into host-wide policy:

- do not add module-specific routes to `scripts/host-browser-matrix.mjs` or
  `scripts/host-accessibility-smoke.mjs`
- do not write `moduleId === '<id>'`, `/dashboard/<id>`, or concrete
  `modules/<id>` imports in host/shared code
- do not add module-specific required checks to
  `src/lib/module-runtime/release/rc-gate.ts` or
  `scripts/release-candidate-gate.ts`
- do not add module-specific `host:*` package scripts
- document module-owned external E2E prerequisites, command, and evidence path
  in `modules/<module-id>/README.md`; wire it to a host quality runner only
  after a generic module E2E entry exists

## Data v2 Work

When `module.ts` declares `data`, keep generated artifacts synchronized:

```bash
npm run data:generate -- modules/<module-id>
npm run data:types -- modules/<module-id>
npm run data:verify -- --module <module-id>
```

Use Docker/Postgres for real persistence checks:

```bash
npm run db:up
npm run data:migrate -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
npm run data:verify-db -- --database-url postgres://ploykit:ploykit@127.0.0.1:55432/ploykit
```

## Reusable AI-Agent Prompt

```text
You are developing a PloyKit first-class local module.
Work inside modules/<module-id>/ unless a host-runtime capability is explicitly requested.
Do not modify apps/host-next/*, src/lib/module-runtime/*, src/module-sdk/*, or scripts/host-* unless the user explicitly asks for a host extension seam.
If the current host has no seam for the requested behavior, report the missing generic registry/contribution seam; do not add moduleId special cases, concrete modules/<id> imports, module-specific host routes, module-specific RC gate checks, or module-specific host:* scripts. Document module-owned external E2E in the module README until a generic module E2E entry exists.
Read module.ts first and treat it as the contract for routes, actions, jobs, events, webhooks, data, permissions, surfaces, lifecycle, resources, dependencies, and egress.
Use @ploykit/module-sdk and ctx.* capabilities only. Do not import src/lib/*, read process.env, use database clients directly, call global fetch(), import Node builtins, or use dynamic ctx access.
When using ctx.data, ctx.files, ctx.artifacts, ctx.ai, ctx.rag, ctx.http, ctx.notifications, ctx.audit, ctx.billing, ctx.metering, ctx.credits, ctx.jobs, ctx.events, or ctx.webhooks, update module.ts permissions.
For modules backed by an independent service, read OpenAPI/AsyncAPI/JSON Schema/Proto first. If no machine contract exists, report the missing contract instead of guessing endpoints. Keep one service client/adapter as the only ctx.services.invoke entry. Use mocks for UI and ordinary flows, but require live smoke for signing, tenant isolation, idempotency, quota, one-time token, lease/retry, and state-machine behavior.
Run npm run module:doctor -- modules/<module-id>, fix the first error diagnostic, rerun until it succeeds, then run npm run host:boundary-check when host/shared files changed.
```

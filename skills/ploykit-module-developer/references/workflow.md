# PloyKit Module Workflow

## Create A Module

Use the smallest template that matches the requested product behavior:

```bash
npm run module:create -- <module-id> --template <basic|dashboard|crud|connector|job|white-label>
```

After creation, read:

- `modules/<module-id>/module.ts`
- generated files under `modules/<module-id>/.ploykit/generated/` when the
  module declares Data v2
- matching files under `templates/modules/<template>/` when template behavior
  is unclear
- `templates/modules/white-label/` when product presentation or page replacement behavior is unclear

## Work Order

1. Update `module.ts` first.
2. Implement pages, loaders, API handlers, actions, jobs, events, webhooks,
   surfaces, lifecycle handlers, resources, or Data v2 files.
3. Generate Data v2 artifacts when the data contract changed.
4. Add or update module-local tests.
5. Run `npm run module:doctor -- modules/<module-id>`.
6. Fix the first error diagnostic by `path` and `fix`, then rerun.
7. Run `npm run module:test -- modules/<module-id>`.
8. Run `npm run modules:scan` after contract or file path changes.

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
Run npm run module:doctor -- modules/<module-id>, fix the first error diagnostic, rerun until it succeeds, then run npm run host:boundary-check when host/shared files changed.
```

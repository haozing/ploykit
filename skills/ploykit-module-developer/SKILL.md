---
name: ploykit-module-developer
description: Build, modify, review, and debug PloyKit first-class local modules and host module-runtime capabilities with AI-agent-safe workflows. Use when an AI agent is asked to create or edit modules under modules/, update module.ts contracts, choose module templates, implement module pages/APIs/actions/jobs/events/webhooks/surfaces/lifecycle/data, map ctx capabilities to permissions, run module:doctor/module:test/Data v2 checks, or prepare AI-agent prompts for PloyKit module development.
---

# PloyKit Module Developer

## Overview

Use this skill to keep PloyKit work contract-first, local-module-native, and
repairable through structured diagnostics.

PloyKit modules are first-class project modules. Start from `module.ts`, use
`@ploykit/module-sdk` and `ctx.*` host capabilities, and make host-runtime
changes only when the requested capability cannot be expressed inside a module.

## Core Workflow

1. Locate the target `modules/<module-id>/` directory or choose the narrowest
   module template.
2. Read `module.ts` first. Treat it as the source of truth for routes, actions,
   jobs, events, webhooks, data, permissions, surfaces, lifecycle, resources,
   dependencies, product shape, presentation, i18n, theme, assets, and egress.
3. Before editing a product-facing module, decide whether it needs public site,
   workspace dashboard, admin operations, or all three. Encode that decision in
   `product.requiredShells`, `product.pages`, `routes.site`,
   `routes.dashboard`, `routes.admin`, and matching navigation. Do not treat a
   backend Admin API as a product Admin console.
4. Keep module work inside `modules/<module-id>/` unless the user explicitly
   asks for host runtime, SDK, template, documentation, or test harness changes.
5. Use `@ploykit/module-sdk`, `@ploykit/module-sdk/testing`, module-local paths,
   and injected `ctx.*` capabilities.
6. Add permissions that match every used `ctx.*` capability. Remove unused
   permissions when diagnostics identify them.
7. Use Data v2 for module persistence. Do not add alternate storage models or
   compatibility layers.
8. Add or update module-local tests and only broaden to host tests when the
   change affects shared runtime behavior.
9. Run `npm run module:doctor -- modules/<module-id>` and repair the first
   error diagnostic until it succeeds.
10. Run `npm run modules:scan` when `module.ts`, local handler paths, resources,
   or generated artifacts change.
11. For module-owned external end-to-end checks, document the prerequisites,
    command, and evidence path in `modules/<module-id>/README.md`; wire it to a
    host quality runner only after a generic module E2E entry exists.
12. For white-label, public site, auth, dashboard shell, theme, SEO, or locale
    work, keep copy in locale catalogs, use `labelKey` for navigation, and
    validate the product presentation gates before handing off.
13. If a module needs host rendering, routing, quality evidence, or release
    behavior that has no extension seam, report the missing generic seam first.
    Do not add `moduleId === '<id>'`, `/dashboard/<id>`, or concrete
    `modules/<id>` imports in host/shared code to finish the task.

## Template Choice

- `basic`: page, API, action, README, and smoke test.
- `dashboard`: dashboard page, loader, navigation, surface, API, action, and
  smoke test.
- `product-app`: public site, workspace console, admin operations, product page
  shape, multi-shell navigation, surface, and smoke test.
- `crud`: Data v2 table, page loader, API, action, generated data artifacts,
  migration, and types.
- `connector`: connector API/action, sync job, and file result flow.
- `job`: background job, artifact, and notification flow.
- `white-label`: public/auth page replacement, locale resources, page
  presentation loader, semantic theme tokens, and smoke test.

Create a module with:

```bash
npm run module:create -- <module-id> --template <basic|dashboard|product-app|crud|connector|job|white-label>
```

## Product Shape Work

Use `product` when a module is a real product surface, not just a small tool:

- `product.kind` tells the host whether this is a tool, product, or platform.
- `product.requiredShells` declares whether the module must have `site`,
  `dashboard`, and/or `admin` routes.
- `product.pages` lists the user audience, user question, primary actions, and
  shell for each required product page.
- `routes.site` should serve public product and documentation pages.
- `routes.dashboard` should serve workspace user workflows.
- `routes.admin` should serve platform operations, tenant-wide health, evidence,
  and governance pages.
- Navigation must match the shell: `site.header`/`site.footer`,
  `dashboard.sidebar`, and `admin.sidebar`.
- Module quality derives route checks from `product.pages`; keep `samplePath`
  and `quality.contains` current for dynamic routes.

## Product Presentation Work

Use the Product Presentation Kernel for white-label surfaces:

- Put product-wide brand, page ownership, slots, supported languages, and theme
  profiles in `product.presentation.ts`.
- Put host copy in `apps/host-next/locales/*.json`.
- Put module copy in `modules/<module-id>/locales/*.json` and declare it under
  `resources.locales`.
- Use `navigation.labelKey`; treat `fallbackLabel` only as a contract fallback
  and diagnostic aid.
- White-label modules should declare `presentation.whiteLabel`,
  `presentation.replaces`, `presentation.seoNamespaces`, and `themeScope`.
- Page loaders should return `definePagePresentation(...)` metadata for shell,
  SEO, i18n, theme, and cache. Do not hand-roll page-specific SEO or theme
  branches in host code.
- Use semantic theme tokens from the host allowlist. Do not add global CSS,
  legacy CSS variables, or module-controlled Admin overrides.

## Boundary Rules

- Module code must not import host internals from `src/lib/*`.
- Module code must not read `process.env`, use database clients directly, call
  global `fetch()`, import Node builtins, use `eval`, use `Function`, or access
  `ctx` dynamically.
- External HTTP must use `ctx.http.fetch(...)`, `Permission.ExternalHttp`, and a
  narrow `egress` origin.
- API handlers must use `defineApi(...)`.
- Action handlers must use `action(...)` or `defineAction(...)`.
- Public APIs must declare `anonymousPolicy`.
- Secrets belong in `ctx.secrets`; non-secret settings belong in `ctx.config`.
- Module work may update generated module map files, but must not promote a
  module route or E2E flow into host-wide policy.
- Host/shared code must not import concrete module implementations or hard-code
  concrete module ids. Use module map, catalog, manifest, registry, or
  contribution APIs instead.
- Do not add module-specific routes to `scripts/host-browser-matrix.mjs` or
  `scripts/host-accessibility-smoke.mjs`.
- Do not add module-specific required checks to
  `src/lib/module-runtime/release/rc-gate.ts` or
  `scripts/release-candidate-gate.ts`.
- Do not add module-specific `host:*` package scripts. Keep module-owned
  external checks documented in the module README until a generic module E2E
  entry exists.

## Validation Loop

Start narrow:

```bash
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
```

For Data v2 modules:

```bash
npm run data:generate -- modules/<module-id>
npm run data:types -- modules/<module-id>
npm run data:verify -- --module <module-id>
```

When contracts or generated maps change:

```bash
npm run modules:scan
npm run modules:check
npm run host:boundary-check
```

For shared host-runtime changes:

```bash
npm run typecheck
npm run presentation:check
npm run i18n:check
npm run theme:check
npm run seo:check
npm run white-label:smoke
npm run test:host-runtime
npm run test:web-shell
npm run runtime:check
```

## References

Load references only when relevant:

- `references/workflow.md`: module creation, edit order, and reusable AI-agent
  prompt patterns.
- `references/module-contract.md`: `module.ts` contract patterns and Data v2
  declaration examples.
- `references/capabilities.md`: `ctx.*` capability to `Permission.*` mapping.
- `references/host-capabilities.md`: rules for changing host runtime capability
  mounting, Web Shell integration, and shared tests.

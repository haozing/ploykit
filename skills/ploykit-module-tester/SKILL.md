---
name: ploykit-module-tester
description: Run layered validation for PloyKit local modules and host module-runtime changes. Use when an AI agent is asked to test PloyKit modules, Data v2, runtime stores, module APIs/actions, Web Shell/admin/public pages, AI/RAG/files/commercial capabilities, Docker/Postgres validation, real browser screenshots, console/network inspection, or produce an evidence-backed test report.
---

# PloyKit Module Tester

## Overview

Use this skill to validate PloyKit work with concrete evidence instead of
static confidence. Move in layers: code-level checks, database/runtime checks,
real API/action checks, then browser screenshots and console/network evidence.

Never mark a page visually passed only because DOM assertions passed. Capture
screenshots and inspect them.

## Core Workflow

1. Identify the target module, host capability, or product surface.
   - For modules, read `modules/<module-id>/module.ts` first.
   - For product modules, inspect `product.requiredShells`, `product.pages`,
     `routes.site`, `routes.dashboard`, `routes.admin`, and navigation before
     running browser checks.
   - For host changes, read the touched runtime, SDK, Web Shell, or template
     files plus the nearest tests.
   - For white-label/theme/i18n/SEO work, read `product.presentation.ts`, host
     locale catalogs, module locale resources, and the page presentation loader.
2. Run code-level validation before starting browsers or servers.
   - Use `references/code-level.md` for command order and review checklist.
3. Run database/runtime validation when Data v2, runtime stores, jobs, events,
   files, commercial, AI/RAG, or product scope changed.
   - Use `references/database-runtime.md` for Docker/Postgres rules.
4. Run real API/action validation against a local app.
   - Use `references/real-api.md` for endpoint discovery and request matrix.
5. Run real browser validation with screenshots and console/network collection.
   - Use `references/browser-visual.md` for route sweep and visual inspection.
6. Report only evidence-backed results.
   - Use `references/reporting.md` for summary shape and pass/fail rules.

## Operating Rules

- Keep final test artifacts under `test-results/<test-name>/`.
- If a runner may delete `test-results`, write transient screenshots/logs under
  `.runtime/<test-name>/` first, then copy the final evidence into
  `test-results/<test-name>/`.
- Prefer local or Docker databases. Refuse destructive tests against non-local
  database hosts.
- Record whether Docker services were already running; stop only the services
  and server processes started for the test.
- When a command fails, inspect the log and fix the first actionable failure
  before broadening the test scope.
- If screenshots exist, open or view each meaningful screenshot before saying
  the page looks correct.
- Treat unexpected console errors, page errors, failed owned resources, and 5xx
  network responses as failures.
- Mention any skipped layer explicitly in the final report.

## Useful Commands

```bash
npm run module:doctor -- modules/<module-id>
npm run module:test -- modules/<module-id>
npm run module:quality -- modules/<module-id> -- --required
npm run modules:scan
npm run modules:check
npm run host:boundary-check
npm run presentation:check
npm run i18n:check
npm run theme:check
npm run seo:check
npm run white-label:smoke
npm run admin:ui-gate
npm run admin:mobile-handfeel
npm run admin:visual-baseline
npm run typecheck
npm run data:diff
npm run data:verify
npm run runtime:stores:verify
npm run runtime:check
npm run release:rc-gate
npm run host:build
npm run host:start
```

Use targeted tests first, then broaden:

`release:rc-gate`, `host:browser-matrix`, and
`host:accessibility-smoke` are host/product release checks. For module-only
changes, do not add module-specific routes or required checks to those global
gates; use module-local tests and module README E2E instructions instead.

```bash
npm run test:host-runtime
npm run test:web-shell
npm run host:browser-matrix -- --required
npm run host:theme-matrix -- --required
npm run host:accessibility-smoke -- --required
npm run test:data-runtime
npm run test:runtime-stores
npm run test:ai-provider
npm run test:rag-files
npm run test:release-candidate
```

## References

Load only the needed reference:

- `references/code-level.md`: static review, doctor/check/test commands,
  module map, and capability-specific checks.
- `references/database-runtime.md`: Docker/Postgres setup, Data v2, runtime
  stores, and persistence checks.
- `references/real-api.md`: local server setup, endpoint/action matrix, auth,
  negative cases, and response evidence.
- `references/browser-visual.md`: route enumeration, screenshots, console and
  network checks, and visual inspection standards.
- `references/reporting.md`: concise evidence report format and failure rules.

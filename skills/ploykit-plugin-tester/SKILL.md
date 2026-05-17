---
name: ploykit-plugin-tester
description: Run layered validation for PloyKit plugins and plugin-sensitive host changes. Use when Codex is asked to test a PloyKit plugin, verify plugin APIs, run real browser/page checks, inspect screenshots, validate host page slots or overrides, check plugin install/enable/runtime behavior, or produce a concrete test report for code-level, API-level, and visual page-level evidence.
---

# PloyKit Plugin Tester

## Overview

Use this skill to validate PloyKit plugin work with real evidence instead of
only static confidence. Move in layers: code-level checks first, real API
requests second, real browser screenshots last.

Never mark a page visually passed only because DOM assertions passed. Capture
screenshots and inspect them.

## Core Workflow

1. Identify the target plugin or host capability.
   - Read `plugins/<plugin-id>/plugin.ts` first for routes, APIs, pages, host
     pages, permissions, storage, services, resources, dependencies, lifecycle,
     jobs, events, webhooks, and egress.
   - If the request is repo-wide, discover host routes from `src/app` and plugin
     runtime routes from the generated plugin map.
2. Run code-level validation before starting browsers or servers.
   - Use `references/code-level.md` for the command order and review checklist.
3. Run real API validation against a local app and local or Docker database.
   - Use `references/real-api.md` for endpoint discovery, auth setup, request
     matrix, and response evidence.
4. Run real page validation with screenshots.
   - Use `references/browser-visual.md` for route enumeration, locale coverage,
     screenshot capture, console/network checks, and visual inspection.
5. Report only evidence-backed results.
   - Use `references/reporting.md` for the summary shape and pass/fail rules.

## Operating Rules

- Keep test artifacts under `test-results/<test-name>/`.
- Prefer local or Docker test databases. Refuse to run destructive real tests
  against non-local database hosts.
- When a command fails, inspect the log and fix the first actionable failure
  before broadening the test scope.
- Stop any server process started for the test unless the user explicitly asks
  to keep it running.
- If screenshots exist, open or view each meaningful screenshot before saying it
  looks correct.
- Mention any skipped layer explicitly in the final report.

## Useful Existing Commands

```bash
npm run plugin:doctor -- plugins/<plugin-id>
npm run plugin:check -- plugins/<plugin-id>
npm run plugin:test -- plugins/<plugin-id>
npm run plugin:build -- plugins/<plugin-id>
npm run plugins:scan
npm run plugins:check
npm run typecheck
npm run lint
npm run test:run
npm run verify:runtime
npm run test:real
npm run test:human
```

For host capability regression tests, look for existing purpose-built scripts
under `scripts/*real-test.ts` before inventing a new runner.

## References

Load only the needed reference:

- `references/code-level.md`: static review, unit tests, plugin doctor, runtime
  map, and capability-specific checks.
- `references/real-api.md`: local server setup, authentication, endpoint matrix,
  negative cases, and database side-effect checks.
- `references/browser-visual.md`: page route sweep, locale coverage, Playwright
  screenshots, console/network checks, and screenshot inspection standards.
- `references/reporting.md`: concise evidence report format and failure rules.

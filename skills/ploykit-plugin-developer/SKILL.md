---
name: ploykit-plugin-developer
description: Build, modify, review, and debug PloyKit local plugins with AI-safe workflows. Use when Codex is asked to create or edit plugins under the plugins directory, choose a tool/crud/dashboard/connector/service template, update plugin.ts contracts, implement plugin pages/APIs/jobs/events/webhooks, map ctx capabilities to permissions, add @ploykit/plugin-sdk/testing tests, interpret plugin:doctor JSON diagnostics, or prepare prompts for AI-assisted PloyKit plugin development.
---

# PloyKit Plugin Developer

## Overview

Use this skill to keep PloyKit plugin work local, contract-first, typed, and
repairable through machine-readable diagnostics.

PloyKit plugins should feel like small products with explicit contracts, not
host patches. Start with `plugin.ts`, implement inside the plugin directory,
use `ctx.*` capabilities for platform behavior, and converge with
`plugin:doctor`.

## Core Workflow

1. Locate the target plugin directory or choose the narrowest template.
2. Read `plugin.ts` first. Treat it as the source of truth.
3. Keep edits inside `plugins/<plugin-id>/` unless the user explicitly asks for
   host, docs, or template changes.
4. Use `@ploykit/plugin-sdk`, `@ploykit/plugin-sdk/react`, and
   `@ploykit/plugin-sdk/testing`.
5. Use `ctx.*` capabilities. Do not import host internals, read
   `process.env`, access the database directly, or use raw external `fetch()`.
6. Add permissions that match capability usage.
7. Add or update plugin tests with the fake host.
8. Run `npm run plugin:doctor -- plugins/<plugin-id>` and repair the first
   error diagnostic until it returns `success: true`.
9. Run `npm run plugins:scan` when the contract changes.

## Template Choice

- `tool`: one focused utility, usually one page and one `POST /run` API.
- `crud`: structured records with list/detail/create/update/delete flows.
- `dashboard`: read-heavy reporting or analytics views.
- `connector`: external service settings, webhooks, sync jobs, and secrets.
- `service`: background logic, jobs, events, and internal APIs.

When creating a plugin:

```bash
npm run plugin:create -- <plugin-id> --template <tool|crud|dashboard|connector|service>
```

Read `templates/plugins/<template>/AI_TASK.md` after choosing a template.

## Contract Rules

Update `plugin.ts` before handlers or pages. Declare only what the plugin
actually needs:

- metadata: `id`, `name`, `version`, `kind`, `trustLevel`
- routes: pages, APIs, public tools, webhooks
- UI: menu, slots, theme tokens
- data: plugin-owned collections
- capabilities: permissions, resources, meters, egress
- runtime hooks: jobs, events, lifecycle

Public APIs must declare `anonymousPolicy`. External HTTP must use
`ctx.http.fetch(...)`, `Permission.ExternalHttp`, and narrow `egress`.

## Validation Loop

Use the tight loop first:

```bash
npm run plugin:doctor -- plugins/<plugin-id>
```

If it fails, read the JSON and fix the first diagnostic with
`severity: "error"`. Prefer `file`, `path`, and `fix` over broad guessing.
Rerun the command after each repair.

Use broader gates only when needed:

```bash
npm run plugins:scan
npm run plugins:check
npm run test:real
npm run verify:runtime
```

## References

Load references only when they are relevant:

- `references/workflow.md`: template selection, file layout, creation loop.
- `references/plugin-contract.md`: `plugin.ts` contract patterns.
- `references/capabilities.md`: `ctx.*` capability to permission mapping.
- `references/diagnostics.md`: common `plugin:doctor` repair strategy.
- `references/prompt-template.md`: reusable prompt for asking an AI agent to
  build a PloyKit plugin.

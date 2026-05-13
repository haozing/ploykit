# AI-Assisted Plugin Development

PloyKit's plugin model is intentionally friendly to AI-assisted development. A
language model can work inside one plugin directory, edit a small set of
well-named files, rely on a typed contract, and converge through machine-readable
checks instead of needing to understand the whole host application.

This is different from `ctx.ai`. `ctx.ai` is the runtime capability that lets a
plugin call a host-provided model gateway. This document is about using AI tools
to author PloyKit plugins.

## Why The Model Works Well For LLMs

The codebase already has several AI-friendly properties.

| Property                | Code source                                                                             | Why it helps                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Single contract entry   | `plugins/<plugin-id>/plugin.ts`, `src/plugin-sdk/define-plugin.ts`                      | The model has one source of truth for routes, data, permissions, resources, jobs, events, webhooks, and egress.                               |
| Typed declarations      | `src/plugin-sdk/types.ts`, `src/plugin-sdk/context.ts`, `src/plugin-sdk/permissions.ts` | The model can follow explicit shapes instead of discovering host internals by trial and error.                                                |
| Strong diagnostics      | `src/plugin-sdk/validator.ts`, `src/plugin-sdk/diagnostics.ts`                          | Errors include code, path, message, and often a fix, which is ideal for iterative repair loops.                                               |
| Plugin-local boundaries | `src/lib/plugin-runtime/checks/plugin-check.ts`                                         | Checks discourage importing host internals, reading `process.env`, raw external `fetch()`, undeclared imports, and missing permissions.       |
| Capability injection    | `ctx.storage`, `ctx.files`, `ctx.runs`, `ctx.connectors`, `ctx.ai`, and others          | The model composes capabilities through a stable boundary rather than touching database, auth, billing, or storage internals.                 |
| Templates               | `templates/plugins/{tool,crud,dashboard,connector,service}`                             | The model can start from a known file layout and modify local files only.                                                                     |
| Fake host tests         | `src/plugin-sdk/testing.ts`                                                             | Plugin tests can exercise API handlers, storage, audit, usage, files, AI, RAG, runs, connectors, billing, and more without a full deployment. |
| JSON CLI loop           | `scripts/ploykit-plugin.ts`                                                             | `create`, `check`, `test`, `build`, `inspect`, and `dev` produce structured output that an AI agent can parse.                                |
| Generated runtime map   | `scripts/generate-plugin-map.ts`                                                        | The host can reconcile declarations into runtime state after plugin edits.                                                                    |

The short description:

```text
PloyKit is an AI-friendly plugin host: product intent becomes a typed plugin
contract, platform behavior is accessed through ctx capabilities, and generated
code is corrected through local templates plus machine-readable diagnostics.
```

## Recommended AI Development Loop

Use this loop when an AI coding assistant builds a plugin.

1. Choose the narrowest template.

```bash
npm run plugin:create -- invoice-helper --template tool
```

2. Edit `plugins/invoice-helper/plugin.ts` first.

Declare:

- plugin id, name, version, kind, trust level
- routes and menu entries
- storage collections
- permissions
- public API `anonymousPolicy`
- external HTTP `egress`
- jobs, events, webhooks, meters, resources, and lifecycle only when needed

3. Implement handlers and pages inside the plugin directory.

Rules:

- Use `@ploykit/plugin-sdk` and `@ploykit/plugin-sdk/react`.
- Use `ctx.*` capabilities for platform behavior.
- Keep all module paths plugin-local, such as `./api/run` or `./pages/ToolPage`.
- Do not import `src/lib/*`.
- Do not read `process.env`.
- Do not use raw external `fetch()`. Use `ctx.http.fetch(...)` and declare
  `Permission.ExternalHttp` plus `egress`.
- Do not access the database directly.

4. Add or update plugin tests.

Use `createPluginTestHost` and `testPlugin` from `@ploykit/plugin-sdk/testing`.
The fake host records capability calls, so tests can assert behavior without a
real database, billing provider, AI provider, or external service.

5. Run the tight plugin loop.

```bash
npm run plugin:doctor -- plugins/invoice-helper
npm run plugin:check -- plugins/invoice-helper
npm run plugin:test -- plugins/invoice-helper
npm run plugin:inspect -- plugins/invoice-helper
npm run plugin:build -- plugins/invoice-helper
```

6. Reconcile the host map when the contract changes.

```bash
npm run plugins:scan
```

7. Run broader gates only when the change crosses runtime boundaries.

```bash
npm run plugins:check
npm run test:real
npm run verify:runtime
```

## Prompt Shape For AI Agents

Use a prompt like this when asking an AI tool to implement a plugin:

```text
You are building a PloyKit plugin.

Goal:
- Build <feature description>.

Plugin:
- id: <lowercase-hyphen-id>
- template: <tool|crud|dashboard|connector|service>
- directory: plugins/<id>

Contract:
- pages:
- APIs:
- storage collections:
- required host capabilities:
- external origins:
- public/anonymous behavior:
- tests to add:

Rules:
- Work only inside plugins/<id> unless documentation changes are requested.
- Update plugin.ts first.
- Use @ploykit/plugin-sdk exports.
- Use ctx.* capabilities instead of host internals.
- Do not import src/lib/*, read process.env, access the database directly, or
  use raw external fetch().
- Add permissions that match ctx capability usage.
- Declare anonymousPolicy for public APIs.
- Declare egress for ctx.http.fetch origins.
- Add plugin tests with @ploykit/plugin-sdk/testing.
- After edits, run plugin:doctor for this plugin. If it fails, repair the first
  diagnostic and rerun.
```

## Support Added For AI Agents

This repository now includes a first pass of agent-facing support:

- `AGENTS.md` for repository-wide coding agent rules.
- `.github/copilot-instructions.md` for GitHub Copilot.
- template-local `AI_TASK.md` files under `templates/plugins/*`.
- `skills/ploykit-plugin-developer` as an optional open-source Codex skill for
  plugin authoring.
- `npm run plugin:doctor -- plugins/<plugin-id>` for the check/test/inspect JSON loop.
- [AI plugin quickstart](ai-plugin-quickstart.md).
- [Codex skill installation guide](codex-skill.md).
- [plugin diagnostics reference](plugin-diagnostics.md).
- [plugin capability and permission reference](plugin-capabilities.md).

## What To Add Next

These additions would make PloyKit even stronger for AI-assisted plugin
development.

| Priority | Support                                          | Purpose                                                                            |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| P1       | Export a machine-readable plugin contract schema | Let agents and editors validate `plugin.ts` shape before runtime loading.          |
| P1       | Add a machine-readable capability manifest       | Publish capability to permission mappings, examples, and safe usage notes as JSON. |
| P2       | Add generated examples from small PRDs           | Keep a few product-intent to plugin examples as regression fixtures for AI agents. |
| P2       | Add dev-console copy prompt action               | Let a developer copy failing diagnostics as an agent-ready repair prompt.          |

## Completed First Implementation Pack

The first high-value pack is now present:

1. `AGENTS.md` at the repo root with plugin authoring rules.
2. `docs/plugin-diagnostics.md` maintained from known diagnostic codes.
3. `docs/ai-assisted-plugin-development.md` and the Chinese counterpart.
4. `templates/plugins/*/AI_TASK.md` with template-specific constraints.
5. `npm run plugin:doctor -- plugins/<id>` as a stable JSON loop.
6. `docs/ai-plugin-quickstart.md` with a complete prompt and repair loop.
7. `skills/ploykit-plugin-developer` as a reusable Codex skill.

That pack would make the project easier for Codex, Copilot, Claude Code, Cursor,
and other coding agents to use without changing the runtime contract.

## Current Status

Already available:

- typed plugin contract through `definePlugin`
- typed API handler helper through `defineApi`
- typed `PluginContext`
- permission constants
- plugin templates
- plugin contract validation
- plugin-local static checks
- fake host plugin tests
- JSON output from plugin CLI commands
- `plugin:doctor` aggregated JSON loop
- runtime map generation
- repository and template agent instructions
- reusable Codex skill under `skills/ploykit-plugin-developer`
- plugin diagnostics and capability references

Recommended next changes:

- export a machine-readable plugin contract schema
- publish a JSON capability/permission manifest
- add generated PRD-to-plugin examples as regression fixtures

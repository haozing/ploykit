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
| npm dependency manifest | `plugins/<plugin-id>/plugin.dependencies.json`                                          | Plugins can explicitly declare host-installed UI or runtime npm packages; diagnostics reject missing, dev-only, or transitive-only packages.  |
| Capability injection    | `ctx.storage`, `ctx.files`, `ctx.runs`, `ctx.connectors`, `ctx.ai`, and others          | The model composes capabilities through a stable boundary rather than touching database, auth, billing, or storage internals.                 |
| Templates               | `templates/plugins/{tool,crud,dashboard,connector,service}`                             | The model can start from a known file layout and modify local files only.                                                                     |
| Fake host tests         | `src/plugin-sdk/testing.ts`                                                             | Plugin tests can exercise API handlers, storage, audit, usage, files, AI, RAG, runs, connectors, billing, and more without a full deployment. |
| JSON CLI loop           | `scripts/ploykit-plugin.ts`                                                             | `create`, `check`, `test`, `build`, `inspect`, and `dev` produce structured output that an AI agent can parse.                                |
| Generated runtime map   | `scripts/generate-plugin-map.ts`                                                        | The host can reconcile declarations into runtime state; product shells can use `--runtime-only` for active runtime artifacts.                 |

The short description:

```text
PloyKit is an AI-friendly plugin host: product intent becomes a typed plugin
contract, platform behavior is accessed through ctx capabilities, and generated
code is corrected through local templates plus machine-readable diagnostics.
```

## Recommended AI Development Loop

Use this loop when an AI coding assistant builds a plugin.

0. Install and enable the repository skills first.

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/* "${CODEX_HOME:-$HOME/.codex}/skills/"
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Get-ChildItem -Path "skills" -Directory | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination "$env:USERPROFILE\.codex\skills" -Recurse -Force
}
```

Then start a new Codex session. Use `$ploykit-plugin-developer` while authoring
plugins, and `$ploykit-plugin-tester` for real API, page screenshot, and locale
validation.

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
- If the plugin needs npm UI or runtime packages, add them to
  `plugin.dependencies.json` and make sure the host root `package.json` lists
  them as runtime dependencies.
- Prefer host `ctx.*` capabilities for model providers, database drivers,
  credentialed external services, and complex domain abilities instead of
  ordinary plugin imports.

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

For external product shells that should not touch committed host map files, set
`PLOYKIT_PLUGIN_DIRS` and use:

```bash
npm run plugins:scan:runtime
```

7. Run broader gates only when the change crosses runtime boundaries.

```bash
npm run plugins:check
npm run plugins:check:runtime
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
- Install the Codex Skills from the repository skills directory before starting;
  use $ploykit-plugin-developer for development and $ploykit-plugin-tester for
  validation.
- Work only inside plugins/<id> unless documentation changes are requested.
- Update plugin.ts first.
- Use @ploykit/plugin-sdk exports.
- Use ctx.* capabilities instead of host internals.
- Do not import src/lib/*, read process.env, access the database directly, or
  use raw external fetch().
- Add permissions that match ctx capability usage.
- Declare anonymousPolicy for public APIs.
- Declare egress for ctx.http.fetch origins.
- Declare external npm packages in plugin.dependencies.json and require the host
  package.json runtime dependencies to list the same packages.
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
- `skills/ploykit-plugin-tester` as an optional Codex skill for layered
  code-level, real API, and browser screenshot plugin validation.
- `npm run plugin:doctor -- plugins/<plugin-id>` for the check/test/inspect JSON loop.
- [AI plugin quickstart](ai-plugin-quickstart.md).
- [Codex skill installation guide](codex-skill.md).
- [plugin diagnostics reference](plugin-diagnostics.md).
- [plugin capability and permission reference](plugin-capabilities.md).

## Related Docs

- [AI plugin quickstart](ai-plugin-quickstart.md)
- [Codex skill installation guide](codex-skill.md)
- [Plugin diagnostics reference](plugin-diagnostics.md)
- [Plugin capability and permission reference](plugin-capabilities.md)

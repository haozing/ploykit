# Codex Skills For PloyKit Plugins

PloyKit ships optional Codex skills that turn plugin development, testing, and
diagnostic conventions into reusable AI workflows. Before an AI agent starts
plugin development or validation, install the repository `skills/` directory
into the local Codex skills directory.

## Repository Skills

| Skill                                                                   | Use                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`skills/ploykit-plugin-developer`](../skills/ploykit-plugin-developer) | Create, modify, review, and debug PloyKit plugins.                                                                   |
| [`skills/ploykit-plugin-tester`](../skills/ploykit-plugin-tester)       | Validate plugins and plugin-sensitive host changes through code-level, real API, and real browser screenshot layers. |

## Developer Skill Coverage

- Choosing the right plugin template.
- Editing `plugin.ts` before implementation files.
- Keeping work inside `plugins/<plugin-id>/`.
- Mapping `ctx.*` capability usage to `Permission.*` declarations.
- Maintaining `plugin.dependencies.json` for npm UI or runtime packages and
  requiring matching host root `package.json` runtime dependencies.
- Adding fake-host tests with `@ploykit/plugin-sdk/testing`.
- Running and repairing through `npm run plugin:doctor -- plugins/<plugin-id>`.
- Reusing a prompt shape for plugin tasks.

## Tester Skill Coverage

- Run code-level checks, plugin contract checks, and fake-host tests first.
- Request plugin APIs against a real local app, including guest, authenticated,
  invalid payload, disabled, and uninstall states.
- Open pages in a browser, capture screenshots, and inspect them for locale,
  SEO, menu, host page slot or override, console/network, and layout issues.
- Produce an evidence report with commands, API results, screenshot paths, and
  skipped items.

## Install Locally

Copy every repository skill into a Codex skills directory:

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

Then start a new Codex session and invoke it explicitly:

```text
Use $ploykit-plugin-developer to build a PloyKit plugin named invoice-helper.
Use $ploykit-plugin-tester to fully validate plugins/invoice-helper.
```

## Skill Layout

```text
skills/ploykit-plugin-developer/
|-- SKILL.md
|-- agents/
|   `-- openai.yaml
`-- references/
    |-- workflow.md
    |-- plugin-contract.md
    |-- capabilities.md
    |-- diagnostics.md
    `-- prompt-template.md

skills/ploykit-plugin-tester/
|-- SKILL.md
|-- agents/
|   `-- openai.yaml
`-- references/
    |-- code-level.md
    |-- real-api.md
    |-- browser-visual.md
    `-- reporting.md
```

`SKILL.md` contains the compact workflow. The reference files are loaded only
when needed, so the skill remains usable without flooding the model context.

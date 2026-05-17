# Codex Skill For PloyKit Plugins

PloyKit ships an optional Codex skill at
[`skills/ploykit-plugin-developer`](../skills/ploykit-plugin-developer). It
turns the plugin development conventions into a reusable AI workflow that can be
installed alongside Codex.

## What It Covers

- Choosing the right plugin template.
- Editing `plugin.ts` before implementation files.
- Keeping work inside `plugins/<plugin-id>/`.
- Mapping `ctx.*` capability usage to `Permission.*` declarations.
- Maintaining `plugin.dependencies.json` for npm UI or runtime packages and
  requiring matching host root `package.json` runtime dependencies.
- Adding fake-host tests with `@ploykit/plugin-sdk/testing`.
- Running and repairing through `npm run plugin:doctor -- plugins/<plugin-id>`.
- Reusing a prompt shape for plugin tasks.

## Install Locally

Copy the skill folder into a Codex skills directory:

```bash
mkdir -p ~/.codex/skills
cp -R skills/ploykit-plugin-developer ~/.codex/skills/
```

On Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills"
Copy-Item -Recurse -Force "skills\ploykit-plugin-developer" "$env:USERPROFILE\.codex\skills\"
```

Then start a new Codex session and invoke it explicitly:

```text
Use $ploykit-plugin-developer to build a PloyKit plugin named invoice-helper.
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
```

`SKILL.md` contains the compact workflow. The reference files are loaded only
when needed, so the skill remains usable without flooding the model context.

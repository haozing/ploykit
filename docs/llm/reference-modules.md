# Reference Modules

Use these sources when an LLM needs a known-good example. The repository keeps only current-contract module fixtures under `modules/`.

## Templates

| Need | Source | Use When |
| --- | --- | --- |
| Ordinary app | `templates/modules/app/module.ts` | A dashboard page, action, and API are enough. |
| CRUD/resource module | `templates/modules/resource/module.ts` | The module owns workspace-scoped business records through Data v2. |
| Public tool | `templates/modules/tool/module.ts` | The module exposes a public site page and anonymous API. |
| Connector | `templates/modules/connector/module.ts` | The module connects to an external system through declared host capabilities. |

## Checked-In Fixtures

| Module | What It Proves |
| --- | --- |
| `modules/platform-smoke` | Dashboard page, API, action, job, event, webhook, lifecycle, surface, and navigation. |
| `modules/resource-smoke` | Runtime schema, business resource, Data v2 storage, list/create/edit/detail pages, API, action, generated data artifacts, and migration. |
| `modules/public-tool-smoke` | Public site page, metadata loader, cache policy, public alias, anonymous API, action, and site navigation. |

## Copy Rules

- Start new modules from templates, not from host code.
- Read the fixture `module.ts` first, then copy only the specific pattern needed.
- Keep static assets in `assets`, business resources in `resources`, pages in `pages`, and APIs in `apis`.
- Run `npm run modules:scan`, `npm run module:doctor -- <id>`, and `npm run module:test -- <id> --summary` after adapting a pattern.

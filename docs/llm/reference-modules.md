# Reference Modules

Use these modules as living examples. They are checked by `npm run modules:check`; do not copy from legacy narrative docs first.

## Golden Sample Decision

Plan route B is selected. `modules/capability-demo/` is the primary golden sample because it is small enough to imitate and currently passes both `npm run module:doctor -- capability-demo` and `npm run module:test -- capability-demo --summary`.

No underscore-named reference module is created because the current module id validator accepts only lowercase letters, numbers, and hyphens. A literal underscore reference id would violate `MODULE_ID_PATTERN`.

| Need | Reference | Why |
| --- | --- | --- |
| Primary golden sample | `modules/capability-demo/module.ts` | Data v2, files, jobs, events, webhooks, AI/RAG, metering, credits, notifications |
| Workspace/product Data v2 and public pages | `modules/cms-demo/module.ts` | Product-scoped posts, workspace notes, site route metadata/cache, dashboard routes |
| White-label shell and host surfaces | `modules/white-label-site-demo/module.ts` | `presentation`, `navigation`, `surfaces`, i18n, theme, host page replacement |
| Signed service-backed shape | `docs/llm/recipes/service-backed.md` | `contractVersion: 2`, `serviceRequirements`, controlled service calls |

Rules:

- Copy contract shape first, then code shape.
- Keep edits inside the new module unless the user asked for host work.
- Run `npm run module:doctor -- <id>` and `npm run module:test -- <id> --summary` after adapting any pattern.

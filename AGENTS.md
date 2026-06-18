# ploykit Module Authoring Rules

This repository is a host + module system. When building a product module with an LLM, treat this file as the always-on entry point.

## Scope

- Only edit the target module under `modules/<id>/` unless the user explicitly asks for host work.
- Do not change `apps/host-next/*`, `src/lib/module-runtime/*`, `src/module-sdk/*`, or host scripts to make one module pass.
- `module.ts` is the contract center: declare permissions, data, routes, actions, jobs, service requirements, navigation, surfaces, and presentation before relying on them in code.

## Loop

1. Create or choose `modules/<id>/`.
2. Declare the contract in `module.ts`.
3. Implement handlers, loaders, pages, tests, and fixtures inside the module.
4. Run `npm run modules:scan`.
5. Run `npm run module:doctor -- <id>` and fix the first error before moving on.
6. Run `npm run module:test -- <id> --summary`.

## Iron Rules

- Host owns the shell: use host navigation, chrome, surfaces, and presentation metadata. See [host-vs-module](docs/llm/concepts/host-vs-module.md) and [white-label-page](docs/llm/recipes/white-label-page.md).
- Tenancy is scope: use Data v2 scopes and `ctx.scope`, not ad hoc tenant columns or sessions. See [scope-and-tenancy](docs/llm/concepts/scope-and-tenancy.md) and [multi-tenant-crud](docs/llm/recipes/multi-tenant-crud.md).
- Commercial facts belong to host primitives: use `ctx.metering`, `ctx.credits`, `ctx.entitlements`, and `ctx.commerce`. See [commercial-integrity](docs/llm/concepts/commercial-integrity.md) and [billing-charge](docs/llm/recipes/billing-charge.md).
- External services are contract-first: declare `serviceRequirements` and call `ctx.services.invoke`. See [service-contract-first](docs/llm/concepts/service-contract-first.md) and [service-backed](docs/llm/recipes/service-backed.md).
- Never fake platform state. If the host lacks a needed capability, report the missing extension point instead of hardcoding text, mock balances, mock sessions, or pretend integrations.

## Where To Read

- Start with [docs/llm/index.md](docs/llm/index.md).
- Capability facts: [docs/llm/capabilities.generated.md](docs/llm/capabilities.generated.md).
- "I want to do X" mapping: [docs/llm/capability-usage.md](docs/llm/capability-usage.md).
- `module.ts` fields: [docs/llm/contract.generated.md](docs/llm/contract.generated.md).
- Platform error codes: [docs/llm/errors.generated.md](docs/llm/errors.generated.md).

## Legacy Docs

Old `docs/*.zh-CN.md` files are for humans and may contain older narrative. For LLM module authoring, prefer this file and `docs/llm/` as the fact surface.

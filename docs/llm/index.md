# LLM Module Wiki

This wiki is for LLMs writing ploykit modules. It is self-contained and uses the current module contract as its fact surface.

## First Read

1. Read `AGENTS.md`.
2. Pick the task below.
3. Read the linked recipe and only then inspect example modules.
4. After editing, run `npm run modules:scan`, `npm run module:doctor -- <id>`, and `npm run module:test -- <id> --summary`.

## Task Router

| I need to | Read |
| --- | --- |
| Find the right host capability | [capability-usage.md](capability-usage.md), then [capabilities.generated.md](capabilities.generated.md) |
| Fill `module.ts` correctly | [contract.generated.md](contract.generated.md) |
| Build multi-tenant CRUD | [recipes/multi-tenant-crud.md](recipes/multi-tenant-crud.md) |
| Charge or reserve credits | [recipes/billing-charge.md](recipes/billing-charge.md) |
| Connect a controlled external service | [recipes/service-backed.md](recipes/service-backed.md) |
| Replace or contribute host pages | [recipes/white-label-page.md](recipes/white-label-page.md) |
| Add background jobs | [recipes/background-job.md](recipes/background-job.md) |
| Add a public page | [recipes/public-page.md](recipes/public-page.md) |
| Understand host/module shell boundary | [concepts/host-vs-module.md](concepts/host-vs-module.md) |
| Understand scope and tenancy | [concepts/scope-and-tenancy.md](concepts/scope-and-tenancy.md) |
| Understand commercial authority | [concepts/commercial-integrity.md](concepts/commercial-integrity.md) |
| Understand service contract-first | [concepts/service-contract-first.md](concepts/service-contract-first.md) |
| Decode platform errors | [errors.generated.md](errors.generated.md) |
| Copy from known-good modules | [reference-modules.md](reference-modules.md) |

## Source Boundary

`.generated.md` files are generated from code and must not be hand edited. Handwritten pages carry judgment and anti-patterns; their `ctx.*`, `Permission.*`, commands, and links are checked by `npm run llm-wiki:check`.

## Other Docs Policy

Other `docs/*.zh-CN.md` files may remain for human background, but LLM module authoring should use `AGENTS.md` and `docs/llm/` as the active fact surface.

## Effect Check

Use [llm-effect-evaluation.md](llm-effect-evaluation.md) and [evaluation-runs.md](evaluation-runs.md) before and after major wiki changes to prove whether LLM behavior actually improved.

# PloyKit Single-Version Clean-Slate Migration

Date: 2026-06-27

This document is the destructive migration specification for PloyKit's single current module architecture. The repository should expose one contract shape, one runtime normalization path, one module fixture model, and one LLM authoring surface. Old module data and old module contracts are removed rather than adapted.

## Final Decision

PloyKit has one module contract.

- Module authors do not choose a contract generation.
- Module authors do not declare route trees.
- Static files live only in `assets`.
- Business resources live only in `resources`.
- Pages live only in `pages`.
- APIs live only in `apis`.
- Runtime route manifests are derived products, not authoring input.
- Module pages render TSX/React.
- Public pages declare metadata, cache, aliases, and public aliases directly on page entries.
- Controlled service access uses `serviceRequirements`.
- Jobs, events, webhooks, lifecycle, navigation, and surfaces remain first-class contract fields.

## Current Contract Shape

```ts
export interface ModuleDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  product?: ModuleProductDefinition;
  parts?: ModuleContractPartsDefinition;
  permissions?: readonly PermissionValue[];
  scope?: ModuleScopeDefinition;
  data?: ModuleDataDefinition;
  pages?: readonly ModulePageDefinition[];
  apis?: readonly ModuleApiDefinitionContract[];
  navigation?: ModuleNavigationItem | readonly ModuleNavigationItem[];
  surfaces?: Record<string, ModuleSurfaceDefinition>;
  assets?: ModuleAssetsDefinition;
  resources?: Record<string, ModuleResourceDefinition>;
  i18n?: ModuleI18nDefinition;
  presentation?: ModulePresentationDefinition;
  theme?: ModuleThemeDefinition;
  meters?: Record<string, ModuleMeterDefinition>;
  serviceRequirements?: Record<string, ModuleServiceRequirementDefinition>;
  resourceBindings?: Record<string, ModuleResourceBindingRequirement>;
  config?: Record<string, ModuleConfigFieldDefinition>;
  actions?: Record<string, ModuleActionDefinition>;
  jobs?: Record<string, ModuleJobDefinition>;
  events?: ModuleEventsDefinition;
  webhooks?: Record<string, ModuleWebhookDefinition>;
  head?: ModuleHeadDefinition;
  lifecycle?: ModuleLifecycleDefinition;
  dependencies?: ModuleDependenciesDefinition;
  egress?: readonly string[];
  quality?: ModuleQualityDefinition;
}
```

## Migration Rules

| Area | Rule |
| --- | --- |
| SDK types | The public module type contains only the current fields above. Removed fields are rejected by validation when present in untyped input. |
| Validation | Contract validation always applies the current rules. Pages, APIs, resources, actions, services, assets, and presentation are validated without generation gates. |
| Runtime normalization | Runtime contracts are normalized from `pages`, `apis`, `assets`, and business `resources`. Route entries are generated internally from pages and APIs. |
| Rendering | Host page rendering expects TSX/React output. Object-shaped page fallbacks are not part of the module page path. |
| Static resources | Static locales, icons, workers, WASM, and files are loaded from `assets`. |
| Data | Resource and table facts are generated from Data v2 declarations and runtime schema. |
| Templates | The ordinary templates are `app`, `resource`, `tool`, and `connector`. |
| Checked-in modules | The repo keeps focused smoke modules only: `platform-smoke`, `resource-smoke`, and `public-tool-smoke`. |
| Docs | LLM docs teach only the current contract, templates, capabilities, recipes, errors, and current fixtures. |

## Implementation Batches

### 1. Replace Module Fixtures

Keep focused modules that exercise the architecture without becoming product demos:

- `modules/platform-smoke`: dashboard page, API, action, job, event, webhook, lifecycle, surface, and navigation.
- `modules/resource-smoke`: schema, business resource, Data v2 documents/tables, CRUD pages, API, action, generated data plan/types/OpenAPI, and migration.
- `modules/public-tool-smoke`: public site page, metadata loader, cache, public alias, public API, action, and site navigation.

Delete broad demo modules and any generated data tied only to those modules.

### 2. Collapse SDK Authoring Surface

Required edits:

- `src/module-sdk/types.ts` exposes only the current `ModuleDefinition`.
- `src/module-sdk/validator.ts` rejects removed fields and runs current validation unconditionally.
- `src/module-sdk/validator-clean-contract.ts` enforces current pages, APIs, resources, assets, action schemas, public page metadata/cache, service policies, and permission coupling.
- `src/module-sdk/validator-resources.ts` reads static files only from `assets`.
- `src/module-sdk/validator-presentation.ts` reads presentation locales only from `assets.locales`.
- `src/module-sdk/validator-service-requirements.ts` validates service operation policy without a generation branch.

Delete route-tree validator code that only exists for removed authoring input.

### 3. Collapse Runtime Shape

Required edits:

- `src/lib/module-runtime/contract/normalize-contract.ts` derives runtime facts only from current contract fields.
- `src/lib/module-runtime/contract/types.ts` does not expose removed authoring fields.
- `src/lib/module-runtime/routes/route-manifest.ts` builds internal route entries from pages and APIs.
- Catalog, packaging, dev console, capability summaries, admin operation models, and module bundle metadata consume `pages`, `apis`, `assets`, and business `resources`.
- Host dashboard, admin, and site renderers use strict React output.

### 4. Simplify CLI And Generators

Required edits:

- `scripts/generate-module-map.mjs` scans pages, APIs, assets, current resources, and focused handlers only.
- `scripts/module-test.mjs` always validates strict TSX page output.
- `scripts/ploykit-module.mjs` inspect output reports current contract facts only.
- `scripts/i18n-check.ts` reads locales from `assets.locales`.
- `scripts/generate-llm-wiki.mjs` generates current contract docs with no removed authoring fields.

### 5. Rewrite Tests

Tests should prove the current architecture:

- Contract tests reject removed fields and validate current pages/APIs/resources.
- Doctor tests diagnose current contract mistakes and current module source boundaries.
- Host runtime tests resolve pages/APIs through generated route manifests.
- Web shell tests use the three focused smoke modules.
- Data tests use the current resource smoke module.
- Release and developer-experience tests scan for current SDK, templates, and module behavior.

### 6. Rewrite LLM Docs

The active LLM surface is:

- `docs/llm/index.md`
- `docs/llm/capability-usage.md`
- `docs/llm/capabilities.generated.md`
- `docs/llm/contract.generated.md`
- `docs/llm/errors.generated.md`
- `docs/llm/reference-modules.md`
- `docs/llm/concepts/*`
- `docs/llm/recipes/*`

These docs must describe current authoring only. They should not teach removed fields, removed module ids, old route trees, static resources under `resources`, or adaptation paths.

## Verification Commands

Run after code or docs changes:

```bash
npm run modules:scan
npm run llm-wiki:generate
npm run typecheck
npm run test:module-contract
npm run test:module-doctor
npm run test:developer-experience
npm run test:host-runtime
npm run test:security-runtime
npm run test:web-shell
npm run modules:check
```

Run Data v2 checks when `resource-smoke` changes:

```bash
npm run data:generate -- modules/resource-smoke
npm run data:types -- modules/resource-smoke
npm run data:verify -- --module resource-smoke
npm run test:data-runtime
```

Run module-local checks for the focused fixtures:

```bash
npm run module:doctor -- platform-smoke
npm run module:doctor -- resource-smoke
npm run module:doctor -- public-tool-smoke
npm run module:test -- platform-smoke --summary
npm run module:test -- resource-smoke --summary
npm run module:test -- public-tool-smoke --summary
```

## Residual Scan

These searches should not find active authoring guidance for removed shapes. Use fixed-string scans for removed version fields, route-tree fields, and static-resource fields under `resources`; keep any matches limited to validator rejection tests.

```bash
rg -n "routes\\.site|routes\\.dashboard|routes\\.admin|routes\\.api" docs/llm src/module-sdk scripts modules templates
rg -n "resources\\.locales|resources\\.icons|resources\\.assets" docs/llm src/module-sdk scripts modules templates
```

Code may still contain rejection tests for removed fields. Those tests are allowed when they prove the current validator refuses old input.

## Acceptance Criteria

The migration is complete when all are true:

1. Public SDK types expose only the current module contract.
2. Current validators reject removed authoring fields.
3. Static assets are loaded from `assets`.
4. Business resources are loaded from `resources`.
5. Runtime route entries are derived only from `pages` and `apis`.
6. Page rendering requires TSX/React output.
7. Checked-in modules are focused current-contract fixtures.
8. Templates only scaffold current-contract modules.
9. LLM docs teach only current authoring.
10. Generated module map and generated LLM docs are up to date.
11. Key runtime, web shell, doctor, contract, and module tests pass.

## Final Recommendation

Keep the single-version direction. It makes the framework easier for humans and LLMs because the wrong shape is not a supported option. The clean architecture is stricter, smaller, and easier to repair: authors declare product facts in `module.ts`, the host derives runtime manifests, and validation catches divergence before modules reach the Web Shell.

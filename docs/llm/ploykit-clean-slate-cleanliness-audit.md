# PloyKit Clean-Slate Cleanliness Audit

Date: 2026-06-27

This audit checks whether PloyKit now behaves like a single-contract framework rather than a framework with multiple authoring lanes.

## Executive Judgment

The desired architecture is clean when these facts remain true:

- Public SDK types expose one current `ModuleDefinition`.
- Removed authoring fields are rejected instead of normalized.
- Runtime manifests are derived from `pages` and `apis`.
- Static files are read from `assets`.
- Business resources are read from `resources`.
- Module pages render TSX/React output.
- Checked-in modules are focused fixtures, not broad product demos.
- LLM docs teach templates, current fixtures, capabilities, recipes, and platform errors only.

## Current Single-Contract Surface

| Surface | Current Rule |
| --- | --- |
| `src/module-sdk/types.ts` | Defines the single public module contract. |
| `src/module-sdk/validator.ts` | Rejects removed fields and runs current validation. |
| `src/module-sdk/validator-clean-contract.ts` | Validates pages, APIs, resources, assets, schemas, action I/O, service policies, and public page metadata/cache. |
| `src/lib/module-runtime/contract/normalize-contract.ts` | Normalizes from current fields only. |
| `src/lib/module-runtime/routes/route-manifest.ts` | Derives runtime route entries from `pages` and `apis`. |
| `scripts/generate-module-map.mjs` | Scans current fields and focused handlers. |
| `scripts/module-test.mjs` | Enforces strict module page rendering. |
| `docs/llm/reference-modules.md` | Points to templates and the three current fixtures. |

## Maintained Fixtures

| Fixture | Cleanliness Value |
| --- | --- |
| `modules/platform-smoke` | Exercises host runtime capabilities without becoming a product demo. |
| `modules/resource-smoke` | Proves Data v2, resources, schemas, pages, APIs, actions, and generated artifacts. |
| `modules/public-tool-smoke` | Proves public page metadata/cache/alias, anonymous API policy, and public navigation. |

## Removed Design Pressure

The clean version intentionally does not keep these as framework goals:

- route-tree authoring
- static resources under `resources`
- object-shaped page output
- broad demo modules as reference material
- template overlays
- external runner adapters not required by host primitives
- ecosystem adapters that do not simplify current PloyKit module authoring

## Verification Standard

Before calling the migration complete, use current evidence:

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

Run targeted module checks:

```bash
npm run module:doctor -- platform-smoke
npm run module:doctor -- resource-smoke
npm run module:doctor -- public-tool-smoke
npm run module:test -- platform-smoke --summary
npm run module:test -- resource-smoke --summary
npm run module:test -- public-tool-smoke --summary
```

## Audit Conclusion

The architecture is clean only if old shapes stay impossible to author and impossible to learn from active docs. The current target is not a transitional model; it is the product architecture. New work should make the single contract stricter, clearer, and easier to validate rather than widening the authoring surface.

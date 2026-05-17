# Plugin Diagnostics Reference

Plugin diagnostics are designed to be machine-readable. AI agents should repair
errors by reading `code`, `file`, `path`, `message`, and `fix`, then rerun
`npm run plugin:doctor -- plugins/<plugin-id>`.

## Repair Loop

1. Fix the first `severity: "error"` diagnostic.
2. Prefer the diagnostic `path` over broad search.
3. Apply the diagnostic `fix` when present.
4. Rerun `npm run plugin:doctor -- plugins/<plugin-id>`.
5. Repeat until `success: true`.

## Common Diagnostic Families

| Family                      | Examples                                                                                                                                               | Meaning                                                                                               | Typical fix                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Identity                    | `PLUGIN_ID_INVALID`, `PLUGIN_ID_MISMATCH`, `PLUGIN_VERSION_INVALID`                                                                                    | Plugin identity does not match contract rules or directory name.                                      | Use a lowercase hyphen id, match the directory name, and use semver.                                             |
| Contract shape              | `PLUGIN_NAME_REQUIRED`, `PLUGIN_KIND_INVALID`, `PLUGIN_TRUST_LEVEL_INVALID`                                                                            | `plugin.ts` contains an invalid declaration.                                                          | Use supported SDK values from `@ploykit/plugin-sdk`.                                                             |
| Paths                       | `PLUGIN_MODULE_PATH_INVALID`, `PLUGIN_MODULE_PATH_ESCAPES_ROOT`, `PLUGIN_PATH_NOT_ABSOLUTE`, `PLUGIN_ROUTE_PATH_NOT_LOCAL`                             | A route, handler, page, asset, or module path is malformed.                                           | Use plugin-local `./` module paths and local route paths such as `/` or `/items`.                                |
| Routes                      | `PLUGIN_ROUTE_DUPLICATE`, `PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT`, `PLUGIN_RUNTIME_API_ROUTE_CONFLICT`, `PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT`           | Route declarations overlap or conflict.                                                               | Rename one route or make dynamic segments unambiguous.                                                           |
| Public APIs                 | `PLUGIN_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED`, `PLUGIN_ANONYMOUS_RATE_LIMIT_INVALID`, `PLUGIN_ANONYMOUS_CAPTCHA_INVALID`                               | A public route is missing anonymous policy or has invalid policy fields.                              | Add `anonymousPolicy` with rate limit, captcha, upload, and high-cost settings.                                  |
| SEO/tool routes             | `PLUGIN_TOOL_SEO_REQUIRED`, `PLUGIN_TOOL_SEO_TITLE_REQUIRED`, `PLUGIN_TOOL_SEO_DESCRIPTION_REQUIRED`, `PLUGIN_TOOL_SEO_CANONICAL_REQUIRED`             | Public tool route metadata is incomplete.                                                             | Add title, description, canonical, robots, sitemap, and cache metadata as needed.                                |
| Permissions                 | `PLUGIN_PERMISSION_UNKNOWN`, `PLUGIN_ROUTE_PERMISSION_UNDECLARED`, `PLUGIN_CAPABILITY_PERMISSION_MISSING`, `PLUGIN_PERMISSION_UNUSED`                  | Declared permissions do not match capability usage.                                                   | Add or remove `Permission.*` values in `plugin.ts`.                                                              |
| Imports                     | `PLUGIN_IMPORT_FORBIDDEN`, `PLUGIN_IMPORT_EXTERNAL_UNDECLARED`, `PLUGIN_NODE_IMPORT_FORBIDDEN`, `PLUGIN_IMPORT_NOT_FOUND`                              | Plugin source imports host internals, undeclared external packages, Node builtins, or missing files.  | Use SDK imports, local files, React, or declare allowed externals in `plugin.dependencies.json`.                 |
| External npm dependencies   | `PLUGIN_DEPENDENCY_MANIFEST_INVALID`, `PLUGIN_DEPENDENCY_NOT_INSTALLED`, `PLUGIN_DEPENDENCY_NOT_DECLARED_BY_HOST`                                      | The plugin dependency manifest is invalid or a dependency is not installed as a host runtime package. | Fix `plugin.dependencies.json`; add the package to host root `package.json` runtime dependencies and install it. |
| Environment and unsafe code | `PLUGIN_PROCESS_ENV_FORBIDDEN`, `PLUGIN_EVAL_FORBIDDEN`, `PLUGIN_FUNCTION_FORBIDDEN`                                                                   | Plugin code bypasses host boundaries or executes dynamic code.                                        | Use `ctx.config`, `ctx.secrets`, and explicit handler code.                                                      |
| External HTTP               | `PLUGIN_EXTERNAL_FETCH_FORBIDDEN`, `PLUGIN_EGRESS_REQUIRED_FOR_HTTP`, `PLUGIN_EGRESS_ORIGIN_MISSING`, `PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED`           | Plugin uses external network access without the host egress boundary.                                 | Use `ctx.http.fetch(...)`, add `Permission.ExternalHttp`, and declare narrow `egress` origins.                   |
| Data collections            | `PLUGIN_COLLECTION_NAME_INVALID`, `PLUGIN_COLLECTION_FIELDS_REQUIRED`, `PLUGIN_COLLECTION_FIELD_TYPE_INVALID`, `PLUGIN_COLLECTION_INDEX_FIELD_UNKNOWN` | Structured storage declaration is invalid.                                                            | Use lowercase collection/field names and supported field types.                                                  |
| Assets                      | `PLUGIN_ASSET_PATH_INVALID`, `PLUGIN_ASSET_FILE_NOT_FOUND`, `PLUGIN_ASSET_SIZE_EXCEEDED`, `PLUGIN_ASSET_WORKER_DECLARATION_REQUIRED`                   | Plugin assets are outside `assets/`, missing, too large, or need explicit kind.                       | Move assets under `assets/` and declare worker/wasm assets explicitly.                                           |
| Jobs/events/webhooks        | `PLUGIN_JOB_PERMISSION_MISSING`, `PLUGIN_EVENT_EMIT_PERMISSION_MISSING`, `PLUGIN_WEBHOOK_PERMISSION_MISSING`, `PLUGIN_*_HANDLER_NOT_FOUND`             | Runtime declarations need permissions or handler files.                                               | Add matching permissions and create the declared handler files.                                                  |
| Menus/slots/theme           | `PLUGIN_MENU_ROUTE_UNKNOWN`, `PLUGIN_SLOT_NAME_INVALID`, `PLUGIN_THEME_TOKEN_UNKNOWN`                                                                  | UI extension declarations point at unknown routes, slots, or theme tokens.                            | Use declared page routes, valid slot names, and supported theme token sections.                                  |
| Commercial/meters           | `PLUGIN_METER_NAMESPACE_INVALID`, `PLUGIN_METER_UNIT_INVALID`, `PLUGIN_ROUTE_LICENSE_INVALID`, `PLUGIN_ROUTE_PLAN_INVALID`                             | Metering or commercial route metadata is invalid.                                                     | Namespace meters with `<plugin-id>.`, declare units, and keep commercial metadata non-empty.                     |

## Agent Notes

- Treat warnings as cleanup after all errors are fixed.
- `PLUGIN_PERMISSION_UNUSED` is usually safe to fix by removing the permission,
  unless the permission is intentionally reserved for a dynamic path.
- `PLUGIN_EGRESS_DYNAMIC_URL_UNVERIFIED` means static analysis cannot prove the
  URL. Keep `egress` narrow and add runtime tests.
- `PLUGIN_IMPORT_EXTERNAL_UNDECLARED` can be fixed by avoiding the dependency or
  declaring it in `plugin.dependencies.json`; once declared, the package must
  still exist in the host root `package.json` `dependencies` or
  `optionalDependencies`.
- `PLUGIN_DEPENDENCY_NOT_DECLARED_BY_HOST` means the package may only be a dev or
  transitive dependency. Plugin runtime code must not depend on that accidental
  resolution state.
- `PLUGIN_CAPABILITY_DYNAMIC_ACCESS_UNVERIFIED` usually means code uses
  `ctx[someKey]`. Prefer static `ctx.storage`, `ctx.files`, and similar access.

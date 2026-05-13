# PloyKit Plugin Diagnostics

`npm run plugin:doctor -- plugins/<plugin-id>` returns JSON designed for agent
repair loops.

## Repair Loop

1. Fix the first diagnostic with `severity: "error"`.
2. Prefer the diagnostic `file`, `path`, and `fix`.
3. Keep the change as local as possible.
4. Rerun `npm run plugin:doctor -- plugins/<plugin-id>`.
5. Repeat until `success: true`.

## Common Families

| Family           | Example codes                                                                                  | Typical fix                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Identity         | `PLUGIN_ID_INVALID`, `PLUGIN_ID_MISMATCH`, `PLUGIN_VERSION_INVALID`                            | Use lowercase hyphen id, match directory, use semver.           |
| Contract shape   | `PLUGIN_NAME_REQUIRED`, `PLUGIN_KIND_INVALID`, `PLUGIN_TRUST_LEVEL_INVALID`                    | Use supported SDK values in `plugin.ts`.                        |
| Paths            | `PLUGIN_MODULE_PATH_INVALID`, `PLUGIN_MODULE_PATH_ESCAPES_ROOT`, `PLUGIN_IMPORT_NOT_FOUND`     | Use plugin-local `./` module paths and create missing files.    |
| Public APIs      | `PLUGIN_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED`                                                  | Add `anonymousPolicy` with rate limit and captcha behavior.     |
| Permissions      | `PLUGIN_CAPABILITY_PERMISSION_MISSING`, `PLUGIN_PERMISSION_UNUSED`                             | Add or remove matching `Permission.*` values.                   |
| Imports          | `PLUGIN_IMPORT_FORBIDDEN`, `PLUGIN_IMPORT_EXTERNAL_UNDECLARED`, `PLUGIN_NODE_IMPORT_FORBIDDEN` | Use SDK/local imports or declare allowed external dependencies. |
| Environment      | `PLUGIN_PROCESS_ENV_FORBIDDEN`                                                                 | Use `ctx.config` or `ctx.secrets`.                              |
| External HTTP    | `PLUGIN_EXTERNAL_FETCH_FORBIDDEN`, `PLUGIN_EGRESS_REQUIRED_FOR_HTTP`                           | Use `ctx.http.fetch`, `Permission.ExternalHttp`, and `egress`.  |
| Data collections | `PLUGIN_COLLECTION_NAME_INVALID`, `PLUGIN_COLLECTION_FIELD_TYPE_INVALID`                       | Use supported collection names, field types, and indexes.       |
| Runtime hooks    | `PLUGIN_JOB_PERMISSION_MISSING`, `PLUGIN_EVENT_EMIT_PERMISSION_MISSING`                        | Add matching permissions and handler files.                     |

Warnings are cleanup after errors. Do not ignore warnings that indicate unused
permissions, dynamic capability access, or broad egress.

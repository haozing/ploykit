# AI Plugin Quickstart

This quickstart gives an AI coding agent a complete task shape for building a
PloyKit plugin.

## Task Prompt

```text
You are building a PloyKit plugin.

Goal:
- Build a private dashboard tool named Invoice Helper.
- It accepts invoice text, extracts vendor, invoice number, date, subtotal, tax,
  and total, stores each extraction, and returns normalized JSON.

Plugin:
- id: invoice-helper
- template: tool
- directory: plugins/invoice-helper

Contract:
- page: /, dashboard layout, auth required
- API: POST /run, auth required
- storage collection: invoice_extractions
- capabilities: storage read/write, audit write, usage write
- no external HTTP
- tests: contract, API extraction, storage write, audit, usage, page import smoke

Rules:
- Work only inside plugins/invoice-helper.
- Update plugin.ts first.
- Use @ploykit/plugin-sdk exports.
- Use ctx.* capabilities instead of host internals.
- Do not import src/lib/*, read process.env, access the database directly, or
  use raw external fetch().
- When npm UI or runtime packages are needed, declare plugin.dependencies.json
  and make sure the host package.json runtime dependencies list the same
  packages.
- Add permissions that match ctx capability usage.
- Add plugin tests with @ploykit/plugin-sdk/testing.
- Run npm run plugin:doctor -- plugins/invoice-helper after edits.
```

## Expected Commands

```bash
npm run plugin:create -- invoice-helper --template tool
npm run plugin:doctor -- plugins/invoice-helper
npm run plugins:scan
```

## Expected Files

```text
plugins/invoice-helper/
|-- plugin.ts
|-- pages/
|   `-- ToolPage.tsx
|-- api/
|   `-- run.ts
|-- tests/
|   `-- plugin.test.ts
|-- README.md
`-- AI_TASK.md
```

Add `plugin.dependencies.json` only when the plugin needs extra npm UI or
runtime packages.

## Acceptance Criteria

- `plugin.ts` declares the storage collection, page, API, menu, and permissions.
- The API validates request input with `z`.
- The API stores normalized extraction results with `ctx.storage`.
- The API records audit and usage entries.
- The test uses the fake host and checks storage, audit, usage, and response
  shape.
- `npm run plugin:doctor -- plugins/invoice-helper` returns `success: true`.

## Repair Prompt

If `plugin:doctor` fails, feed the JSON back to the agent with this prompt:

```text
The plugin doctor command failed.

Use the first diagnostic with severity "error".
Fix only the file/path indicated by the diagnostic unless the fix requires a
matching contract update.
Then rerun npm run plugin:doctor -- plugins/invoice-helper.

Diagnostic JSON:
<paste JSON here>
```

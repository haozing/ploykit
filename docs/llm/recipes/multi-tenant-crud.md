# Recipe: Multi-Tenant CRUD

Intent: create workspace-owned records without inventing tenant authority.

## Use

- `module.ts`: `data.tables.<name>` with `scope: 'workspace'`.
- Runtime: `ctx.data.table('<name>')` and `ctx.scope.workspaceId`.
- Permissions: `Permission.DataTableRead` and `Permission.DataTableWrite`.
- Reference: `modules/capability-demo/module.ts` and `modules/cms-demo/module.ts`.

## Contract Shape

```ts
permissions: [Permission.DataTableRead, Permission.DataTableWrite],
data: {
  version: 1,
  tables: {
    notes: table({
      scope: 'workspace',
      columns: {
        title: text().notNull(),
        body: text().nullable(),
      },
    }),
  },
  migrations: { mode: 'generated', dir: './migrations' },
},
```

## Handler Shape

```ts
export default action(async function createNote(ctx: ModuleContext, input = {}) {
  if (!ctx.scope.workspaceId) throw new Error('WORKSPACE_REQUIRED');
  return ctx.data.table('notes').insert({
    title: String(input.title ?? '').trim(),
    body: input.body ?? null,
  });
});
```

## Verify

Run:

```bash
npm run modules:scan
npm run module:doctor -- <id>
npm run module:test -- <id> --summary
```

## Red Lines

- Do not add `tenant_id` as the isolation authority.
- Do not read workspace from URL/local storage.
- Do not call database clients directly.
- Do not use global `fetch` or host internals for CRUD.

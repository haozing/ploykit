# Recipe: Multi-Tenant CRUD

Intent: create workspace-owned records without inventing tenant authority.

## Use

- Declare runtime schema with `schema(...)`.
- Declare business resources in `resources`.
- Declare pages in `pages` and APIs in `apis`.
- Store records through governed Data v2 facts and `ctx.scope`.
- Start from `npm run module:create -- notes --template resource`.

## Contract Shape

```ts
import { defineModule, resource, schema, stringField, textField } from '@ploykit/module-sdk';

const noteSchema = schema({
  name: 'Note',
  fields: {
    title: stringField({ required: true }),
    body: textField(),
  },
});

export default defineModule({
  id: 'notes',
  name: 'Notes',
  version: '0.1.0',
  resources: {
    notes: resource({
      scope: 'workspace',
      schema: noteSchema,
      storage: { table: 'notes' },
    }),
  },
  pages: [
    page({
      id: 'notes.list',
      area: 'dashboard',
      path: '/notes',
      frame: 'workspace',
      component: './pages/NotesListPage.tsx',
      auth: 'auth',
    }),
  ],
});
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
npm run data:generate -- modules/<id>
npm run data:types -- modules/<id>
npm run module:doctor -- <id>
npm run module:test -- <id> --summary
```

## Red Lines

- Do not add `tenant_id` as the isolation authority.
- Do not read workspace from URL or local storage.
- Do not call database clients directly.
- Do not use global `fetch` or host internals for CRUD.

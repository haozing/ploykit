# PloyKit Clean-Slate Implementation Plan

Date: 2026-06-27

This is the operating plan for the current single-contract architecture. It contains only the architecture PloyKit should maintain.

## Fixed Decisions

| Area | Decision |
| --- | --- |
| Contract | `module.ts` is the contract center and exposes one current shape. |
| Static files | `assets` owns locales, lucide icons, SVG icons, workers, WASM, and static files. |
| Business model | `resources` means business resources only. |
| Data | Resource storage is backed by governed Data v2 facts. |
| Schema | Resource, action, API, fixture, type, JSON Schema, and OpenAPI facts come from runtime schema. |
| Pages | Pages are TSX-first and declared through `pages`. |
| Frame | Every page declares `area`, `path`, `frame`, and `component`. |
| APIs | APIs are declared through `apis` with method, auth, handler, input schema, and output schema. |
| UI | Module pages import module-safe UI from `@ploykit/module-sdk/ui`; they do not import host UI. |
| Templates | The only ordinary templates are `app`, `resource`, `tool`, and `connector`. |
| CLI | Create, inspect, scan, doctor, and test form one closed loop. |

## Contract Example

```ts
import {
  action,
  api,
  defineModule,
  page,
  resource,
  schema,
  stringField,
  textField,
} from '@ploykit/module-sdk';

const noteSchema = schema({
  name: 'Note',
  fields: {
    title: stringField({ required: true, maxLength: 120 }),
    body: textField(),
    status: stringField({ required: true, default: 'draft' }),
  },
});

export default defineModule({
  id: 'notes',
  name: 'Notes',
  version: '0.1.0',
  assets: {
    locales: { zh: './locales/zh.json', en: './locales/en.json' },
    icons: { notes: { kind: 'lucide', name: 'NotebookTabs' } },
  },
  resources: {
    notes: resource({
      scope: 'workspace',
      schema: noteSchema,
      storage: { table: 'notes' },
    }),
  },
  pages: [
    page({
      id: 'notes.index',
      area: 'dashboard',
      path: '/notes',
      frame: 'workspace',
      component: './pages/NotesListPage.tsx',
      auth: 'auth',
    }),
  ],
  apis: [
    api({
      id: 'notes.create',
      path: '/notes',
      methods: ['POST'],
      handler: './api/notes',
      input: noteSchema,
      output: noteSchema,
      auth: 'auth',
    }),
  ],
  actions: {
    createNote: action({
      input: noteSchema,
      output: noteSchema,
      handler: './actions/create-note',
      sideEffect: 'write',
      auth: 'auth',
    }),
  },
});
```

## Required Module Loop

```bash
npm run module:create -- notes --template resource
npm run modules:scan
npm run module:doctor -- notes
npm run module:test -- notes --summary
```

For Data v2 modules:

```bash
npm run data:generate -- modules/notes
npm run data:types -- modules/notes
npm run data:verify -- --module notes
```

## Maintained Fixtures

| Fixture | Required Coverage |
| --- | --- |
| `modules/platform-smoke` | Page, API, action, job, event, webhook, lifecycle, surface, navigation. |
| `modules/resource-smoke` | Schema, business resources, Data v2, CRUD pages, API, action, generated artifacts. |
| `modules/public-tool-smoke` | Public page, metadata, cache, public alias, anonymous API, action, site navigation. |

## Red Lines

- Do not add a second contract shape.
- Do not add route-tree authoring.
- Do not put static files under `resources`.
- Do not add broad product demo modules as framework fixtures.
- Do not add external runner adapters unless they are required by current host primitives.
- Do not add framework adapters only because another ecosystem has them.
- Do not fake platform state in modules.

## Verification

```bash
npm run modules:scan
npm run llm-wiki:generate
npm run typecheck
npm run test:module-contract
npm run test:module-doctor
npm run test:host-runtime
npm run test:security-runtime
npm run test:web-shell
npm run modules:check
```

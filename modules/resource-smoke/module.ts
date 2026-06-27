import {
  action,
  api,
  booleanField,
  defineModule,
  integer,
  jsonb,
  page,
  Permission,
  resource,
  schema,
  stringField,
  table,
  text,
  textField,
} from '@ploykit/module-sdk';

const noteSchema = schema({
  name: 'ResourceSmokeNote',
  fields: {
    title: stringField({ required: true, maxLength: 120 }),
    body: textField(),
    status: stringField({ required: true, default: 'draft' }),
  },
});

const noteOutputSchema = schema({
  name: 'ResourceSmokeNoteOutput',
  fields: {
    ok: booleanField({ required: true }),
    id: stringField(),
    title: stringField(),
  },
});

export default defineModule({
  id: 'resource-smoke',
  name: 'Resource Smoke',
  version: '0.1.0',
  description: 'Current-contract Data v2 and business resource fixture.',
  permissions: [Permission.DataDocumentRead, Permission.DataDocumentWrite, Permission.DataTableRead, Permission.DataTableWrite],
  data: {
    version: 1,
    documents: {
      user_notes: {
        scope: 'user',
        fields: {
          message: { type: 'string', required: true, maxLength: 200 },
        },
      },
    },
    tables: {
      public_posts: table({
        scope: 'public-read',
        columns: {
          title: text().notNull(),
          status: text().notNull().default('draft'),
          metadata: jsonb().notNull().default({ featured: false }),
        },
        unique: [['title']],
        indexes: [['status']],
      }),
      workspace_notes: table({
        scope: 'workspace',
        columns: {
          title: text().notNull(),
          body: text().nullable(),
          status: text().notNull().default('draft'),
        },
        indexes: [['status']],
      }),
      product_items: table({
        scope: 'product',
        columns: {
          sku: text().notNull(),
          title: text().notNull(),
          price_cents: integer().notNull(),
          inventory: integer().notNull().default(0),
          metadata: jsonb().notNull().default({ source: 'resource-smoke' }),
        },
        unique: [['sku']],
        indexes: [['inventory']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
  resources: {
    notes: resource({
      scope: 'workspace',
      schema: noteSchema,
      storage: { table: 'workspace_notes' },
    }),
  },
  pages: [
    page({
      id: 'resource-smoke.notes.list',
      area: 'dashboard',
      path: '/resource-smoke',
      frame: 'workspace',
      component: './pages/NotesListPage.tsx',
      auth: 'auth',
      permissions: [Permission.DataTableRead],
    }),
    page({
      id: 'resource-smoke.notes.create',
      area: 'dashboard',
      path: '/resource-smoke/new',
      frame: 'workspace',
      component: './pages/NoteCreatePage.tsx',
      auth: 'auth',
      permissions: [Permission.DataTableWrite],
    }),
    page({
      id: 'resource-smoke.notes.edit',
      area: 'dashboard',
      path: '/resource-smoke/[id]/edit',
      frame: 'workspace',
      component: './pages/NoteEditPage.tsx',
      auth: 'auth',
      permissions: [Permission.DataTableWrite],
    }),
    page({
      id: 'resource-smoke.notes.detail',
      area: 'dashboard',
      path: '/resource-smoke/[id]',
      frame: 'workspace',
      component: './pages/NoteDetailPage.tsx',
      auth: 'auth',
      permissions: [Permission.DataTableRead],
    }),
  ],
  apis: [
    api({
      id: 'resource-smoke.notes',
      path: '/resource-smoke/notes',
      methods: ['GET', 'POST'],
      input: noteSchema,
      output: noteOutputSchema,
      handler: './api/notes',
      auth: 'auth',
      permissions: [Permission.DataTableRead, Permission.DataTableWrite],
    }),
  ],
  actions: {
    createNote: action({
      input: noteSchema,
      output: noteOutputSchema,
      handler: './actions/create-note',
      sideEffect: 'write',
      auth: 'auth',
      permissions: [Permission.DataTableWrite],
    }),
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: 'Resource Smoke',
    path: '/resource-smoke',
    weight: 20,
  },
});

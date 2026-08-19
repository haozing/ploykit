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
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
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
      id: '__MODULE_ID__.notes.list',
      area: 'dashboard',
      path: '/__MODULE_ID__',
      frame: 'workspace',
      component: './pages/NotesListPage.tsx',
      auth: 'auth',
    }),
    page({
      id: '__MODULE_ID__.notes.create',
      area: 'dashboard',
      path: '/__MODULE_ID__/new',
      frame: 'workspace',
      component: './pages/NoteCreatePage.tsx',
      auth: 'auth',
    }),
    page({
      id: '__MODULE_ID__.notes.edit',
      area: 'dashboard',
      path: '/__MODULE_ID__/[id]/edit',
      frame: 'workspace',
      component: './pages/NoteEditPage.tsx',
      auth: 'auth',
    }),
    page({
      id: '__MODULE_ID__.notes.detail',
      area: 'dashboard',
      path: '/__MODULE_ID__/[id]',
      frame: 'workspace',
      component: './pages/NoteDetailPage.tsx',
      auth: 'auth',
    }),
  ],
  apis: [
    api({
      id: '__MODULE_ID__.notes',
      path: '/__MODULE_ID__/notes',
      methods: ['GET', 'POST'],
      input: noteSchema,
      output: noteSchema,
      handler: './api/notes.ts',
      auth: 'auth',
    }),
  ],
  actions: {
    createNote: action({
      input: noteSchema,
      output: noteSchema,
      handler: './actions/create-note.ts',
      sideEffect: 'write',
      auth: 'auth',
    }),
  },
  navigation: {
    location: 'dashboard.sidebar',
    fallbackLabel: '__MODULE_NAME__',
    path: '/__MODULE_ID__',
    weight: 100,
  },
});

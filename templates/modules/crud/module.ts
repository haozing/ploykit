import { defineModule, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [Permission.DataTableRead, Permission.DataTableWrite, Permission.DataSchemaManage],
  data: {
    version: 1,
    tables: {
      notes: table({
        scope: 'workspace',
        columns: {
          title: text().notNull(),
          body: text().nullable(),
          status: text().notNull().default('draft'),
          published_at: timestamp().nullable(),
        },
        indexes: [['status'], ['published_at']],
      }),
    },
    migrations: {
      mode: 'generated',
      dir: './migrations',
    },
  },
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/NotesPage',
        loader: './loaders/notes',
        auth: 'auth',
        permissions: [Permission.DataTableRead],
      },
    ],
    api: [
      {
        path: '/notes',
        handler: './api/notes',
        methods: ['GET', 'POST'],
        auth: 'auth',
        permissions: [Permission.DataTableRead, Permission.DataTableWrite],
      },
    ],
  },
  actions: {
    createNote: {
      handler: './actions/create-note',
      auth: 'auth',
      permissions: [Permission.DataTableWrite],
    },
  },
});

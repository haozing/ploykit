import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'crud',
  name: 'Crud Template',
  version: '0.1.0',
  description:
    'A CRUD plugin template with storage, API routes, a dashboard page, and lifecycle hooks.',
  kind: 'app',
  trustLevel: 'untrusted',
  permissions: [
    Permission.StorageRead,
    Permission.StorageWrite,
    Permission.ConfigRead,
    Permission.ConfigWrite,
    Permission.EventsEmit,
    Permission.AuditWrite,
    Permission.UsageWrite,
    Permission.UiToast,
    Permission.NavigationExtend,
  ],
  data: {
    collections: {
      crud_template_items: {
        fields: {
          title: { type: 'string', required: true, maxLength: 160 },
          status: { type: 'string', required: true, enum: ['draft', 'active', 'archived'] },
          metadata: 'json?',
        },
        indexes: [{ fields: ['status'] }],
      },
    },
  },
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/CrudPage',
        auth: 'auth',
        layout: 'dashboard',
      },
    ],
    apis: [
      {
        path: '/items',
        handler: './api/items',
        auth: 'auth',
        methods: ['GET', 'POST'],
      },
      {
        path: '/items/:id',
        handler: './api/item-detail',
        auth: 'auth',
        methods: ['PATCH', 'DELETE'],
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    label: 'Crud Template',
    icon: 'ListChecks',
    path: '/',
    group: 'Plugins',
    weight: 40,
  },
  lifecycle: {
    install: './lifecycle/install',
  },
  events: {
    publishes: ['crud.item.created', 'crud.item.updated'],
  },
});

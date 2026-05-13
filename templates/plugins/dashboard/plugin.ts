import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'dashboard',
  name: 'Dashboard Template',
  version: '0.1.0',
  description: 'A dashboard plugin template for read-heavy summaries and reports.',
  kind: 'app',
  trustLevel: 'untrusted',
  permissions: [Permission.StorageRead],
  data: {
    collections: {
      dashboard_template_metrics: {
        fields: {
          label: { type: 'string', required: true, maxLength: 120 },
          value: { type: 'number', required: true },
          captured_at: 'datetime?',
        },
        indexes: [{ fields: ['captured_at'], order: 'desc' }],
      },
    },
  },
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/DashboardPage',
        auth: 'auth',
        layout: 'dashboard',
      },
    ],
    apis: [
      {
        path: '/summary',
        handler: './api/summary',
        auth: 'auth',
        methods: ['GET'],
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    label: 'Dashboard Template',
    icon: 'LayoutDashboard',
    path: '/',
    group: 'Plugins',
    weight: 60,
  },
});

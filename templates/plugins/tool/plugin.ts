import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'tool',
  name: 'Tool Template',
  version: '0.1.0',
  description: 'A focused tool plugin template with one page and one action API.',
  kind: 'tool',
  trustLevel: 'untrusted',
  permissions: [
    Permission.AuditWrite,
    Permission.UsageWrite,
    Permission.UiToast,
    Permission.NavigationExtend,
  ],
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/ToolPage',
        auth: 'auth',
        layout: 'dashboard',
      },
    ],
    apis: [
      {
        path: '/run',
        handler: './api/run',
        auth: 'auth',
        methods: ['POST'],
      },
    ],
  },
  menu: {
    location: 'dashboard.sidebar',
    label: 'Tool Template',
    icon: 'WandSparkles',
    path: '/',
    group: 'Tools',
    weight: 50,
  },
});

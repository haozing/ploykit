import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  permissions: [Permission.SurfaceContribute],
  resources: {
    locales: {
      zh: './locales/zh.json',
      en: './locales/en.json',
    },
  },
  i18n: {
    defaultLanguage: 'zh',
    requiredLanguages: ['zh', 'en'],
    namespaces: ['nav', 'pages'],
    strict: true,
  },
  routes: {
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/DashboardPage',
        loader: './loaders/dashboard-state',
        auth: 'auth',
      },
    ],
  },
  navigation: {
    location: 'dashboard.sidebar',
    labelKey: 'nav.dashboard',
    fallbackLabel: '__MODULE_NAME__',
    path: '/__MODULE_ID__',
    weight: 100,
  },
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/DashboardWidget',
      priority: 100,
      permissions: [Permission.SurfaceContribute],
    },
  },
});

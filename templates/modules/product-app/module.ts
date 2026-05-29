import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  description: 'Full product module with public site, workspace console, and admin operations.',
  permissions: [Permission.NavigationExtend, Permission.SurfaceContribute],
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
  product: {
    kind: 'product',
    audiences: ['visitor', 'workspace-user', 'platform-admin'],
    requiredShells: ['site', 'dashboard', 'admin'],
    pages: [
      {
        path: '/__MODULE_ID__',
        shell: 'site',
        title: '__MODULE_NAME__',
        audience: 'Visitor or evaluator',
        userQuestion: 'What does this product do, and should I try it?',
        primaryActions: ['Open the product console', 'Read the docs'],
      },
      {
        path: '/__MODULE_ID__',
        shell: 'dashboard',
        title: '__MODULE_NAME__ Console',
        audience: 'Workspace user',
        userQuestion: 'What should I do next inside this product?',
        primaryActions: ['Continue onboarding', 'Review workspace status'],
      },
      {
        path: '/__MODULE_ID__',
        shell: 'admin',
        title: '__MODULE_NAME__ Admin',
        audience: 'Platform administrator',
        userQuestion: 'Is this product healthy across tenants and services?',
        primaryActions: ['Review operational health', 'Open release evidence'],
      },
    ],
  },
  routes: {
    site: [
      {
        path: '/__MODULE_ID__',
        component: './pages/SiteHomePage',
        loader: './loaders/site-state',
        metadata: './loaders/site-meta',
        auth: 'public',
        cache: {
          strategy: 'public',
          revalidateSeconds: 300,
          tags: ['__MODULE_ID__'],
        },
      },
    ],
    dashboard: [
      {
        path: '/__MODULE_ID__',
        component: './pages/ConsolePage',
        loader: './loaders/console-state',
        auth: 'auth',
      },
    ],
    admin: [
      {
        path: '/__MODULE_ID__',
        component: './pages/AdminPage',
        loader: './loaders/admin-state',
        auth: 'admin',
      },
    ],
  },
  navigation: [
    {
      location: 'site.header',
      labelKey: 'nav.site',
      fallbackLabel: '__MODULE_NAME__',
      path: '/__MODULE_ID__',
      weight: 60,
    },
    {
      location: 'dashboard.sidebar',
      labelKey: 'nav.console',
      fallbackLabel: '__MODULE_NAME__',
      path: '/__MODULE_ID__',
      weight: 60,
    },
    {
      location: 'admin.sidebar',
      labelKey: 'nav.admin',
      fallbackLabel: '__MODULE_NAME__ Admin',
      path: '/__MODULE_ID__',
      weight: 60,
    },
  ],
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/DashboardWidget',
      priority: 60,
      permissions: [Permission.SurfaceContribute],
    },
  },
});

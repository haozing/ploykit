import { defineModule, Permission, table, text, timestamp } from '@ploykit/module-sdk';

export default defineModule({
  /* __PLOYKIT_CONTRACT_VERSION__ */
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  description:
    'Product module with public site, workspace console, admin operations, white-label presentation, and Data v2 CRUD.',
  permissions: [
    Permission.NavigationExtend,
    Permission.SurfaceContribute,
    Permission.SurfaceOverride,
    Permission.ThemeWrite,
    Permission.DataTableRead,
    Permission.DataTableWrite,
    Permission.DataSchemaManage,
    /* __PLOYKIT_PERMISSION_EXTENSIONS__ */
  ],
  /* __PLOYKIT_EGRESS__ */
  resources: {
    locales: {
      zh: './locales/zh.json',
      en: './locales/en.json',
    },
  },
  i18n: {
    defaultLanguage: 'zh',
    requiredLanguages: ['zh', 'en'],
    namespaces: ['nav', 'pages', 'seo'],
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
        primaryActions: ['Create note', 'Review workspace status'],
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
  presentation: {
    whiteLabel: true,
    replaces: ['host.page:site.home'],
    seoNamespaces: ['seo'],
    themeScope: 'site',
  },
  theme: {
    tokens: {
      colorPrimary: '#2563eb',
      radiusControl: '8px',
      radiusPanel: '12px',
    },
  },
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
  /* __PLOYKIT_SERVICE_REQUIREMENTS__ */
  /* __PLOYKIT_RESOURCE_BINDINGS__ */
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
        permissions: [Permission.DataTableRead],
      },
    ],
    admin: [
      {
        path: '/__MODULE_ID__',
        component: './pages/AdminPage',
        loader: './loaders/admin-state',
        auth: 'admin',
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
      /* __PLOYKIT_API_ROUTE_EXTENSIONS__ */
    ],
  },
  actions: {
    createNote: {
      handler: './actions/create-note',
      auth: 'auth',
      permissions: [Permission.DataTableWrite],
    },
    /* __PLOYKIT_ACTION_EXTENSIONS__ */
  },
  /* __PLOYKIT_JOB_EXTENSIONS__ */
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
    'host.page:site.home': {
      mode: 'replace',
      component: './surfaces/HomePage',
      loader: './loaders/home-meta',
      permissions: [Permission.SurfaceOverride],
      priority: 100,
    },
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/DashboardWidget',
      priority: 60,
      permissions: [Permission.SurfaceContribute],
    },
  },
});

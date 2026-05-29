import { defineModule, Permission } from '@ploykit/module-sdk';

export default defineModule({
  id: '__MODULE_ID__',
  name: '__MODULE_NAME__',
  version: '0.1.0',
  description: 'White-label public page module.',
  permissions: [Permission.SurfaceOverride, Permission.NavigationExtend, Permission.ThemeWrite],
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
  navigation: [
    {
      location: 'site.header',
      labelKey: 'nav.home',
      fallbackLabel: 'Home',
      path: '/',
      weight: 10,
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
  },
});

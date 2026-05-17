import { definePlugin, Permission } from '@ploykit/plugin-sdk';

export default definePlugin({
  id: 'host-capability-lab',
  name: 'Host Capability Lab',
  version: '0.1.0',
  description: 'Real plugin used to verify host storage and host page surface capabilities.',
  kind: 'app',
  trustLevel: 'trusted',
  permissions: [
    Permission.StorageRead,
    Permission.StorageWrite,
    Permission.HostPageExtend,
    Permission.HostPageOverride,
    Permission.NavigationExtend,
  ],
  data: {
    version: 1,
    collections: {
      host_capability_lab_checks: {
        fields: {
          title: { type: 'string', required: true, maxLength: 120 },
          status: { type: 'string', required: true, enum: ['queued', 'ready', 'archived'] },
          sequence: { type: 'integer', required: true },
          score: { type: 'number', required: true },
          active: { type: 'boolean', required: true },
          tags: { type: 'json?', default: [] },
          optional_note: 'text?',
          checked_at: { type: 'datetime', required: true },
        },
        indexes: [
          { fields: ['status'] },
          { fields: ['sequence'], order: 'desc' },
          { fields: ['active', 'status'] },
        ],
      },
    },
  },
  resources: {
    locales: {
      en: './locales/en.json',
      zh: './locales/zh.json',
    },
  },
  routes: {
    pages: [
      {
        path: '/',
        component: './pages/LabPage',
        auth: 'auth',
        layout: 'site',
      },
    ],
    apis: [
      {
        path: '/storage-probe',
        handler: './api/storage-probe',
        auth: 'auth',
        methods: ['GET', 'POST'],
        permissions: [Permission.StorageRead, Permission.StorageWrite],
      },
    ],
  },
  menu: {
    location: 'site.header',
    labelKey: 'menu.lab',
    fallbackLabel: 'Capability Lab',
    path: '/',
    weight: 65,
  },
  hostPages: {
    slots: [
      {
        page: '/',
        position: 'hero.before',
        component: './slots/HomeHeroBefore',
        priority: 5,
      },
      {
        page: '/',
        position: 'hero.after',
        component: './slots/HomeHeroAfter',
        priority: 5,
      },
      {
        page: '/',
        position: 'main.after',
        component: './components/HomeComponentSlot',
        priority: 5,
      },
      {
        page: '/pricing',
        position: 'main.before',
        component: './slots/PricingMainBefore',
        priority: 5,
      },
      {
        page: '/pricing',
        position: 'main.after',
        component: './slots/PricingMainAfter',
        priority: 5,
      },
    ],
    overrides: [
      {
        page: '/about',
        mode: 'main.replace',
        component: './pages/AboutOverride',
        priority: 5,
        shell: {
          layout: 'site',
          header: 'host',
          footer: 'host',
          container: 'fixed',
          activeMenuPath: '/about',
        },
        seo: {
          titleKey: 'hostPages.about.seo.title',
          descriptionKey: 'hostPages.about.seo.description',
          fallbackTitle: 'Host Capability Lab About Override',
          fallbackDescription:
            'Host Capability Lab verifies host page override SEO and i18n metadata.',
          canonical: '/about',
          robots: { index: true, follow: true },
          openGraph: {
            image: '/brand/og-default.png',
            type: 'website',
          },
          structuredData: {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: 'Host Capability Lab About Override',
          },
          sitemap: { include: true, changeFrequency: 'weekly', priority: 0.6 },
        },
        i18n: {
          namespaces: ['hostPages'],
          requiredLocales: ['zh', 'en'],
        },
        cache: {
          strategy: 'public',
          maxAgeSeconds: 60,
          staleWhileRevalidateSeconds: 120,
        },
      },
    ],
  },
});

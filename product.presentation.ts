import { defineProductPresentation } from '@ploykit/module-sdk/presentation';

export default defineProductPresentation({
  id: 'ploykit-product',
  name: 'PloyKit Product',
  defaultLanguage: 'zh',
  supportedLanguages: ['zh', 'en'],
  modules: {
    enabled: [],
  },
  brand: {
    productNameKey: 'brand.productName',
    logo: {
      light: '/brand/logo-light.png',
      dark: '/brand/logo-dark.png',
      mark: '/brand/mark.png',
    },
    favicon: '/brand/favicon.png',
    manifestIcon: '/brand/icon-512.png',
    openGraphImage: {
      default: '/brand/og-default.png',
      zh: '/brand/og-zh.png',
      en: '/brand/og-en.png',
    },
    themeColor: '#1f6f5b',
  },
  theme: {
    defaultProfileId: 'ploykit-product',
    profiles: {
      'ploykit-product': {
        name: 'PloyKit Product',
        modeDefault: 'system',
        density: 'comfortable',
        tokens: {
          colorBackground: '#f7f9fc',
          colorForeground: '#0f172a',
          colorSurface: '#ffffff',
          colorSurfaceForeground: '#0f172a',
          colorSurfaceMuted: '#f3f6fb',
          colorMutedForeground: '#667085',
          colorBorder: '#e7edf6',
          colorPrimary: '#1f6f5b',
          colorPrimaryForeground: '#ffffff',
          colorSuccess: '#16803f',
          colorWarning: '#b7791f',
          colorDanger: '#c2410c',
          radiusControl: '8px',
          radiusPanel: '8px',
          focusRing: '#1f6f5b',
        },
        darkTokens: {
          colorBackground: '#07111f',
          colorForeground: '#e7edf5',
          colorSurface: '#0f1b2d',
          colorSurfaceForeground: '#f8fafc',
          colorSurfaceMuted: '#15243a',
          colorMutedForeground: '#9aa8ba',
          colorBorder: '#24344c',
          colorPrimary: '#4ade80',
          colorPrimaryForeground: '#07111f',
          colorSuccess: '#4ade80',
          colorWarning: '#fbbf24',
          colorDanger: '#fb7185',
          radiusControl: '8px',
          radiusPanel: '8px',
          focusRing: '#4ade80',
        },
        localeTypography: {
          zh: {
            fontFamily: 'system-cjk',
            lineHeight: 'relaxed',
          },
          en: {
            fontFamily: 'system-latin',
            lineHeight: 'normal',
          },
        },
      },
      'demo-workspace': {
        name: 'Compact Workspace',
        modeDefault: 'system',
        density: 'compact',
        tokens: {
          colorPrimary: '#2d5f9a',
          colorPrimaryForeground: '#ffffff',
          colorBorder: '#ccd8e8',
          radiusControl: '7px',
        },
        darkTokens: {
          colorPrimary: '#93c5fd',
          colorPrimaryForeground: '#08111f',
          colorBorder: '#334862',
          radiusControl: '7px',
        },
      },
    },
    workspaceOverrides: {
      'demo-workspace': {
        enabled: true,
        themeProfileId: 'demo-workspace',
        tokens: {
          colorSuccess: '#15803d',
        },
        darkTokens: {
          colorSuccess: '#4ade80',
        },
      },
    },
  },
  pages: {
    site: {
      home: { mode: 'host' },
      pricing: { mode: 'host' },
      about: { mode: 'host' },
      contact: { mode: 'host' },
      docs: { mode: 'host' },
      privacy: { mode: 'host' },
      terms: { mode: 'host' },
    },
    auth: {
      login: { mode: 'host' },
      register: { mode: 'host' },
      forgotPassword: { mode: 'host' },
      resetPassword: { mode: 'host' },
    },
    dashboard: {
      home: {
        mode: 'host',
        scope: 'workspace',
      },
      'module-route': {
        mode: 'host',
        scope: 'workspace',
      },
    },
    admin: {
      overview: { mode: 'host' },
      modules: { mode: 'host' },
      settings: { mode: 'host' },
    },
  },
  slots: {
    'host.page:admin.modules:header.actions': {
      allowModules: [],
      maxContributions: 1,
    },
  },
});

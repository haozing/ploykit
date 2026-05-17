/**
 * Site global configuration.
 *
 * This file defines the default layout, navigation, footer, theme, and page
 * layout behavior for the app shell.
 */

import type { SiteConfig } from '@/lib/config/types';

export const siteConfig: SiteConfig = {
  name: 'PloyKit',
  description: 'Pluggable SaaS Platform',

  assets: {
    brand: {
      logo: '/brand/ploykit-logo.svg',
      mark: '/brand/ploykit-mark.svg',
      faviconSvg: '/favicon.svg',
      faviconIco: '/favicon.ico',
      appleTouchIcon: '/brand/apple-touch-icon.png',
      openGraph: '/brand/og-default.png',
    },
    social: {
      githubPreview: '/media/social/github-preview.png',
      docsPreview: '/media/social/docs-preview.png',
    },
    screenshots: {
      adminDashboard: '/media/screenshots/dashboard-admin.png',
      pluginDevConsole: '/media/screenshots/plugin-dev-console.png',
      pluginManagement: '/media/screenshots/plugin-management.png',
      pluginRuntimeSample: '/media/screenshots/plugin-runtime-sample.png',
      publicJsonTool: '/media/screenshots/public-json-tool.png',
      aiPluginWorkflow: '/media/screenshots/ai-plugin-workflow.png',
    },
    demo: {
      pluginCreateDoctorLoopGif: '/media/demo/plugin-create-doctor-loop.gif',
      pluginCreateDoctorLoopMp4: '/media/demo/plugin-create-doctor-loop.mp4',
    },
  },

  layout: {
    /**
     * Header component source.
     *
     * Options:
     * - "default" = Use framework built-in DefaultHeader.
     * - "plugin:theme-dark" = Reserved for a future runtime-contract layout source.
     *
     * Plugin layout sources currently fall back to the default component until
     * the runtime contract grows an explicit layout declaration.
     */
    header: 'default',

    /**
     * Footer component source.
     *
     * Options match header.
     */
    footer: 'default',
  },

  nav: {
    /**
     * Navigation menu items.
     *
     * Uses SiteMenuItem format for consistency with runtime plugin menus.
     * i18nKey should be a full translation key, for example "common.nav.home".
     */
    items: [
      { id: 'system-header-home', href: '/', i18nKey: 'common.nav.home', weight: 10 },
      { id: 'system-header-about', href: '/about', i18nKey: 'common.nav.about', weight: 20 },
      { id: 'system-header-contact', href: '/contact', i18nKey: 'common.nav.contact', weight: 30 },
      { id: 'system-header-pricing', href: '/pricing', i18nKey: 'common.nav.pricing', weight: 40 },
    ],
  },

  footer: {
    /**
     * Footer link configuration.
     *
     * Uses SiteMenuItem format for consistency with runtime plugin menus.
     * i18nKey should be a full translation key, for example "common.footer.about".
     */
    links: [
      { id: 'system-footer-about', href: '/about', i18nKey: 'common.footer.about', weight: 10 },
      {
        id: 'system-footer-privacy',
        href: '/privacy',
        i18nKey: 'common.footer.privacy',
        weight: 20,
      },
      { id: 'system-footer-terms', href: '/terms', i18nKey: 'common.footer.terms', weight: 30 },
    ],
  },

  theme: {
    /**
     * Design tokens source.
     *
     * Options:
     * - "default" = Use theme.config.ts from the repo root.
     * - "plugin:theme-dark" = Reserved for a future runtime-contract theme source.
     *
     * Plugin theme sources currently fall back to default tokens until the
     * runtime contract grows an explicit theme declaration.
     */
    tokens: 'default',
  },

  pages: {
    '/': {
      layout: 'shell',
      container: 'fixed',
      hideHeader: false,
      hideFooter: false,
    },

    '/about': {
      layout: 'shell',
      container: 'fixed',
    },

    '/contact': {
      layout: 'shell',
      container: 'fluid',
    },

    '/pricing': {
      layout: 'shell',
      container: 'fixed',
    },
  },
} as const;

export type AppSiteConfig = typeof siteConfig;

import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidElement } from 'react';
import { Permission, validateModuleDefinition } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import aboutMeta from '../loaders/about-meta';
import contactMeta from '../loaders/contact-meta';
import docsMeta from '../loaders/docs-meta';
import dashboardHomeMeta from '../loaders/dashboard-home-meta';
import forgotPasswordMeta from '../loaders/auth-forgot-password-meta';
import homeMeta from '../loaders/home-meta';
import loginMeta from '../loaders/auth-login-meta';
import pricingMeta from '../loaders/pricing-meta';
import privacyMeta from '../loaders/privacy-meta';
import registerMeta from '../loaders/auth-register-meta';
import resetPasswordMeta from '../loaders/auth-reset-password-meta';
import termsMeta from '../loaders/terms-meta';
import AboutPage from '../surfaces/AboutPage';
import AdminModulesActions from '../surfaces/AdminModulesActions';
import ContactPage from '../surfaces/ContactPage';
import DocsPage from '../surfaces/DocsPage';
import DashboardHomePage from '../surfaces/DashboardHomePage';
import ForgotPasswordPage from '../surfaces/ForgotPasswordPage';
import HomeHero from '../surfaces/HomeHero';
import HomePage from '../surfaces/HomePage';
import LoginPage from '../surfaces/LoginPage';
import PricingPage from '../surfaces/PricingPage';
import PrivacyPage from '../surfaces/PrivacyPage';
import RegisterPage from '../surfaces/RegisterPage';
import ResetPasswordPage from '../surfaces/ResetPasswordPage';
import TermsPage from '../surfaces/TermsPage';

const requiredOverrides = [
  'host.page:site.home',
  'host.page:site.pricing',
  'host.page:site.about',
  'host.page:site.contact',
  'host.page:site.docs',
  'host.page:site.privacy',
  'host.page:site.terms',
  'host.page:auth.login',
  'host.page:auth.register',
  'host.page:auth.forgotPassword',
  'host.page:auth.resetPassword',
  'host.page:dashboard.home',
] as const;

test('white-label-site-demo declares governed host page overrides', () => {
  assert.equal(moduleDefinition.id, 'white-label-site-demo');
  assert.ok(moduleDefinition.permissions.includes(Permission.SurfaceOverride));
  assert.ok(moduleDefinition.permissions.includes(Permission.SurfaceContribute));
  assert.ok(moduleDefinition.permissions.includes(Permission.NavigationExtend));
  assert.ok(moduleDefinition.permissions.includes(Permission.ThemeWrite));
  assert.deepEqual(validateModuleDefinition(moduleDefinition), []);
  assert.deepEqual(moduleDefinition.resources?.locales, {
    zh: './locales/zh.json',
    en: './locales/en.json',
  });
  assert.deepEqual(moduleDefinition.i18n?.requiredLanguages, ['zh', 'en']);
  assert.equal(moduleDefinition.presentation?.whiteLabel, true);
  assert.equal(moduleDefinition.theme?.tokens?.colorPrimary, '#2563eb');

  const navigation = Array.isArray(moduleDefinition.navigation)
    ? moduleDefinition.navigation
    : moduleDefinition.navigation
      ? [moduleDefinition.navigation]
      : [];
  assert.ok(
    navigation.some(
      (item) =>
        item.location === 'site.header' &&
        item.path === '/dashboard' &&
        item.labelKey === 'nav.dashboard'
    )
  );
  assert.ok(
    navigation.some(
      (item) =>
        item.location === 'site.footer' &&
        item.path === '/contact' &&
        item.labelKey === 'nav.support'
    )
  );

  for (const surfaceId of requiredOverrides) {
    const surface = moduleDefinition.surfaces?.[surfaceId];
    assert.equal(surface?.mode, 'replace', surfaceId);
    assert.equal(surface?.permissions?.includes(Permission.SurfaceOverride), true, surfaceId);
    assert.equal(typeof surface?.component, 'string', surfaceId);
    assert.equal(typeof surface?.loader, 'string', surfaceId);
  }

  const hero = moduleDefinition.surfaces?.['host.page:site.home:hero'];
  assert.equal(hero?.mode, 'prepend');
  assert.equal(hero?.permissions?.includes(Permission.SurfaceContribute), true);

  const adminActions = moduleDefinition.surfaces?.['host.page:admin.modules:header.actions'];
  assert.equal(adminActions?.mode, 'action');
  assert.equal(adminActions?.component, './surfaces/AdminModulesActions');
  assert.equal(adminActions?.permissions?.includes(Permission.SurfaceContribute), true);
});

test('white-label-site-demo loaders expose SEO, shell, cache and i18n metadata', () => {
  const metas = [
    homeMeta(),
    pricingMeta(),
    aboutMeta(),
    contactMeta(),
    docsMeta(),
    privacyMeta(),
    termsMeta(),
    loginMeta(),
    registerMeta(),
    forgotPasswordMeta(),
    resetPasswordMeta(),
    dashboardHomeMeta(),
  ];

  for (const meta of metas) {
    assert.equal(typeof meta.title, 'string');
    assert.equal(typeof meta.description, 'string');
    assert.equal(typeof meta.seo?.title, 'string');
    assert.equal(typeof meta.seo?.description, 'string');
    assert.ok(meta.shell?.area === 'site' || meta.shell?.area === 'auth' || meta.shell?.area === 'dashboard');
    assert.ok(
      meta.cache?.mode === 'public' ||
        meta.cache?.mode === 'private' ||
        meta.cache?.mode === 'no-store'
    );
    assert.deepEqual(meta.i18n?.namespaces, ['white-label-site-demo']);
  }

  assert.equal(homeMeta().shell.wide, true);
  const pricing = pricingMeta();
  assert.equal(
    pricing.cache.mode === 'public' ? pricing.cache.revalidateSeconds : undefined,
    300
  );
  assert.equal(dashboardHomeMeta().seo.noindex, true);
});

test('white-label-site-demo page surfaces render React elements', () => {
  const rendered = [
    AboutPage(),
    AdminModulesActions(),
    ContactPage({ lang: 'zh' }),
    DocsPage(),
    DashboardHomePage({ userEmail: 'operator@example.com' }),
    ForgotPasswordPage({}),
    HomeHero(),
    HomePage(),
    LoginPage({}),
    PricingPage(),
    PrivacyPage(),
    RegisterPage({}),
    ResetPasswordPage({ token: 'reset-token' }),
    TermsPage(),
  ];

  for (const node of rendered) {
    assert.equal(isValidElement(node), true);
  }
});

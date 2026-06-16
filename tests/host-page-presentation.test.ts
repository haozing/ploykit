import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProductThemeCss,
  getProductCompositionView,
  getProductThemeRuntimeView,
} from '../apps/host-next/lib/product-composition';
import { resolvePagePresentation } from '../apps/host-next/lib/presentation/page-presentation';
import {
  createRoutePresentationManifest,
  presentHostRoute,
} from '../apps/host-next/lib/presentation/route-presentation-manifest';

test('P1.5B resolves product and workspace theme profiles into host CSS variables', () => {
  const product = getProductThemeRuntimeView();
  assert.equal(product.product.themeProfileId, 'ploykit-product');
  assert.equal(product.product.profileExists, true);
  assert.equal(product.cssVariables['--theme-color-primary'], '#1f6f5b');
  assert.equal(product.darkCssVariables['--theme-color-primary'], '#4ade80');
  assert.equal(product.localeTypography.zh.lineHeight, 'relaxed');
  assert.equal(product.localeTypography.zh.cssVariables['--theme-line-height'], '1.68');
  assert.match(product.localeTypography.en.fontFamily, /Inter/);

  const workspace = getProductThemeRuntimeView({ workspaceId: 'demo-workspace' });
  assert.equal(workspace.workspace?.workspaceId, 'demo-workspace');
  assert.equal(workspace.workspace?.density, 'compact');
  assert.equal(workspace.cssVariables['--theme-color-primary'], '#2d5f9a');
  assert.equal(workspace.cssVariables['--theme-color-success'], '#15803d');
  assert.equal(workspace.localeTypography.zh.lineHeight, 'relaxed');

  const css = createProductThemeCss(workspace);
  assert.match(css, /:root\{/);
  assert.match(css, /--theme-color-primary:#2d5f9a/);
  assert.match(css, /:root\[data-theme='dark'\]/);
  assert.match(css, /:root\[data-lang='zh'\]/);
  assert.match(css, /--theme-line-height:1\.68/);

  const page = getProductThemeRuntimeView({
    workspaceId: 'demo-workspace',
    pageTheme: {
      scope: 'page',
      tokens: {
        colorPrimary: '#7c3aed',
        radiusPanel: '12px',
      },
      darkTokens: {
        colorPrimary: '#c4b5fd',
      },
    },
  });
  assert.equal(page.page?.scope, 'page');
  assert.equal(page.cssVariables['--theme-color-primary'], '#7c3aed');
  assert.equal(page.cssVariables['--theme-radius-panel'], '12px');
  assert.equal(page.darkCssVariables['--theme-color-primary'], '#c4b5fd');
  assert.match(createProductThemeCss(page), /--theme-color-primary:#7c3aed/);

  const unsafePage = getProductThemeRuntimeView({
    pageTheme: {
      scope: 'page',
      tokens: {
        colorPrimary: 'red; color: transparent',
      },
    },
  });
  assert.ok(unsafePage.page?.diagnostics.includes('THEME_TOKEN_VALUE_UNSAFE:light:colorPrimary'));
  assert.equal(unsafePage.cssVariables['--theme-color-primary'], '#1f6f5b');
});

test('P1.5B exposes configured host page slot policies in product composition view', async () => {
  const view = await getProductCompositionView();
  const slot = view.slots.find(
    (item) => item.surfaceId === 'host.page:admin.modules:header.actions'
  );

  assert.equal(view.brand.productName, 'PloyKit Product');
  assert.equal(view.brand.manifestIcon, '/brand/icon-512.png');
  assert.equal(view.brand.openGraphImageLocales.en, '/brand/og-en.png');
  assert.deepEqual(view.brand.diagnostics, []);
  assert.deepEqual(view.supportedLanguages, ['zh', 'en']);
  assert.equal(view.themeProfile.localeTypography.zh.lineHeight, 'relaxed');
  assert.ok(slot);
  assert.equal(slot.configured, true);
  assert.deepEqual(slot.allowModules, []);
  assert.equal(slot.maxContributions, 1);
  assert.deepEqual(slot.activeModules, []);
  assert.deepEqual(slot.diagnostics, []);
});

test('P5 page presentation resolver summarizes override, theme, SEO, cache and diagnostics', async () => {
  const presentation = await resolvePagePresentation({
    pageId: 'site.docs',
    pathname: '/zh/docs',
    lang: 'zh',
  });

  assert.equal(presentation.renderer, 'host');
  assert.equal(presentation.activeModuleId, null);
  assert.equal(presentation.language, 'zh');
  assert.equal(presentation.shell.chrome, 'site');
  assert.equal(presentation.cache.mode, 'public');
  assert.deepEqual(presentation.i18n.namespaces, ['host']);
  assert.equal(presentation.theme.product.themeProfileId, 'ploykit-product');
  assert.equal(presentation.metadata.title, undefined);
  assert.equal(presentation.seo.title, '文档');
  assert.deepEqual(presentation.diagnostics, []);
});

test('P5 page presentation resolver treats auth replacements as controlled explicit overrides', async () => {
  const presentation = await resolvePagePresentation({
    pageId: 'auth.login',
    pathname: '/zh/login',
    lang: 'zh',
  });

  assert.equal(presentation.replacePolicy, 'controlled');
  assert.equal(presentation.renderer, 'host');
  assert.equal(presentation.activeModuleId, null);
  assert.equal(presentation.cache.mode, 'no-store');
  assert.deepEqual(
    presentation.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    []
  );
});

test('P7 docs default host page localizes SEO', async () => {
  const presentation = await resolvePagePresentation({
    pageId: 'site.docs',
    pathname: '/en/docs',
    lang: 'en',
  });
  const alternates = presentation.seo.alternates as {
    canonical?: string;
    languages?: Record<string, string>;
  };
  const openGraph = presentation.seo.openGraph as {
    siteName?: string;
    images?: Array<{ url: string }>;
  };

  assert.equal(presentation.renderer, 'host');
  assert.equal(presentation.metadata.title, undefined);
  assert.equal(presentation.seo.title, 'Docs');
  assert.equal(alternates.canonical, 'http://localhost:3000/en/docs');
  assert.equal(alternates.languages?.zh, 'http://localhost:3000/zh/docs');
  assert.equal(openGraph.siteName, 'PloyKit');
  assert.equal(openGraph.images?.[0]?.url, 'http://localhost:3000/brand/og-en.png');
});

test('P5 page presentation resolver keeps admin controlled and resolves workspace theme', async () => {
  const admin = await resolvePagePresentation({
    pageId: 'admin.modules',
    pathname: '/zh/admin/modules',
    lang: 'zh',
  });
  const workspace = await resolvePagePresentation({
    pageId: 'dashboard.home',
    pathname: '/zh/dashboard',
    lang: 'zh',
    workspaceId: 'demo-workspace',
  });

  assert.equal(admin.renderer, 'host');
  assert.equal(admin.replacePolicy, 'controlled');
  assert.equal(admin.theme.workspace, null);
  assert.equal(workspace.renderer, 'host');
  assert.equal(workspace.theme.workspace?.workspaceId, 'demo-workspace');
  assert.equal(workspace.theme.cssVariables['--theme-color-primary'], '#2d5f9a');
});

test('P15 route presentation manifest covers concrete admin app routes', () => {
  const routes = new Map(
    createRoutePresentationManifest().routes.map((route) => [route.pageId, route])
  );

  assert.equal(routes.get('admin.analytics')?.path, '/admin/analytics');
  assert.equal(routes.get('admin.user-detail')?.path, '/admin/users/:userId');
  assert.equal(routes.get('admin.file-detail')?.path, '/admin/files/:fileId');
  assert.equal(routes.get('admin.module-detail')?.path, '/admin/modules/:moduleId');
  assert.equal(routes.get('dashboard.module-route')?.path, '/dashboard/:modulePath*');
  assert.equal(routes.get('admin.run-detail')?.path, '/admin/runs/:runId');
  assert.equal(routes.get('admin.webhook-detail')?.path, '/admin/webhooks/:outboxId');
  assert.equal(routes.get('admin.service-connections')?.path, '/admin/service-connections');
  assert.equal(routes.get('dev.console')?.path, '/admin/module-dev-console');

  for (const pageId of [
    'dashboard.module-route',
    'admin.analytics',
    'admin.audit',
    'admin.billing',
    'admin.entitlements',
    'admin.files',
    'admin.modules',
    'admin.rbac',
    'admin.revenue',
    'admin.runs',
    'admin.search',
    'admin.service-connections',
    'admin.settings',
    'admin.usage',
    'admin.users',
    'admin.webhooks',
    'dev.console',
  ]) {
    const route = routes.get(pageId);
    assert.ok(route, `${pageId} should be registered`);
    assert.equal(route.access, pageId.startsWith('dashboard.') ? 'auth' : 'admin');
    assert.equal(route.cache.mode, 'private');
  }
});

test('P15 route presenter enforces auth and admin access even with supplied sessions', async () => {
  await assert.rejects(
    () =>
      presentHostRoute({
        pageId: 'dashboard.home',
        lang: 'zh',
        session: { user: null, permissions: [] },
      }),
    /ROUTE_PRESENTATION_AUTH_REQUIRED: dashboard\.home/
  );

  await assert.rejects(
    () =>
      presentHostRoute({
        pageId: 'admin.modules',
        lang: 'zh',
        session: { user: { id: 'user-1', role: 'user' }, permissions: [] },
      }),
    /ROUTE_PRESENTATION_ADMIN_REQUIRED: admin\.modules/
  );

  const route = await presentHostRoute({
    pageId: 'admin.modules',
    lang: 'zh',
    session: { user: { id: 'admin-1', role: 'admin' }, permissions: [] },
  });

  assert.equal(route.manifest.access, 'admin');
  assert.equal(route.context.session.user?.role, 'admin');
  assert.equal(route.presentation.cache.mode, 'private');
  assert.equal((route.metadata.robots as { index?: boolean } | undefined)?.index, false);
});

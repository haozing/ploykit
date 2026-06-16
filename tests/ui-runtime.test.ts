import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, Permission, type ModuleContext } from '@ploykit/module-sdk';
import {
  createModuleHost,
  createModuleCacheRuntime,
  createModuleHeadTags,
  createModuleSitemapEntries,
  renderModulePage,
  renderModuleSurface,
  resolveModuleNavigationGroups,
  resolveModuleResources,
  resolveModuleThemeTokens,
  translateModuleMessage,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';

const uiModule = defineModule({
  id: 'ui-test',
  name: 'UI Test Module',
  version: '0.1.0',
  permissions: [Permission.SurfaceContribute, Permission.ThemeWrite],
  routes: {
    site: [
      {
        path: '/tools/ui-test',
        component: './pages/PublicToolPage',
        metadata: './loaders/public-metadata',
        auth: 'public',
        publicAliases: ['/public-ui-test'],
        cache: {
          strategy: 'public',
          revalidateSeconds: 60,
          tags: ['ui-test'],
        },
      },
    ],
    dashboard: [
      {
        path: '/ui/:slug',
        component: './pages/DashboardPage',
        loader: './loaders/dashboard-loader',
        metadata: './loaders/dashboard-metadata',
        auth: 'auth',
        aliases: ['/ui-dashboard'],
      },
    ],
  },
  navigation: [
    {
      location: 'dashboard.sidebar',
      fallbackLabel: 'Public UI',
      path: '/public-ui',
      weight: 5,
    },
    {
      location: 'dashboard.sidebar',
      fallbackLabel: 'Paid UI',
      path: '/paid-ui',
      weight: 10,
      requires: {
        entitlements: ['pro'],
      },
    },
  ],
  surfaces: {
    'dashboard.home:widgets': {
      mode: 'panel',
      component: './surfaces/Widget',
      loader: './loaders/widget-loader',
      priority: 1,
      permissions: [Permission.SurfaceContribute],
      visibility: { mode: 'permission', permission: Permission.ThemeWrite },
    },
    'dashboard.home:admin-actions': {
      mode: 'action',
      component: './surfaces/Widget',
      permissions: [Permission.SurfaceContribute],
      visibility: { mode: 'admin' },
    },
    'dashboard.home:feature-panel': {
      mode: 'panel',
      component: './surfaces/Widget',
      permissions: [Permission.SurfaceContribute],
      visibility: { mode: 'feature', feature: 'beta-panel' },
    },
    'dashboard.home:theme-panel': {
      mode: 'panel',
      component: './surfaces/Widget',
      permissions: [Permission.SurfaceContribute],
      visibility: { mode: 'permission', permission: Permission.ThemeWrite },
    },
    'dashboard.home:paid-panel': {
      mode: 'panel',
      component: './surfaces/Widget',
      permissions: [Permission.SurfaceContribute],
      commercial: {
        plans: ['pro'],
      },
    },
  },
  resources: {
    locales: {
      'zh-CN': './locales/zh-CN.json',
    },
    assets: [
      {
        path: './assets/logo.png',
        contentType: 'image/png',
      },
      {
        path: './assets/sync.worker.js',
        kind: 'worker',
      },
      {
        path: './assets/engine.wasm',
        kind: 'wasm',
      },
    ],
  },
});

const artifact: ModuleMapArtifact = {
  kind: 'source',
  modules: {
    'ui-test': {
      module: async () => ({ default: uiModule }),
      pages: {
        'pages/DashboardPage': async () => ({
          default: (props: { loaderData: unknown }) => ({
            view: 'dashboard',
            loaderData: props.loaderData,
          }),
        }),
        'pages/PublicToolPage': async () => ({
          default: () => ({ view: 'public-tool' }),
        }),
      },
      loaders: {
        'loaders/dashboard-loader': async () => ({
          default: (ctx: ModuleContext) => ({
            slug: ctx.request.params.slug,
            scope: ctx.scope.workspaceId,
          }),
        }),
        'loaders/dashboard-metadata': async () => ({
          default: (ctx: ModuleContext) => ({
            title: `UI ${ctx.request.params.slug}`,
            description: 'Dashboard page',
            canonical: `/ui/${ctx.request.params.slug}`,
            openGraph: {
              title: 'Open Graph UI',
            },
          }),
        }),
        'loaders/public-metadata': async () => ({
          default: {
            title: 'Public UI Tool',
            description: 'Public tool page',
          },
        }),
        'loaders/widget-loader': async () => ({
          default: (ctx: ModuleContext) => ({
            userId: ctx.user?.id ?? null,
          }),
        }),
      },
      surfaces: {
        'surfaces/Widget': async () => ({
          default: (props: { loaderData: unknown }) => ({
            view: 'widget',
            loaderData: props.loaderData,
          }),
        }),
      },
      assets: ['assets/logo.png', 'assets/sync.worker.js', 'assets/engine.wasm'],
      messages: {
        'zh-CN': {
          nav: {
            label: '模块控制台',
          },
        },
        en: {
          nav: {
            label: 'Module console',
          },
        },
      },
    },
  },
};

test('P5 renders module pages with loader data, metadata, SEO and cache policy', async () => {
  const host = await createModuleHost({ artifact });

  const result = await renderModulePage(host.runtime, {
    kind: 'dashboard',
    request: new Request('http://localhost/ui/alpha', { method: 'GET' }),
    pathname: '/ui/alpha',
    hostBaseUrl: 'https://example.com',
    session: {
      user: { id: 'user_1', role: 'user' },
      workspaceId: 'workspace_1',
    },
    renderComponent({ page, props }) {
      return (page.component as (input: typeof props) => unknown)(props);
    },
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.ok, true);
  assert.deepEqual(result.page.props.loaderData, {
    slug: 'alpha',
    scope: 'workspace_1',
  });
  assert.deepEqual(result.page.rendered, {
    view: 'dashboard',
    loaderData: {
      slug: 'alpha',
      scope: 'workspace_1',
    },
  });
  assert.equal(result.page.seo.title, 'UI alpha');
  assert.equal(result.page.seo.canonical, '/ui/alpha');
  assert.deepEqual(result.page.cache, {
    strategy: 'none',
    revalidateSeconds: null,
    tags: [],
  });
});

test('P5 renders public aliases with canonical fallback, sitemap and head tags', async () => {
  const host = await createModuleHost({ artifact });

  const result = await renderModulePage(host.runtime, {
    kind: 'site',
    request: new Request('http://localhost/public-ui-test', { method: 'GET' }),
    pathname: '/public-ui-test',
    hostBaseUrl: 'https://example.com',
  });

  if (!result.ok) {
    throw new Error(result.message);
  }

  assert.equal(result.ok, true);
  assert.equal(result.page.seo.title, 'Public UI Tool');
  assert.equal(result.page.seo.canonical, 'https://example.com/public-ui-test');
  assert.deepEqual(result.page.cache, {
    strategy: 'public',
    revalidateSeconds: 60,
    tags: ['ui-test'],
  });

  const sitemap = createModuleSitemapEntries(host.runtime, { baseUrl: 'https://example.com' });
  assert.ok(sitemap.some((entry) => entry.path === '/tools/ui-test' && entry.source === 'route'));
  assert.ok(
    sitemap.some((entry) => entry.path === '/public-ui-test' && entry.source === 'publicAlias')
  );
  assert.equal(
    sitemap.some((entry) => entry.path === '/ui-dashboard'),
    false
  );

  const tags = createModuleHeadTags(result.page.seo);
  assert.ok(tags.some((tag) => tag.tag === 'title' && tag.content === 'Public UI Tool'));
  assert.ok(
    tags.some(
      (tag) => tag.tag === 'link' && tag.rel === 'canonical' && tag.href.endsWith('/public-ui-test')
    )
  );
});

test('P5 renders surfaces and filters them by P4 permissions', async () => {
  const host = await createModuleHost({ artifact });

  const denied = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:widgets',
    request: new Request('http://localhost/dashboard', { method: 'GET' }),
  });
  assert.equal(denied.all.length, 0);

  const allowed = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:widgets',
    request: new Request('http://localhost/dashboard', { method: 'GET' }),
    session: {
      user: { id: 'user_2', role: 'user' },
      permissions: [Permission.ThemeWrite],
    },
    renderComponent({ component, loaderData }) {
      return (component as (props: { loaderData: unknown }) => unknown)({ loaderData });
    },
  });

  assert.equal(allowed.panel.length, 1);
  assert.deepEqual(allowed.panel[0].loaderData, { userId: 'user_2' });
  assert.deepEqual(allowed.panel[0].rendered, {
    view: 'widget',
    loaderData: { userId: 'user_2' },
  });
});

test('P5 enforces surface visibility modes at runtime', async () => {
  const host = await createModuleHost({ artifact });
  const request = new Request('http://localhost/dashboard', { method: 'GET' });

  const userSession = {
    user: { id: 'user_2b', role: 'user' as const },
    permissions: [Permission.SurfaceContribute],
  };
  const adminDenied = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:admin-actions',
    request,
    session: userSession,
  });
  assert.equal(adminDenied.all.length, 0);

  const adminAllowed = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:admin-actions',
    request,
    session: {
      user: { id: 'admin_1', role: 'admin' },
    },
  });
  assert.equal(adminAllowed.action.length, 1);

  const featureDenied = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:feature-panel',
    request,
    session: userSession,
  });
  assert.equal(featureDenied.all.length, 0);

  const featureAllowed = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:feature-panel',
    request,
    session: {
      ...userSession,
      features: ['beta-panel'],
    },
  });
  assert.equal(featureAllowed.panel.length, 1);

  const permissionDenied = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:theme-panel',
    request,
    session: userSession,
  });
  assert.equal(permissionDenied.all.length, 0);

  const permissionAllowed = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:theme-panel',
    request,
    session: {
      ...userSession,
      permissions: [Permission.SurfaceContribute, Permission.ThemeWrite],
    },
  });
  assert.equal(permissionAllowed.panel.length, 1);

  const paidDenied = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:paid-panel',
    request,
    session: {
      ...userSession,
      plan: 'free',
    },
  });
  assert.equal(paidDenied.panel.length, 0);
  assert.ok(
    paidDenied.diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_SURFACE_PLAN_REQUIRED')
  );

  const paidAllowed = await renderModuleSurface(host.runtime, {
    surfaceId: 'dashboard.home:paid-panel',
    request,
    session: {
      ...userSession,
      plan: 'pro',
    },
  });
  assert.equal(paidAllowed.panel.length, 1);
});

test('P5 resolves navigation groups and module resources', async () => {
  const host = await createModuleHost({ artifact });

  const groups = resolveModuleNavigationGroups(host.runtime, {
    session: {
      user: { id: 'user_3', role: 'user' },
      entitlements: ['pro'],
    },
  });
  assert.deepEqual(
    groups['dashboard.sidebar']?.map((entry) => entry.item.fallbackLabel),
    ['Public UI', 'Paid UI']
  );

  const resources = resolveModuleResources(host.runtime, 'ui-test');
  assert.deepEqual(resources.locales, [{ locale: 'zh-CN', path: 'locales/zh-CN.json' }]);
  assert.equal(resources.assets.find((asset) => asset.path.endsWith('.wasm'))?.kind, 'wasm');
  assert.equal(
    resources.assets.find((asset) => asset.path.endsWith('.worker.js'))?.contentType,
    'text/javascript; charset=utf-8'
  );
});

test('P5 translates module messages from generated map entries', async () => {
  const host = await createModuleHost({ artifact });

  assert.equal(translateModuleMessage(host.runtime, 'ui-test', 'zh-CN', 'nav.label'), '模块控制台');
  assert.equal(
    translateModuleMessage(host.runtime, 'ui-test', 'en-US', 'nav.label'),
    'Module console'
  );
  assert.equal(
    translateModuleMessage(host.runtime, 'ui-test', 'en-US', 'nav.missing', {
      fallback: 'Fallback {name}',
      values: { name: 'A' },
    }),
    'Fallback A'
  );
});

test('P5 cache and theme runtimes expose controlled host operations', async () => {
  const requests: unknown[] = [];
  const cache = createModuleCacheRuntime((request) => {
    requests.push(request);
  });

  await cache.revalidatePath('/tools/ui-test', 'ui-test');
  await cache.revalidateTag('ui-test', 'ui-test');

  assert.deepEqual(requests, [
    { path: '/tools/ui-test', moduleId: 'ui-test' },
    { tag: 'ui-test', moduleId: 'ui-test' },
  ]);

  assert.deepEqual(
    resolveModuleThemeTokens(
      {
        colorPrimary: '#2563eb',
        'global.css': 'body{}',
      },
      {
        allowedTokens: ['colorPrimary'],
        sourceModuleId: 'ui-test',
        scope: 'site',
      }
    ),
    {
      tokens: {
        colorPrimary: '#2563eb',
      },
      rejected: {
        'global.css': 'body{}',
      },
      acceptedTokens: {
        colorPrimary: '#2563eb',
      },
      rejectedTokens: {
        'global.css': 'body{}',
      },
      sourceModuleId: 'ui-test',
      scope: 'site',
    }
  );
});

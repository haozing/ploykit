import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, Permission, validateModuleDefinition } from '@ploykit/module-sdk';
import {
  createModuleHost,
  renderModuleSurface,
  resolveHostPageComposition,
  validateModuleHostPageOverride,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';
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

test('P5 validates host page override requirements', () => {
  const diagnostics = validateModuleHostPageOverride('host.page:dashboard.home', {
    mode: 'append',
    component: './surfaces/Override',
  });

  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    [
      'MODULE_HOST_PAGE_OVERRIDE_REPLACE_REQUIRED',
      'MODULE_HOST_PAGE_OVERRIDE_PERMISSION_REQUIRED',
      'MODULE_HOST_PAGE_OVERRIDE_LOADER_REQUIRED',
    ]
  );
});

test('P5 module contract validates host page overrides and worker/wasm asset kinds', () => {
  const diagnostics = validateModuleDefinition(
    defineModule({
      id: 'host-page-test',
      name: 'Host Page Test',
      version: '0.1.0',
      permissions: [Permission.SurfaceOverride],
      surfaces: {
        'host.page:dashboard.home': {
          mode: 'replace',
          component: './surfaces/Override',
          permissions: [Permission.SurfaceOverride],
        },
      },
      resources: {
        assets: [
          {
            path: './assets/engine.wasm',
          },
          {
            path: './assets/sync.worker.js',
          },
        ],
      },
    })
  );

  assert.ok(
    diagnostics.some(
      (diagnostic) => diagnostic.code === 'MODULE_HOST_PAGE_OVERRIDE_LOADER_REQUIRED'
    )
  );
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_ASSET_WASM_KIND_REQUIRED')
  );
  assert.ok(
    diagnostics.some((diagnostic) => diagnostic.code === 'MODULE_ASSET_WORKER_KIND_REQUIRED')
  );
});

test('P1.5A resolves white-label public site page overrides from product composition', async () => {
  const module = defineModule({
    id: 'white-label-site',
    name: 'White Label Site',
    version: '0.1.0',
    permissions: [Permission.SurfaceOverride, Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home': {
        mode: 'replace',
        component: './surfaces/HomePage',
        loader: './loaders/home-meta',
        permissions: [Permission.SurfaceOverride],
      },
      'host.page:site.home:hero': {
        mode: 'prepend',
        component: './surfaces/Hero',
        permissions: [Permission.SurfaceContribute],
      },
    },
  });

  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'white-label-site': {
        module: async () => ({ default: module }),
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const plan = resolveHostPageComposition(host.runtime, {
    pageId: 'site.home',
    composition: {
      enabledModules: ['white-label-site'],
      pageOverrides: {
        'site.home': {
          moduleId: 'white-label-site',
          enabled: true,
          reason: 'product white-label home',
        },
      },
    },
  });

  assert.equal(plan.page.surfaceId, 'host.page:site.home');
  assert.equal(plan.activeOverride?.moduleId, 'white-label-site');
  assert.equal(plan.slots.hero[0]?.moduleId, 'white-label-site');
  assert.deepEqual(plan.diagnostics, []);
});

test('P5 host page override selection uses shared surface access permissions', async () => {
  const contribution = {
    moduleId: 'definition-only-override',
    surfaceId: 'host.page:site.home',
    priority: 0,
    definition: {
      mode: 'replace',
      component: './surfaces/HomePage',
      loader: './loaders/home-meta',
      permissions: [Permission.SurfaceOverride],
    },
  } as const;
  const host = {
    contracts: [{ id: 'definition-only-override', permissions: [] }],
    surfaces: {
      get: (surfaceId: string) =>
        surfaceId === 'host.page:site.home' ? [contribution] : [],
    },
    getContract: (moduleId: string) =>
      moduleId === 'definition-only-override'
        ? { id: 'definition-only-override', permissions: [] }
        : null,
  } as unknown as Parameters<typeof resolveHostPageComposition>[0];

  const plan = resolveHostPageComposition(host, {
    pageId: 'site.home',
    composition: {
      enabledModules: ['definition-only-override'],
      pageOverrides: {
        'site.home': {
          moduleId: 'definition-only-override',
          enabled: true,
          reason: 'regression test',
        },
      },
    },
  });

  assert.equal(plan.activeOverride, null);
  assert.ok(
    plan.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'HOST_PAGE_OVERRIDE_PERMISSION_MISSING' &&
        diagnostic.moduleId === 'definition-only-override'
    )
  );
});

test('P1.5A reports conflicting page overrides when composition does not select one', async () => {
  const first = defineModule({
    id: 'first-site',
    name: 'First Site',
    version: '0.1.0',
    permissions: [Permission.SurfaceOverride],
    surfaces: {
      'host.page:site.pricing': {
        mode: 'replace',
        component: './surfaces/Pricing',
        loader: './loaders/pricing-meta',
        permissions: [Permission.SurfaceOverride],
      },
    },
  });
  const second = defineModule({
    id: 'second-site',
    name: 'Second Site',
    version: '0.1.0',
    permissions: [Permission.SurfaceOverride],
    surfaces: {
      'host.page:site.pricing': {
        mode: 'replace',
        component: './surfaces/Pricing',
        loader: './loaders/pricing-meta',
        permissions: [Permission.SurfaceOverride],
      },
    },
  });

  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'first-site': {
        module: async () => ({ default: first }),
      },
      'second-site': {
        module: async () => ({ default: second }),
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const plan = resolveHostPageComposition(host.runtime, {
    pageId: 'site.pricing',
  });

  assert.equal(plan.activeOverride, null);
  assert.ok(
    plan.diagnostics.some(
      (diagnostic) => diagnostic.code === 'HOST_PAGE_OVERRIDE_CONFLICT'
    )
  );
});

test('P5 controlled host page replacements require explicit replace mode', async () => {
  const authModule = defineModule({
    id: 'controlled-auth',
    name: 'Controlled Auth',
    version: '0.1.0',
    permissions: [Permission.SurfaceOverride],
    surfaces: {
      'host.page:auth.login': {
        mode: 'replace',
        component: './surfaces/Login',
        loader: './loaders/login-meta',
        permissions: [Permission.SurfaceOverride],
      },
    },
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'controlled-auth': {
        module: async () => ({ default: authModule }),
      },
    },
  };
  const host = await createModuleHost({ artifact });
  const implicit = resolveHostPageComposition(host.runtime, {
    pageId: 'auth.login',
    composition: {
      enabledModules: ['controlled-auth'],
      pageOverrides: {
        'auth.login': {
          moduleId: 'controlled-auth',
          enabled: true,
        },
      },
    },
  });
  const explicit = resolveHostPageComposition(host.runtime, {
    pageId: 'auth.login',
    composition: {
      enabledModules: ['controlled-auth'],
      pageOverrides: {
        'auth.login': {
          moduleId: 'controlled-auth',
          enabled: true,
          explicit: true,
        },
      },
    },
  });

  assert.equal(implicit.activeOverride, null);
  assert.ok(
    implicit.diagnostics.some(
      (diagnostic) => diagnostic.code === 'HOST_PAGE_OVERRIDE_REQUIRES_EXPLICIT_REPLACE'
    )
  );
  assert.equal(explicit.activeOverride?.moduleId, 'controlled-auth');
  assert.deepEqual(explicit.diagnostics, []);
});

test('P5 replacement render uses product-granted override permission without caller SurfaceContribute', async () => {
  const replacement = defineModule({
    id: 'override-only',
    name: 'Override Only',
    version: '0.1.0',
    permissions: [Permission.SurfaceOverride],
    surfaces: {
      'host.page:site.home': {
        mode: 'replace',
        component: './surfaces/Home',
        loader: './loaders/home-meta',
        permissions: [Permission.SurfaceOverride],
      },
    },
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'override-only': {
        module: async () => ({ default: replacement }),
        surfaces: {
          'surfaces/Home': async () => ({
            default: (_props: { loaderData?: unknown }) => ({ rendered: true }),
          }),
        },
        loaders: {
          'loaders/home-meta': async () => ({
            default: () => ({ title: 'Override home' }),
          }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const surface = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/'),
    surfaceId: 'host.page:site.home',
    session: { user: null, permissions: [] },
    renderComponent({ component, loaderData }) {
      return (component as (props: { loaderData: unknown }) => unknown)({ loaderData });
    },
  });

  assert.deepEqual(surface.replace.map((item) => item.moduleId), ['override-only']);
  assert.deepEqual(surface.replace[0]?.rendered, { rendered: true });
});

test('P5 surface visibility is evaluated with the caller session', async () => {
  const adminSurface = defineModule({
    id: 'admin-visible-surface',
    name: 'Admin Visible Surface',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home:main.before': {
        mode: 'append',
        component: './surfaces/AdminOnly',
        permissions: [Permission.SurfaceContribute],
        visibility: { mode: 'admin' },
      },
    },
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'admin-visible-surface': {
        module: async () => ({ default: adminSurface }),
        surfaces: {
          'surfaces/AdminOnly': async () => ({
            default: () => ({ adminOnly: true }),
          }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const anonymous = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/'),
    surfaceId: 'host.page:site.home:main.before',
    session: { user: null, permissions: [] },
    renderComponent({ component }) {
      return (component as () => unknown)();
    },
  });
  const admin = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/'),
    surfaceId: 'host.page:site.home:main.before',
    session: { user: { id: 'admin', role: 'admin' }, permissions: [] },
    renderComponent({ component }) {
      return (component as () => unknown)();
    },
  });

  assert.deepEqual(anonymous.all, []);
  assert.deepEqual(admin.all.map((item) => item.moduleId), ['admin-visible-surface']);
});

test('P5 surface rendering can reuse preloaded page presentation metadata', async () => {
  let loaderCalls = 0;
  const replacement = defineModule({
    id: 'preloaded-replace',
    name: 'Preloaded Replace',
    version: '0.1.0',
    permissions: [Permission.SurfaceOverride],
    surfaces: {
      'host.page:site.home': {
        mode: 'replace',
        component: './surfaces/Home',
        loader: './loaders/home-meta',
        permissions: [Permission.SurfaceOverride],
      },
    },
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'preloaded-replace': {
        module: async () => ({ default: replacement }),
        surfaces: {
          'surfaces/Home': async () => ({
            default: (props: { loaderData: unknown }) => props.loaderData,
          }),
        },
        loaders: {
          'loaders/home-meta': async () => ({
            default: () => {
              loaderCalls += 1;
              return { title: 'Loaded metadata' };
            },
          }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const surface = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/'),
    surfaceId: 'host.page:site.home',
    session: { user: null, permissions: [] },
    loaderDataByModuleId: new Map([['preloaded-replace', { title: 'Preloaded metadata' }]]),
    renderComponent({ component, loaderData }) {
      return (component as (props: { loaderData: unknown }) => unknown)({ loaderData });
    },
  });

  assert.equal(loaderCalls, 0);
  assert.deepEqual(surface.replace[0]?.rendered, { title: 'Preloaded metadata' });
});

test('P1.5A renders only host page slot contributions selected by composition policy', async () => {
  const allowed = defineModule({
    id: 'allowed-site',
    name: 'Allowed Site',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home:hero': {
        mode: 'prepend',
        component: './surfaces/Hero',
        permissions: [Permission.SurfaceContribute],
      },
    },
  });
  const blocked = defineModule({
    id: 'blocked-site',
    name: 'Blocked Site',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home:hero': {
        mode: 'prepend',
        component: './surfaces/Hero',
        permissions: [Permission.SurfaceContribute],
      },
    },
  });
  const renderedModules: string[] = [];
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'allowed-site': {
        module: async () => ({ default: allowed }),
        surfaces: {
          'surfaces/Hero': async () => ({
            default: () => {
              renderedModules.push('allowed-site');
              return { moduleId: 'allowed-site' };
            },
          }),
        },
      },
      'blocked-site': {
        module: async () => ({ default: blocked }),
        surfaces: {
          'surfaces/Hero': async () => ({
            default: () => {
              renderedModules.push('blocked-site');
              return { moduleId: 'blocked-site' };
            },
          }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const plan = resolveHostPageComposition(host.runtime, {
    pageId: 'site.home',
    composition: {
      enabledModules: ['allowed-site', 'blocked-site'],
      slotPolicies: {
        'host.page:site.home:hero': {
          allowModules: ['allowed-site'],
          maxContributions: 1,
        },
      },
    },
  });
  const surface = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/'),
    surfaceId: 'host.page:site.home:hero',
    contributions: plan.slots.hero,
    session: { user: null, system: true },
    renderComponent({ component }) {
      return (component as () => unknown)();
    },
  });

  assert.deepEqual(plan.slots.hero.map((item) => item.moduleId), ['allowed-site']);
  assert.deepEqual(surface.all.map((item) => item.moduleId), ['allowed-site']);
  assert.deepEqual(renderedModules, ['allowed-site']);
  assert.ok(
    plan.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'HOST_PAGE_SLOT_MODULE_NOT_ALLOWED' &&
        diagnostic.moduleId === 'blocked-site'
    )
  );
});

test('P5 host page slot plan uses caller visibility and module permissions', async () => {
  const adminOnly = defineModule({
    id: 'admin-only-slot',
    name: 'Admin Only Slot',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home:main.before': {
        mode: 'append',
        component: './surfaces/AdminOnly',
        permissions: [Permission.SurfaceContribute],
        visibility: { mode: 'admin' },
      },
    },
  });
  const missingPermission = defineModule({
    id: 'missing-slot-permission',
    name: 'Missing Slot Permission',
    version: '0.1.0',
    surfaces: {
      'host.page:site.home:main.before': {
        mode: 'append',
        component: './surfaces/MissingPermission',
      },
    },
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'admin-only-slot': {
        module: async () => ({ default: adminOnly }),
        surfaces: {
          'surfaces/AdminOnly': async () => ({ default: () => ({ admin: true }) }),
        },
      },
      'missing-slot-permission': {
        module: async () => ({ default: missingPermission }),
        surfaces: {
          'surfaces/MissingPermission': async () => ({ default: () => ({ missing: true }) }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const userPlan = resolveHostPageComposition(host.runtime, {
    pageId: 'site.home',
    session: { user: { id: 'user', role: 'user' }, permissions: [] },
  });
  const adminPlan = resolveHostPageComposition(host.runtime, {
    pageId: 'site.home',
    session: { user: { id: 'admin', role: 'admin' }, permissions: [] },
  });

  assert.deepEqual(userPlan.slots['main.before'].map((item) => item.moduleId), []);
  assert.deepEqual(adminPlan.slots['main.before'].map((item) => item.moduleId), [
    'admin-only-slot',
  ]);
  assert.ok(
    userPlan.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_SURFACE_ADMIN_REQUIRED' &&
        diagnostic.moduleId === 'admin-only-slot'
    )
  );
  assert.ok(
    adminPlan.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_SURFACE_PERMISSION_NOT_DECLARED' &&
        diagnostic.moduleId === 'missing-slot-permission'
    )
  );
});

test('P5 slot surface rendering isolates a failed contribution', async () => {
  const healthy = defineModule({
    id: 'healthy-slot',
    name: 'Healthy Slot',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home:main.after': {
        mode: 'append',
        component: './surfaces/Healthy',
        permissions: [Permission.SurfaceContribute],
        priority: 10,
      },
    },
  });
  const broken = defineModule({
    id: 'broken-slot',
    name: 'Broken Slot',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:site.home:main.after': {
        mode: 'append',
        component: './surfaces/Broken',
        permissions: [Permission.SurfaceContribute],
        priority: 20,
      },
    },
  });
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'healthy-slot': {
        module: async () => ({ default: healthy }),
        surfaces: {
          'surfaces/Healthy': async () => ({
            default: () => ({ moduleId: 'healthy-slot' }),
          }),
        },
      },
      'broken-slot': {
        module: async () => ({ default: broken }),
        surfaces: {
          'surfaces/Broken': async () => ({
            default: () => {
              throw new Error('broken slot render');
            },
          }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const surface = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/'),
    surfaceId: 'host.page:site.home:main.after',
    session: { user: null, permissions: [] },
    isolateErrors: true,
    renderComponent({ component }) {
      return (component as () => unknown)();
    },
  });

  assert.deepEqual(surface.all.map((item) => item.moduleId), ['healthy-slot']);
  assert.ok(
    surface.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'MODULE_SURFACE_COMPONENT_RENDER_FAILED' &&
        diagnostic.moduleId === 'broken-slot'
    )
  );
});

test('P1.5B renders admin module header actions only from allowed composition modules', async () => {
  const allowed = defineModule({
    id: 'admin-actions',
    name: 'Admin Actions',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:admin.modules:header.actions': {
        mode: 'action',
        component: './surfaces/AdminActions',
        permissions: [Permission.SurfaceContribute],
      },
    },
  });
  const blocked = defineModule({
    id: 'blocked-actions',
    name: 'Blocked Actions',
    version: '0.1.0',
    permissions: [Permission.SurfaceContribute],
    surfaces: {
      'host.page:admin.modules:header.actions': {
        mode: 'action',
        component: './surfaces/AdminActions',
        permissions: [Permission.SurfaceContribute],
      },
    },
  });
  const renderedModules: string[] = [];
  const artifact: ModuleMapArtifact = {
    kind: 'source',
    modules: {
      'admin-actions': {
        module: async () => ({ default: allowed }),
        surfaces: {
          'surfaces/AdminActions': async () => ({
            default: () => {
              renderedModules.push('admin-actions');
              return { moduleId: 'admin-actions', label: 'Brand preview' };
            },
          }),
        },
      },
      'blocked-actions': {
        module: async () => ({ default: blocked }),
        surfaces: {
          'surfaces/AdminActions': async () => ({
            default: () => {
              renderedModules.push('blocked-actions');
              return { moduleId: 'blocked-actions', label: 'Blocked preview' };
            },
          }),
        },
      },
    },
  };

  const host = await createModuleHost({ artifact });
  const plan = resolveHostPageComposition(host.runtime, {
    pageId: 'admin.modules',
    composition: {
      enabledModules: ['admin-actions', 'blocked-actions'],
      slotPolicies: {
        'host.page:admin.modules:header.actions': {
          allowModules: ['admin-actions'],
          maxContributions: 1,
        },
      },
    },
  });
  const surface = await renderModuleSurface(host.runtime, {
    request: new Request('http://localhost/zh/admin/modules'),
    surfaceId: 'host.page:admin.modules:header.actions',
    contributions: plan.slots['header.actions'],
    session: { user: { id: 'admin', role: 'admin' } },
    renderComponent({ component }) {
      return (component as () => unknown)();
    },
  });

  assert.deepEqual(plan.slots['header.actions'].map((item) => item.moduleId), ['admin-actions']);
  assert.deepEqual(surface.action.map((item) => item.moduleId), ['admin-actions']);
  assert.deepEqual(renderedModules, ['admin-actions']);
});

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
  assert.equal(routes.get('admin.run-detail')?.path, '/admin/runs/:runId');
  assert.equal(routes.get('admin.webhook-detail')?.path, '/admin/webhooks/:outboxId');
  assert.equal(routes.get('admin.service-connections')?.path, '/admin/service-connections');
  assert.equal(routes.get('dev.console')?.path, '/admin/module-dev-console');

  for (const pageId of [
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
    assert.equal(route.access, 'admin');
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

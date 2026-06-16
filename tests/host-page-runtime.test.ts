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
      get: (surfaceId: string) => (surfaceId === 'host.page:site.home' ? [contribution] : []),
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
    plan.diagnostics.some((diagnostic) => diagnostic.code === 'HOST_PAGE_OVERRIDE_CONFLICT')
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

  assert.deepEqual(
    surface.replace.map((item) => item.moduleId),
    ['override-only']
  );
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
  assert.deepEqual(
    admin.all.map((item) => item.moduleId),
    ['admin-visible-surface']
  );
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { defineModule, Permission } from '@ploykit/module-sdk';
import {
  createModuleHost,
  renderModuleSurface,
  resolveHostPageComposition,
  type ModuleMapArtifact,
} from '../src/lib/module-runtime';

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

  assert.deepEqual(
    plan.slots.hero.map((item) => item.moduleId),
    ['allowed-site']
  );
  assert.deepEqual(
    surface.all.map((item) => item.moduleId),
    ['allowed-site']
  );
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

  assert.deepEqual(
    userPlan.slots['main.before'].map((item) => item.moduleId),
    []
  );
  assert.deepEqual(
    adminPlan.slots['main.before'].map((item) => item.moduleId),
    ['admin-only-slot']
  );
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

  assert.deepEqual(
    surface.all.map((item) => item.moduleId),
    ['healthy-slot']
  );
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

  assert.deepEqual(
    plan.slots['header.actions'].map((item) => item.moduleId),
    ['admin-actions']
  );
  assert.deepEqual(
    surface.action.map((item) => item.moduleId),
    ['admin-actions']
  );
  assert.deepEqual(renderedModules, ['admin-actions']);
});

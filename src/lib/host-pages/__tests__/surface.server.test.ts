import { describe, expect, it, vi } from 'vitest';
import type { PluginRuntimeContract } from '@/lib/plugin-runtime/contract';

const mocks = vi.hoisted(() => {
  const normalize = (modulePath: string) =>
    modulePath
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\.(ts|tsx|js|jsx)$/, '');

  const componentLoad = vi.fn(() => Promise.resolve({ default: () => null }));
  const entry = {
    components: {
      'components/HomeComponentSlot': componentLoad,
    },
    pages: {},
    slotModules: {},
  };

  return {
    componentLoad,
    entry,
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
    },
    db: {
      select: vi.fn(() => ({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })),
    },
    getPluginRuntimeMapEntry: vi.fn(() => entry),
    resolvePluginComponentModule: vi.fn(
      (mapEntry: typeof entry, componentPath: string) =>
        mapEntry.slotModules?.[normalize(componentPath) as keyof typeof mapEntry.slotModules] ??
        mapEntry.components?.[normalize(componentPath) as keyof typeof mapEntry.components] ??
        null
    ),
    resolvePluginPageModule: vi.fn(
      (mapEntry: typeof entry, componentPath: string) =>
        mapEntry.pages?.[normalize(componentPath) as keyof typeof mapEntry.pages] ?? null
    ),
    resolvePluginSlotModule: vi.fn(
      (mapEntry: typeof entry, componentPath: string) =>
        mapEntry.slotModules?.[normalize(componentPath) as keyof typeof mapEntry.slotModules] ??
        null
    ),
    pluginRuntimeRegistry: {
      getEntry: vi.fn(() => null),
    },
    runtimeScopeService: {
      getEnabledRuntimePlugins: vi.fn(),
    },
  };
});

vi.mock('@/lib/_core/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@/lib/db/client.server', () => ({
  db: mocks.db,
}));

vi.mock('@/lib/db/schema/plugins', () => ({
  pluginHostPageOverrides: {
    productId: 'product_id',
    pagePath: 'page_path',
    status: 'status',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((field, value) => ({ field, value })),
}));

vi.mock('@/lib/plugin-runtime/loader', () => ({
  getPluginRuntimeMapEntry: mocks.getPluginRuntimeMapEntry,
  resolvePluginComponentModule: mocks.resolvePluginComponentModule,
  resolvePluginPageModule: mocks.resolvePluginPageModule,
  resolvePluginSlotModule: mocks.resolvePluginSlotModule,
}));

vi.mock('@/lib/plugin-runtime/registry', () => ({
  pluginRuntimeRegistry: mocks.pluginRuntimeRegistry,
}));

vi.mock('@/lib/plugin-runtime/product-context.server', () => ({
  getCurrentRuntimeProductId: vi.fn(() => 'ploykit'),
}));

vi.mock('@/lib/plugin-runtime/scope', () => ({
  runtimeScopeService: mocks.runtimeScopeService,
}));

function createContract(): PluginRuntimeContract {
  return {
    id: 'component-plugin',
    name: 'Component Plugin',
    version: '1.0.0',
    kind: 'app',
    trustLevel: 'trusted',
    permissions: [],
    menu: [],
    slots: {},
    hostPages: {
      slots: [
        {
          page: '/',
          position: 'main.after',
          component: './components/HomeComponentSlot',
          priority: 5,
        },
      ],
      overrides: [],
    },
    resources: {},
    events: {},
    jobs: {},
    webhooks: {},
    hooks: {},
    meters: [],
    serviceRequirements: [],
    resourceBindings: [],
    egress: [],
    definition: {} as PluginRuntimeContract['definition'],
    routes: {
      pages: [],
      apis: [],
      all: [],
    },
    lifecycle: {},
  };
}

describe('host page surface component loading', () => {
  it('resolves host page slot components from the plugin components directory', async () => {
    const contract = createContract();
    mocks.runtimeScopeService.getEnabledRuntimePlugins.mockImplementation(
      async ({ surface }: { surface: string }) =>
        surface === 'slot' ? [{ pluginId: contract.id, contract }] : []
    );

    const { resolveHostPageSurface } = await import('../surface.server');
    const surface = await resolveHostPageSurface('/');

    expect(surface?.slots).toHaveLength(1);
    expect(surface?.slots[0]?.component).toBe('./components/HomeComponentSlot');
    expect(mocks.resolvePluginComponentModule).toHaveBeenCalledWith(
      mocks.entry,
      './components/HomeComponentSlot'
    );
    await expect(surface?.slots[0]?.load()).resolves.toEqual({ default: expect.any(Function) });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  eq: vi.fn((field, value) => ({ op: 'eq', field, value })),
  and: vi.fn((...conditions) => ({ op: 'and', conditions })),
  asc: vi.fn((field) => ({ op: 'asc', field })),
  pluginQueryService: {
    getInstallation: vi.fn(),
  },
  syncRuntimeCatalog: vi.fn(),
  pluginRuntimeInstallerService: {
    installPlugin: vi.fn(),
    enablePlugin: vi.fn(),
  },
  handleServiceConnectionAction: vi.fn(),
  getPluginRuntimeMapEntry: vi.fn(),
  getRuntimeAppBundle: vi.fn(),
  pluginRuntimeRegistry: {
    getOrLoad: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: mocks.eq,
  and: mocks.and,
  asc: mocks.asc,
}));

vi.mock('@/lib/db/client.server', () => ({
  db: mocks.db,
}));

vi.mock('@/lib/db/schema/plugins', () => ({
  appBundles: {
    id: 'app_bundles.id',
    productId: 'app_bundles.product_id',
  },
  appBundleMembers: {
    bundleId: 'app_bundle_members.bundle_id',
    sortOrder: 'app_bundle_members.sort_order',
  },
  pluginInstallations: {
    productId: 'plugin_installations.product_id',
    pluginId: 'plugin_installations.plugin_id',
  },
}));

vi.mock('@/lib/plugins/plugin-query.server', () => ({
  pluginQueryService: mocks.pluginQueryService,
}));

vi.mock('@/lib/plugin-runtime/catalog/runtime-catalog-sync.server', () => ({
  syncRuntimeCatalog: mocks.syncRuntimeCatalog,
}));

vi.mock('../plugin-runtime-installer.server', () => ({
  pluginRuntimeInstallerService: mocks.pluginRuntimeInstallerService,
}));

vi.mock('@/lib/plugin-runtime/admin/service-connections.server', () => ({
  handleServiceConnectionAction: mocks.handleServiceConnectionAction,
}));

vi.mock('@/lib/plugin-runtime/loader', () => ({
  getPluginRuntimeMapEntry: mocks.getPluginRuntimeMapEntry,
  getRuntimeAppBundle: mocks.getRuntimeAppBundle,
}));

vi.mock('@/lib/plugin-runtime/registry', () => ({
  pluginRuntimeRegistry: mocks.pluginRuntimeRegistry,
}));

import { PluginBundleInstallerService } from '../plugin-bundle-installer.server';

const bundleRow = {
  id: 'runlynk-bundle',
  productId: 'runlynk',
  suiteId: 'runlynk-suite',
  name: 'RunLynk Bundle',
  version: '1.0.0',
  sourceType: 'local',
  sourceRef: null,
  metadata: {
    seeds: {
      serviceConnections: [
        {
          pluginId: 'runlynk-product',
          serviceName: 'run-api',
          ownerType: 'suite',
          baseUrl: 'https://runlynk.example.test',
          authSecretRef: 'env:RUNLYNK_SERVICE_TOKEN',
          actorClaimsEnabled: true,
          actorClaimsSecretRef: 'env:RUNLYNK_ACTOR_SECRET',
          actorClaimsAudience: 'run-api',
          actorClaimsKeyId: 'default',
          actorClaimsTtlSeconds: 300,
          healthPath: '/healthz',
          healthMethod: 'HEAD',
          healthExpectedStatus: 204,
          timeoutMs: 10000,
          retryAttempts: 2,
          retryBackoffMs: 500,
          maxResponseBytes: 1048576,
          metadata: { tier: 'dev' },
        },
      ],
    },
  },
};

const bundleMembers = [
  {
    pluginId: 'runlynk-product',
    enableByDefault: true,
    required: true,
  },
  {
    pluginId: 'runlynk-suite',
    enableByDefault: false,
    required: true,
  },
];

function selectBuilder(result: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(result).then(resolve),
  };
}

function updateBuilder() {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

function mockCatalogSelects(bundleRows: unknown[], memberRows: unknown[]) {
  mocks.db.select
    .mockReturnValueOnce(selectBuilder(bundleRows))
    .mockReturnValueOnce(selectBuilder(memberRows));
}

describe('PluginBundleInstallerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncRuntimeCatalog.mockResolvedValue(undefined);
    mocks.pluginRuntimeInstallerService.installPlugin.mockResolvedValue({ success: true });
    mocks.pluginRuntimeInstallerService.enablePlugin.mockResolvedValue({ success: true });
    mocks.handleServiceConnectionAction.mockResolvedValue({ success: true });
    mocks.getRuntimeAppBundle.mockReturnValue(null);
    mocks.pluginRuntimeRegistry.getOrLoad.mockResolvedValue({
      serviceRequirements: [{ name: 'run-api' }],
    });
  });

  it('plans a bundle from the database catalog', async () => {
    mockCatalogSelects([bundleRow], bundleMembers);
    mocks.pluginQueryService.getInstallation.mockResolvedValue(null);

    const result = await new PluginBundleInstallerService().planBundle({
      bundleId: 'runlynk-bundle',
      productId: 'runlynk',
    });

    expect(result).toMatchObject({
      productId: 'runlynk',
      bundleId: 'runlynk-bundle',
      dryRun: false,
    });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'catalog', status: 'planned' }),
        expect.objectContaining({ type: 'install', pluginId: 'runlynk-product' }),
        expect.objectContaining({ type: 'install', pluginId: 'runlynk-suite' }),
        expect.objectContaining({ type: 'seedServiceConnection', serviceName: 'run-api' }),
        expect.objectContaining({ type: 'enable', pluginId: 'runlynk-product' }),
      ])
    );
    expect(mocks.eq).toHaveBeenCalledWith('app_bundles.id', 'runlynk-bundle');
    expect(mocks.eq).toHaveBeenCalledWith('app_bundles.product_id', 'runlynk');
  });

  it('plans a generated plugin-map bundle when the catalog has not been synchronized yet', async () => {
    mocks.db.select.mockReturnValueOnce(selectBuilder([]));
    mocks.getRuntimeAppBundle.mockReturnValue({
      id: 'core-dev-tools',
      productId: 'ploykit',
      suiteId: 'core',
      name: 'PloyKit Core Developer Tools',
      plugins: [
        {
          pluginId: 'capability-demo',
          enableByDefault: true,
          required: true,
        },
      ],
    });
    mocks.pluginQueryService.getInstallation.mockResolvedValue(null);

    const result = await new PluginBundleInstallerService().planBundle({
      bundleId: 'core-dev-tools',
      productId: 'ploykit',
      dryRun: true,
    });

    expect(result).toMatchObject({
      productId: 'ploykit',
      bundleId: 'core-dev-tools',
      dryRun: true,
    });
    expect(mocks.getRuntimeAppBundle).toHaveBeenCalledWith('core-dev-tools', 'ploykit');
    expect(mocks.syncRuntimeCatalog).not.toHaveBeenCalled();
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'install', pluginId: 'capability-demo' }),
        expect.objectContaining({ type: 'enable', pluginId: 'capability-demo' }),
      ])
    );
  });

  it('applies catalog suite and bundle ownership when installing plugins', async () => {
    mockCatalogSelects([bundleRow], [bundleMembers[0]]);
    mocks.pluginQueryService.getInstallation.mockResolvedValueOnce(null).mockResolvedValueOnce({
      pluginId: 'runlynk-product',
      productId: 'runlynk',
      suiteId: 'runlynk-suite',
      bundleId: 'runlynk-bundle',
      enabled: false,
      installStatus: 'installed',
    });

    const result = await new PluginBundleInstallerService().applyBundle({
      bundleId: 'runlynk-bundle',
      productId: 'runlynk',
      userId: 'system',
    });

    expect(mocks.syncRuntimeCatalog).toHaveBeenCalledWith(mocks.db, {
      productIds: ['runlynk'],
    });
    expect(mocks.pluginRuntimeInstallerService.installPlugin).toHaveBeenCalledWith(
      'runlynk-product',
      'system',
      {
        productId: 'runlynk',
        suiteId: 'runlynk-suite',
        bundleId: 'runlynk-bundle',
      }
    );
    expect(mocks.handleServiceConnectionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'runlynk',
        pluginId: 'runlynk-product',
        ownerType: 'suite',
        serviceName: 'run-api',
        baseUrl: 'https://runlynk.example.test',
        authType: 'bearer',
        authSecretSource: { type: 'env', name: 'RUNLYNK_SERVICE_TOKEN' },
        actorClaimsEnabled: true,
        actorClaimsAudience: 'run-api',
        actorClaimsKeyId: 'default',
        actorClaimsSecretSource: { type: 'env', name: 'RUNLYNK_ACTOR_SECRET' },
        actorClaimsTtlSeconds: 300,
        healthPath: '/healthz',
        healthMethod: 'HEAD',
        healthExpectedStatus: 204,
        timeoutMs: 10000,
        retryAttempts: 2,
        retryBackoffMs: 500,
        maxResponseBytes: 1048576,
        metadata: expect.objectContaining({ source: 'bundle-seed', tier: 'dev' }),
      }),
      'system'
    );
    expect(mocks.pluginRuntimeInstallerService.enablePlugin).toHaveBeenCalledWith(
      'runlynk-product',
      'system',
      { productId: 'runlynk' }
    );
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'install', status: 'applied' }),
        expect.objectContaining({ type: 'seedServiceConnection', status: 'applied' }),
        expect.objectContaining({ type: 'enable', status: 'applied' }),
      ])
    );
  });

  it('attaches an already installed plugin to the catalog suite and bundle', async () => {
    mockCatalogSelects([bundleRow], [bundleMembers[0]]);
    const update = updateBuilder();
    mocks.db.update.mockReturnValue(update);
    mocks.pluginQueryService.getInstallation
      .mockResolvedValueOnce({
        pluginId: 'runlynk-product',
        productId: 'runlynk',
        enabled: false,
        installStatus: 'installed',
      })
      .mockResolvedValueOnce({
        pluginId: 'runlynk-product',
        productId: 'runlynk',
        suiteId: 'runlynk-suite',
        bundleId: 'runlynk-bundle',
        enabled: false,
        installStatus: 'installed',
      });

    const result = await new PluginBundleInstallerService().applyBundle({
      bundleId: 'runlynk-bundle',
      productId: 'runlynk',
      userId: 'system',
    });

    expect(mocks.pluginRuntimeInstallerService.installPlugin).not.toHaveBeenCalled();
    expect(mocks.db.update).toHaveBeenCalledWith({
      productId: 'plugin_installations.product_id',
      pluginId: 'plugin_installations.plugin_id',
    });
    expect(update.set).toHaveBeenCalledWith({
      suiteId: 'runlynk-suite',
      bundleId: 'runlynk-bundle',
      updatedAt: expect.any(Date),
    });
    expect(mocks.pluginRuntimeInstallerService.enablePlugin).toHaveBeenCalledWith(
      'runlynk-product',
      'system',
      { productId: 'runlynk' }
    );
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'attach', status: 'applied' }),
        expect.objectContaining({ type: 'seedServiceConnection', status: 'applied' }),
        expect.objectContaining({ type: 'enable', status: 'applied' }),
      ])
    );
  });

  it('rejects service seeds that are not declared by the target plugin', async () => {
    mockCatalogSelects([bundleRow], [bundleMembers[0]]);
    mocks.pluginQueryService.getInstallation.mockResolvedValue({
      pluginId: 'runlynk-product',
      productId: 'runlynk',
      suiteId: 'runlynk-suite',
      bundleId: 'runlynk-bundle',
      enabled: true,
      installStatus: 'installed',
    });
    mocks.pluginRuntimeRegistry.getOrLoad.mockResolvedValue({
      serviceRequirements: [{ name: 'other-api' }],
    });

    await expect(
      new PluginBundleInstallerService().applyBundle({
        bundleId: 'runlynk-bundle',
        productId: 'runlynk',
      })
    ).rejects.toThrow(/does not declare that serviceRequirements entry/);
  });
});

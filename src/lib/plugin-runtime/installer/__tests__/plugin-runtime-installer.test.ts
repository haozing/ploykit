import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginRuntimeContract } from '../../contract';

const mocks = vi.hoisted(() => ({
  db: {
    transaction: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  bus: {
    onPluginDisabled: vi.fn(),
    event: {
      emit: vi.fn(),
    },
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  pluginQueryService: {
    getInstallation: vi.fn(),
    listInstalledPlugins: vi.fn(),
    mapInstallation: vi.fn((record) => record),
  },
  runPluginLifecycle: vi.fn(),
  getPluginRuntimeMapEntry: vi.fn(),
  listRuntimeProducts: vi.fn(() => [
    { id: 'ploykit', name: 'PloyKit', suites: ['default'], bundles: [] },
  ]),
  listRuntimePluginSuites: vi.fn(() => [
    { id: 'default', productId: 'ploykit', name: 'Default', plugins: ['runtime-notes'] },
  ]),
  listRuntimeAppBundles: vi.fn(() => []),
  DEFAULT_PRODUCT_ID: 'ploykit',
  pluginRuntimeRegistry: {
    getOrLoad: vi.fn(),
    unregister: vi.fn(),
  },
  registerPluginRuntimeJobs: vi.fn(),
  unregisterPluginRuntimeJobs: vi.fn(),
  registerPluginRuntimeEvents: vi.fn(),
  unregisterPluginRuntimeEvents: vi.fn(),
  registerPluginRuntimeHooks: vi.fn(),
  unregisterPluginRuntimeHooks: vi.fn(),
  slotManager: {
    registerFromContract: vi.fn(),
    unregister: vi.fn(),
  },
  createPluginStorageRuntime: vi.fn(),
  ensureCollections: vi.fn(),
  DbPluginStorageRepository: vi.fn(function DbPluginStorageRepository(executor: unknown) {
    return { executor };
  }),
  eq: vi.fn((field, value) => ({ field, value })),
}));

vi.mock('@/lib/db/client.server', () => ({
  db: mocks.db,
}));

vi.mock('@/lib/db/schema/plugins', () => ({
  pluginInstallations: {
    productId: 'product_id',
    suiteId: 'suite_id',
    bundleId: 'bundle_id',
    pluginId: 'plugin_id',
  },
  appProducts: {},
  pluginSuites: {},
  pluginSuiteMembers: {},
  appBundles: {},
  appBundleMembers: {},
}));

vi.mock('@/lib/db/schema/plugin-capabilities', () => ({
  pluginConfig: {
    pluginId: 'plugin_config_plugin_id',
  },
  pluginSecrets: {
    pluginId: 'plugin_secrets_plugin_id',
  },
}));

vi.mock('@/lib/db/schema/plugin-storage', () => ({
  pluginArtifacts: {
    pluginId: 'plugin_artifacts_plugin_id',
  },
  pluginCollections: {
    pluginId: 'plugin_collections_plugin_id',
  },
  pluginRagChunks: {
    pluginId: 'plugin_rag_chunks_plugin_id',
  },
  pluginRecords: {
    pluginId: 'plugin_records_plugin_id',
  },
}));

vi.mock('@/lib/db/schema/reliability', () => ({
  pluginJobRuns: {
    pluginId: 'plugin_job_runs_plugin_id',
  },
}));

vi.mock('@/lib/bus', () => ({
  bus: mocks.bus,
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('@/lib/plugins/plugin-query.server', () => ({
  pluginQueryService: mocks.pluginQueryService,
}));

vi.mock('@/lib/plugin-runtime/adapters', () => ({
  runPluginLifecycle: mocks.runPluginLifecycle,
}));

vi.mock('@/lib/plugin-runtime/loader', () => ({
  DEFAULT_PRODUCT_ID: mocks.DEFAULT_PRODUCT_ID,
  getPluginRuntimeMapEntry: mocks.getPluginRuntimeMapEntry,
  listRuntimeProducts: mocks.listRuntimeProducts,
  listRuntimePluginSuites: mocks.listRuntimePluginSuites,
  listRuntimeAppBundles: mocks.listRuntimeAppBundles,
}));

vi.mock('@/lib/plugin-runtime/registry', () => ({
  pluginRuntimeRegistry: mocks.pluginRuntimeRegistry,
}));

vi.mock('@/lib/plugin-runtime/jobs', () => ({
  registerPluginRuntimeJobs: mocks.registerPluginRuntimeJobs,
  unregisterPluginRuntimeJobs: mocks.unregisterPluginRuntimeJobs,
}));

vi.mock('@/lib/plugin-runtime/events', () => ({
  registerPluginRuntimeEvents: mocks.registerPluginRuntimeEvents,
  unregisterPluginRuntimeEvents: mocks.unregisterPluginRuntimeEvents,
}));

vi.mock('@/lib/plugin-runtime/hooks', () => ({
  registerPluginRuntimeHooks: mocks.registerPluginRuntimeHooks,
  unregisterPluginRuntimeHooks: mocks.unregisterPluginRuntimeHooks,
}));

vi.mock('@/lib/ui/slots/slot-manager', () => ({
  slotManager: mocks.slotManager,
}));

vi.mock('@/lib/plugin-runtime/storage/db-storage.server', () => ({
  createPluginStorageRuntime: mocks.createPluginStorageRuntime,
  DbPluginStorageRepository: mocks.DbPluginStorageRepository,
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();

  return {
    ...actual,
    eq: mocks.eq,
  };
});

import { PluginRuntimeInstallerService } from '../plugin-runtime-installer.server';

const PLUGIN_ID = 'runtime-notes';
const USER_ID = 'admin-1';

function createContract(overrides: Partial<PluginRuntimeContract> = {}): PluginRuntimeContract {
  return {
    id: PLUGIN_ID,
    name: 'Runtime Notes',
    version: '2.3.4',
    kind: 'app',
    trustLevel: 'trusted',
    permissions: [],
    menu: [],
    slots: {},
    hostPages: { slots: [], overrides: [] },
    resources: {},
    events: {},
    jobs: {},
    webhooks: {},
    hooks: {},
    meters: [],
    services: [],
    resourceBindings: [],
    egress: [],
    definition: {} as PluginRuntimeContract['definition'],
    routes: {
      pages: [],
      apis: [],
      all: [],
    },
    lifecycle: {},
    ...overrides,
  };
}

function createInstallation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'install-1',
    pluginId: PLUGIN_ID,
    version: '2.3.4',
    enabled: false,
    installedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    installedBy: USER_ID,
    productId: 'ploykit',
    suiteId: 'default',
    bundleId: null,
    installStatus: 'installed',
    metadata: {},
    ...overrides,
  };
}

function createSelectBuilder(result: unknown[]) {
  const builder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(result).then(resolve),
  };

  return builder;
}

function createInsertBuilder(result: unknown[]) {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    returning: vi.fn().mockResolvedValue(result),
  };
}

function createUpdateBuilder(result: unknown[]) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
  };
}

function createFailingUpdateBuilder(error: Error) {
  return {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockRejectedValue(error),
  };
}

function createDeleteBuilder() {
  return {
    where: vi.fn().mockReturnThis(),
  };
}

describe('PluginRuntimeInstallerService', () => {
  let service: PluginRuntimeInstallerService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PluginRuntimeInstallerService();

    mocks.getPluginRuntimeMapEntry.mockReturnValue({
      plugin: vi.fn(),
      productId: 'ploykit',
      suiteId: 'default',
      bundleIds: [],
    });
    mocks.pluginRuntimeRegistry.getOrLoad.mockResolvedValue(createContract());
    mocks.runPluginLifecycle.mockResolvedValue({
      success: true,
      lifecycle: 'install',
      pluginId: PLUGIN_ID,
      duration: 1,
    });
    mocks.bus.event.emit.mockResolvedValue(undefined);
    mocks.registerPluginRuntimeJobs.mockResolvedValue([]);
    mocks.registerPluginRuntimeEvents.mockResolvedValue([]);
    mocks.registerPluginRuntimeHooks.mockResolvedValue([]);
    mocks.unregisterPluginRuntimeJobs.mockReturnValue(0);
    mocks.unregisterPluginRuntimeEvents.mockReturnValue(0);
    mocks.unregisterPluginRuntimeHooks.mockReturnValue(0);
    mocks.slotManager.registerFromContract.mockResolvedValue(undefined);
    mocks.slotManager.unregister.mockReturnValue(undefined);
    mocks.pluginQueryService.listInstalledPlugins.mockResolvedValue([]);
    mocks.pluginQueryService.mapInstallation.mockImplementation((record) => record);
    mocks.ensureCollections.mockResolvedValue(undefined);
    mocks.createPluginStorageRuntime.mockReturnValue({
      ensureCollections: mocks.ensureCollections,
    });
  });

  it('installs from the runtime contract and emits an installed event', async () => {
    const installation = createInstallation();
    const selectBuilder = createSelectBuilder([]);
    const insertBuilder = createInsertBuilder([installation]);
    const tx = {
      select: vi.fn().mockReturnValue(selectBuilder),
      insert: vi.fn().mockReturnValue(insertBuilder),
    };

    mocks.db.transaction.mockImplementation(async (callback) => callback(tx));

    const result = await service.installPlugin(PLUGIN_ID, USER_ID);

    expect(result).toEqual({
      success: true,
      installation,
    });
    expect(mocks.getPluginRuntimeMapEntry).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.pluginRuntimeRegistry.getOrLoad).toHaveBeenCalledWith(
      PLUGIN_ID,
      expect.objectContaining({ plugin: expect.any(Function) })
    );
    expect(insertBuilder.values).toHaveBeenCalledWith({
      productId: 'ploykit',
      suiteId: 'default',
      bundleId: undefined,
      pluginId: PLUGIN_ID,
      version: '2.3.4',
      enabled: false,
      installStatus: 'installed',
      installedBy: USER_ID,
    });
    expect(mocks.createPluginStorageRuntime).toHaveBeenCalledWith({
      pluginId: PLUGIN_ID,
      system: true,
      data: undefined,
      repository: expect.objectContaining({ executor: tx }),
    });
    expect(mocks.ensureCollections).toHaveBeenCalledTimes(1);
    expect(mocks.runPluginLifecycle).toHaveBeenCalledWith({
      pluginId: PLUGIN_ID,
      lifecycle: 'install',
      userId: USER_ID,
      metadata: {
        version: '2.3.4',
        installationId: 'install-1',
      },
    });
    expect(mocks.bus.event.emit).toHaveBeenCalledWith(
      'plugin.installed',
      'plugin-runtime-installer',
      {
        pluginId: PLUGIN_ID,
        productId: 'ploykit',
        userId: USER_ID,
        version: '2.3.4',
        installationId: 'install-1',
      },
      {
        correlationId: 'install-1',
        idempotencyKey: `plugin:${PLUGIN_ID}:installed:install-1`,
      }
    );
  });

  it('rolls back the installation row when install lifecycle fails', async () => {
    const tx = {
      select: vi.fn().mockReturnValue(createSelectBuilder([])),
      insert: vi.fn().mockReturnValue(createInsertBuilder([createInstallation()])),
    };
    const deleteBuilder = createDeleteBuilder();

    mocks.db.transaction.mockImplementation(async (callback) => callback(tx));
    mocks.db.delete.mockReturnValue(deleteBuilder);
    mocks.runPluginLifecycle.mockResolvedValue({
      success: false,
      lifecycle: 'install',
      pluginId: PLUGIN_ID,
      duration: 1,
      error: 'setup failed',
    });

    await expect(service.installPlugin(PLUGIN_ID, USER_ID)).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_ERROR',
    });

    expect(mocks.db.delete).toHaveBeenCalled();
    expect(deleteBuilder.where).toHaveBeenCalled();
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_job_runs_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_config_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_secrets_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_records_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_collections_plugin_id',
    });
    expect(mocks.bus.event.emit).not.toHaveBeenCalled();
  });

  it('enables an installed runtime plugin after enable lifecycle succeeds', async () => {
    const current = createInstallation({ enabled: false });
    const enabled = createInstallation({ enabled: true });
    const updateBuilder = createUpdateBuilder([enabled]);

    mocks.pluginQueryService.getInstallation.mockResolvedValue(current);
    mocks.runPluginLifecycle.mockResolvedValue({
      success: true,
      lifecycle: 'enable',
      pluginId: PLUGIN_ID,
      duration: 1,
    });
    mocks.db.update.mockReturnValue(updateBuilder);

    const result = await service.enablePlugin(PLUGIN_ID, USER_ID);

    expect(result.installation).toEqual(enabled);
    expect(mocks.runPluginLifecycle).toHaveBeenCalledWith({
      pluginId: PLUGIN_ID,
      lifecycle: 'enable',
      userId: USER_ID,
      metadata: {
        version: '2.3.4',
        installationId: 'install-1',
      },
    });
    expect(updateBuilder.set).toHaveBeenCalledWith({
      enabled: true,
      updatedAt: expect.any(Date),
    });
    expect(mocks.registerPluginRuntimeJobs).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.registerPluginRuntimeEvents).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.registerPluginRuntimeHooks).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.slotManager.registerFromContract).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.bus.event.emit).toHaveBeenCalledWith(
      'plugin.enabled',
      'plugin-runtime-installer',
      {
        pluginId: PLUGIN_ID,
        productId: 'ploykit',
        version: '2.3.4',
        installationId: 'install-1',
      },
      {
        correlationId: 'install-1',
        idempotencyKey: `plugin:${PLUGIN_ID}:enabled:install-1`,
      }
    );
  });

  it('does not enable the installation when runtime event registration fails', async () => {
    const current = createInstallation({ enabled: false });

    mocks.pluginQueryService.getInstallation.mockResolvedValue(current);
    mocks.runPluginLifecycle.mockResolvedValue({
      success: true,
      lifecycle: 'enable',
      pluginId: PLUGIN_ID,
      duration: 1,
    });
    mocks.registerPluginRuntimeEvents.mockRejectedValue(new Error('event handler missing'));

    await expect(service.enablePlugin(PLUGIN_ID, USER_ID)).rejects.toMatchObject({
      code: 'PLUGIN_LIFECYCLE_ERROR',
      details: {
        lifecycle: 'enable',
        pluginId: PLUGIN_ID,
      },
    });

    expect(mocks.registerPluginRuntimeJobs).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.registerPluginRuntimeEvents).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.registerPluginRuntimeHooks).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
    expect(mocks.bus.onPluginDisabled).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeJobs).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeEvents).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeHooks).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.slotManager.unregister).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.bus.event.emit).not.toHaveBeenCalledWith(
      'plugin.enabled',
      'plugin-runtime-installer',
      expect.any(Object)
    );
  });

  it('unregisters runtime jobs and events when enabling cannot persist enabled state', async () => {
    const current = createInstallation({ enabled: false });
    const updateBuilder = createFailingUpdateBuilder(new Error('database unavailable'));

    mocks.pluginQueryService.getInstallation.mockResolvedValue(current);
    mocks.runPluginLifecycle.mockResolvedValue({
      success: true,
      lifecycle: 'enable',
      pluginId: PLUGIN_ID,
      duration: 1,
    });
    mocks.db.update.mockReturnValue(updateBuilder);

    await expect(service.enablePlugin(PLUGIN_ID, USER_ID)).rejects.toMatchObject({
      code: 'PLUGIN_LIFECYCLE_ERROR',
      details: {
        lifecycle: 'enable',
        pluginId: PLUGIN_ID,
      },
    });

    expect(updateBuilder.set).toHaveBeenCalledWith({
      enabled: true,
      updatedAt: expect.any(Date),
    });
    expect(mocks.bus.onPluginDisabled).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeJobs).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeEvents).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeHooks).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.slotManager.unregister).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.bus.event.emit).not.toHaveBeenCalledWith(
      'plugin.enabled',
      'plugin-runtime-installer',
      expect.any(Object)
    );
  });

  it('disables the plugin even when disable lifecycle returns failure', async () => {
    const current = createInstallation({ enabled: true });
    const disabled = createInstallation({ enabled: false });
    const updateBuilder = createUpdateBuilder([disabled]);

    mocks.pluginQueryService.getInstallation.mockResolvedValue(current);
    mocks.runPluginLifecycle.mockResolvedValue({
      success: false,
      lifecycle: 'disable',
      pluginId: PLUGIN_ID,
      duration: 1,
      error: 'cleanup failed',
    });
    mocks.db.update.mockReturnValue(updateBuilder);

    const result = await service.disablePlugin(PLUGIN_ID, USER_ID);

    expect(result.installation).toEqual(disabled);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      { pluginId: PLUGIN_ID, error: 'cleanup failed' },
      'Disable lifecycle failed but continuing'
    );
    expect(mocks.bus.onPluginDisabled).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeJobs).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeEvents).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.unregisterPluginRuntimeHooks).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.slotManager.unregister).toHaveBeenCalledWith(PLUGIN_ID);
    expect(updateBuilder.set).toHaveBeenCalledWith({
      enabled: false,
      updatedAt: expect.any(Date),
    });
  });

  it('uninstalls by disabling first, deleting the row, and unregistering runtime contract', async () => {
    const enabled = createInstallation({ enabled: true });
    const disabled = createInstallation({ enabled: false });
    const updateBuilder = createUpdateBuilder([disabled]);
    const deleteBuilder = createDeleteBuilder();

    mocks.pluginQueryService.getInstallation
      .mockResolvedValueOnce(enabled)
      .mockResolvedValueOnce(enabled);
    mocks.runPluginLifecycle
      .mockResolvedValueOnce({
        success: true,
        lifecycle: 'disable',
        pluginId: PLUGIN_ID,
        duration: 1,
      })
      .mockResolvedValueOnce({
        success: false,
        lifecycle: 'uninstall',
        pluginId: PLUGIN_ID,
        duration: 1,
        error: 'best-effort cleanup failed',
      });
    mocks.db.update.mockReturnValue(updateBuilder);
    mocks.db.delete.mockReturnValue(deleteBuilder);

    const result = await service.uninstallPlugin(PLUGIN_ID, USER_ID);

    expect(result).toEqual({
      success: true,
      installation: enabled,
    });
    expect(mocks.runPluginLifecycle).toHaveBeenNthCalledWith(1, {
      pluginId: PLUGIN_ID,
      lifecycle: 'disable',
      userId: USER_ID,
      metadata: {
        version: '2.3.4',
        installationId: 'install-1',
      },
    });
    expect(mocks.runPluginLifecycle).toHaveBeenNthCalledWith(2, {
      pluginId: PLUGIN_ID,
      lifecycle: 'uninstall',
      userId: USER_ID,
      metadata: {
        version: '2.3.4',
        installationId: 'install-1',
      },
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      { pluginId: PLUGIN_ID, error: 'best-effort cleanup failed' },
      'Uninstall lifecycle failed but continuing'
    );
    expect(mocks.db.delete).toHaveBeenCalled();
    expect(deleteBuilder.where).toHaveBeenCalled();
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_job_runs_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_config_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_secrets_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_records_plugin_id',
    });
    expect(mocks.db.delete).toHaveBeenCalledWith({
      pluginId: 'plugin_collections_plugin_id',
    });
    expect(mocks.pluginRuntimeRegistry.unregister).toHaveBeenCalledWith(PLUGIN_ID);
    expect(mocks.bus.event.emit).toHaveBeenLastCalledWith(
      'plugin.uninstalled',
      'plugin-runtime-installer',
      {
        pluginId: PLUGIN_ID,
        productId: 'ploykit',
        version: '2.3.4',
        installationId: 'install-1',
      },
      {
        correlationId: 'install-1',
        idempotencyKey: `plugin:${PLUGIN_ID}:uninstalled:install-1`,
      }
    );
  });
});

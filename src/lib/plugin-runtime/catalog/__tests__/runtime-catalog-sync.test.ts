import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listRuntimeProducts: vi.fn(),
  listRuntimePluginSuites: vi.fn(),
  listRuntimeAppBundles: vi.fn(),
}));

const tables = vi.hoisted(() => ({
  appProducts: {
    id: 'app_products.id',
    name: 'app_products.name',
    runtimeKey: 'app_products.runtime_key',
    defaultLocale: 'app_products.default_locale',
    status: 'app_products.status',
    metadata: 'app_products.metadata',
    updatedAt: 'app_products.updated_at',
  },
  pluginSuites: {
    id: 'plugin_suites.id',
    productId: 'plugin_suites.product_id',
    name: 'plugin_suites.name',
    version: 'plugin_suites.version',
    status: 'plugin_suites.status',
    metadata: 'plugin_suites.metadata',
    updatedAt: 'plugin_suites.updated_at',
  },
  pluginSuiteMembers: {
    suiteId: 'plugin_suite_members.suite_id',
    productId: 'plugin_suite_members.product_id',
    pluginId: 'plugin_suite_members.plugin_id',
    role: 'plugin_suite_members.role',
    sortOrder: 'plugin_suite_members.sort_order',
    metadata: 'plugin_suite_members.metadata',
    updatedAt: 'plugin_suite_members.updated_at',
  },
  appBundles: {
    id: 'app_bundles.id',
    productId: 'app_bundles.product_id',
    suiteId: 'app_bundles.suite_id',
    name: 'app_bundles.name',
    version: 'app_bundles.version',
    sourceType: 'app_bundles.source_type',
    sourceRef: 'app_bundles.source_ref',
    status: 'app_bundles.status',
    metadata: 'app_bundles.metadata',
    updatedAt: 'app_bundles.updated_at',
  },
  appBundleMembers: {
    bundleId: 'app_bundle_members.bundle_id',
    productId: 'app_bundle_members.product_id',
    suiteId: 'app_bundle_members.suite_id',
    pluginId: 'app_bundle_members.plugin_id',
    enableByDefault: 'app_bundle_members.enable_by_default',
    required: 'app_bundle_members.required',
    sortOrder: 'app_bundle_members.sort_order',
    metadata: 'app_bundle_members.metadata',
    updatedAt: 'app_bundle_members.updated_at',
  },
}));

vi.mock('@/lib/db/client.server', () => ({
  db: {},
}));

vi.mock('@/lib/db/schema/plugins', () => tables);

vi.mock('@/lib/plugin-runtime/loader', () => ({
  listRuntimeProducts: mocks.listRuntimeProducts,
  listRuntimePluginSuites: mocks.listRuntimePluginSuites,
  listRuntimeAppBundles: mocks.listRuntimeAppBundles,
}));

import { syncRuntimeCatalog } from '../runtime-catalog-sync.server';

interface InsertCall {
  table: unknown;
  rows: unknown[];
  conflictTarget?: unknown;
  conflictSet?: unknown;
}

function createExecutor() {
  const insertCalls: InsertCall[] = [];
  const executor = {
    insert: vi.fn((table: unknown) => {
      const call: InsertCall = { table, rows: [] };
      insertCalls.push(call);
      const builder = {
        values: vi.fn((rows: unknown | unknown[]) => {
          call.rows = Array.isArray(rows) ? rows : [rows];
          return builder;
        }),
        onConflictDoUpdate: vi.fn((config: { target: unknown; set: unknown }) => {
          call.conflictTarget = config.target;
          call.conflictSet = config.set;
          return Promise.resolve();
        }),
      };
      return builder;
    }),
  };

  return { executor, insertCalls };
}

function findInsert(calls: readonly InsertCall[], table: unknown): InsertCall {
  const call = calls.find((entry) => entry.table === table);
  if (!call) {
    throw new Error('Expected insert call was not recorded.');
  }
  return call;
}

const suites = [
  {
    id: 'core',
    productId: 'ploykit',
    name: 'PloyKit Core',
    plugins: ['capability-demo'],
  },
  {
    id: 'runlynk',
    productId: 'runlynk',
    name: 'RunLynk',
    plugins: ['runlynk-core-console'],
  },
];

const bundles = [
  {
    id: 'core-dev-tools',
    productId: 'ploykit',
    suiteId: 'core',
    name: 'PloyKit Core Developer Tools',
    plugins: [{ pluginId: 'capability-demo', enableByDefault: true, required: true }],
  },
  {
    id: 'runlynk',
    productId: 'runlynk',
    suiteId: 'runlynk',
    name: 'RunLynk',
    plugins: [{ pluginId: 'runlynk-core-console', enableByDefault: true, required: true }],
  },
];

describe('syncRuntimeCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRuntimeProducts.mockReturnValue([
      { id: 'ploykit', name: 'PloyKit' },
      {
        id: 'runlynk',
        name: 'RunLynk',
        planCapabilities: [
          {
            key: 'runlynk.outputQuality',
            valueType: 'enum',
            ownerType: 'product',
            ownerId: 'runlynk',
            required: true,
            sortOrder: 100,
            options: [{ value: '1080p' }],
          },
        ],
      },
    ]);
    mocks.listRuntimePluginSuites.mockImplementation((productId?: string) =>
      productId ? suites.filter((suite) => suite.productId === productId) : suites
    );
    mocks.listRuntimeAppBundles.mockImplementation((productId?: string) =>
      productId ? bundles.filter((bundle) => bundle.productId === productId) : bundles
    );
  });

  it('syncs only the requested product catalog when productIds are provided', async () => {
    const { executor, insertCalls } = createExecutor();

    await syncRuntimeCatalog(executor as never, { productIds: ['runlynk'] });

    expect(mocks.listRuntimePluginSuites).toHaveBeenCalledWith('runlynk');
    expect(mocks.listRuntimeAppBundles).toHaveBeenCalledWith('runlynk');
    expect(findInsert(insertCalls, tables.pluginSuiteMembers).rows).toEqual([
      expect.objectContaining({
        productId: 'runlynk',
        suiteId: 'runlynk',
        pluginId: 'runlynk-core-console',
      }),
    ]);
    expect(findInsert(insertCalls, tables.appBundleMembers).rows).toEqual([
      expect.objectContaining({
        productId: 'runlynk',
        bundleId: 'runlynk',
        pluginId: 'runlynk-core-console',
      }),
    ]);
    expect(findInsert(insertCalls, tables.appProducts).rows).toEqual([
      expect.objectContaining({
        id: 'runlynk',
        metadata: {
          planCapabilities: [
            expect.objectContaining({
              key: 'runlynk.outputQuality',
              ownerType: 'product',
              ownerId: 'runlynk',
            }),
          ],
        },
      }),
    ]);
  });

  it('upserts suite membership by product/plugin so moving suites updates cleanly', async () => {
    const { executor, insertCalls } = createExecutor();

    await syncRuntimeCatalog(executor as never, { productIds: ['runlynk'] });

    const suiteMembers = findInsert(insertCalls, tables.pluginSuiteMembers);
    expect(suiteMembers.conflictTarget).toEqual([
      tables.pluginSuiteMembers.productId,
      tables.pluginSuiteMembers.pluginId,
    ]);
    expect(suiteMembers.conflictSet).toEqual(
      expect.objectContaining({
        suiteId: expect.anything(),
      })
    );
  });

  it('rejects bundles that reference undeclared suites', async () => {
    const { executor } = createExecutor();
    mocks.listRuntimePluginSuites.mockReturnValue([]);
    mocks.listRuntimeAppBundles.mockReturnValue([
      {
        id: 'broken',
        productId: 'ploykit',
        suiteId: 'missing-suite',
        name: 'Broken',
        plugins: [],
      },
    ]);

    await expect(syncRuntimeCatalog(executor as never)).rejects.toThrow(
      /references missing suite "missing-suite"/
    );
  });
});

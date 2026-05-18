import 'server-only';

import { db, type Database } from '@/lib/db/client.server';
import {
  appBundleMembers,
  appBundles,
  appProducts,
  pluginSuiteMembers,
  pluginSuites,
  type NewAppBundle,
  type NewAppBundleMember,
  type NewAppProduct,
  type NewPluginSuite,
  type NewPluginSuiteMember,
} from '@/lib/db/schema/plugins';
import {
  listRuntimeAppBundles,
  listRuntimePluginSuites,
  listRuntimeProducts,
} from '@/lib/plugin-runtime/loader';
import { sql } from 'drizzle-orm';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface RuntimeCatalogSyncOptions {
  productIds?: readonly string[];
}

function scrubUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

export async function syncRuntimeCatalog(
  executor: Executor = db,
  options: RuntimeCatalogSyncOptions = {}
): Promise<void> {
  const now = new Date();
  const productsById = new Map(listRuntimeProducts().map((product) => [product.id, product]));
  for (const productId of options.productIds ?? []) {
    if (!productsById.has(productId)) {
      productsById.set(productId, {
        id: productId,
        name: productId,
        runtimeKey: productId,
        defaultLocale: 'en',
        status: 'active',
      });
    }
  }

  const productRows = [...productsById.values()].map(
    (product) =>
      scrubUndefined({
        id: product.id,
        name: product.name,
        runtimeKey: product.runtimeKey ?? product.id,
        defaultLocale: product.defaultLocale ?? 'en',
        status: product.status ?? 'active',
        metadata: product.metadata ?? {},
        updatedAt: now,
      }) satisfies NewAppProduct
  );
  if (productRows.length > 0) {
    await executor
      .insert(appProducts)
      .values(productRows)
      .onConflictDoUpdate({
        target: appProducts.id,
        set: {
          name: sql`excluded.name`,
          runtimeKey: sql`excluded.runtime_key`,
          defaultLocale: sql`excluded.default_locale`,
          status: sql`excluded.status`,
          metadata: sql`excluded.metadata`,
          updatedAt: now,
        },
      });
  }

  const suiteRows = listRuntimePluginSuites().map(
    (suite) =>
      scrubUndefined({
        id: suite.id,
        productId: suite.productId,
        name: suite.name,
        version: suite.version ?? '0.1.0',
        status: suite.status ?? 'active',
        metadata: {
          menu: suite.menu,
          billing: suite.billing,
          sharedServiceConnections: suite.sharedServiceConnections,
          sharedResourceBindings: suite.sharedResourceBindings,
          ...(suite.metadata ?? {}),
        },
        updatedAt: now,
      }) satisfies NewPluginSuite
  );
  if (suiteRows.length > 0) {
    await executor
      .insert(pluginSuites)
      .values(suiteRows)
      .onConflictDoUpdate({
        target: pluginSuites.id,
        set: {
          productId: sql`excluded.product_id`,
          name: sql`excluded.name`,
          version: sql`excluded.version`,
          status: sql`excluded.status`,
          metadata: sql`excluded.metadata`,
          updatedAt: now,
        },
      });
  }

  for (const suite of listRuntimePluginSuites()) {
    const memberRows = suite.plugins.map(
      (pluginId, index) =>
        scrubUndefined({
          suiteId: suite.id,
          productId: suite.productId,
          pluginId,
          role: 'member',
          sortOrder: index,
          metadata: {},
          updatedAt: now,
        }) satisfies NewPluginSuiteMember
    );
    if (memberRows.length === 0) {
      continue;
    }
    await executor
      .insert(pluginSuiteMembers)
      .values(memberRows)
      .onConflictDoUpdate({
        target: [pluginSuiteMembers.suiteId, pluginSuiteMembers.pluginId],
        set: {
          productId: sql`excluded.product_id`,
          role: sql`excluded.role`,
          sortOrder: sql`excluded.sort_order`,
          metadata: sql`excluded.metadata`,
          updatedAt: now,
        },
      });
  }

  const bundleRows = listRuntimeAppBundles().map(
    (bundle) =>
      scrubUndefined({
        id: bundle.id,
        productId: bundle.productId,
        suiteId: bundle.suiteId,
        name: bundle.name,
        version: bundle.version ?? '0.1.0',
        sourceType: bundle.sourceType ?? 'local',
        sourceRef: bundle.sourceRef,
        status: 'active',
        metadata: {
          seeds: bundle.seeds,
          healthChecks: bundle.healthChecks,
          dependencies: bundle.dependencies,
          ...(bundle.metadata ?? {}),
        },
        updatedAt: now,
      }) satisfies NewAppBundle
  );
  if (bundleRows.length > 0) {
    await executor
      .insert(appBundles)
      .values(bundleRows)
      .onConflictDoUpdate({
        target: appBundles.id,
        set: {
          productId: sql`excluded.product_id`,
          suiteId: sql`excluded.suite_id`,
          name: sql`excluded.name`,
          version: sql`excluded.version`,
          sourceType: sql`excluded.source_type`,
          sourceRef: sql`excluded.source_ref`,
          status: sql`excluded.status`,
          metadata: sql`excluded.metadata`,
          updatedAt: now,
        },
      });
  }

  for (const bundle of listRuntimeAppBundles()) {
    const memberRows = bundle.plugins.map(
      (plugin, index) =>
        scrubUndefined({
          bundleId: bundle.id,
          productId: bundle.productId,
          suiteId: bundle.suiteId,
          pluginId: plugin.pluginId,
          enableByDefault: plugin.enableByDefault,
          required: plugin.required,
          sortOrder: index,
          metadata: {},
          updatedAt: now,
        }) satisfies NewAppBundleMember
    );
    if (memberRows.length === 0) {
      continue;
    }
    await executor
      .insert(appBundleMembers)
      .values(memberRows)
      .onConflictDoUpdate({
        target: [appBundleMembers.bundleId, appBundleMembers.pluginId],
        set: {
          productId: sql`excluded.product_id`,
          suiteId: sql`excluded.suite_id`,
          enableByDefault: sql`excluded.enable_by_default`,
          required: sql`excluded.required`,
          sortOrder: sql`excluded.sort_order`,
          metadata: sql`excluded.metadata`,
          updatedAt: now,
        },
      });
  }
}

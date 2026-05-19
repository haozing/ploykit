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
import type {
  RuntimeAppBundle,
  RuntimePluginSuite,
  RuntimeProduct,
} from '@/lib/plugin-runtime/catalog/runtime-catalog-types';
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

function uniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function collectRuntimeSuites(productIds?: readonly string[]): RuntimePluginSuite[] {
  if (!productIds) {
    return listRuntimePluginSuites();
  }

  return productIds.flatMap((productId) => listRuntimePluginSuites(productId));
}

function collectRuntimeBundles(productIds?: readonly string[]): RuntimeAppBundle[] {
  if (!productIds) {
    return listRuntimeAppBundles();
  }

  return productIds.flatMap((productId) => listRuntimeAppBundles(productId));
}

function collectRuntimeProducts(
  suites: readonly RuntimePluginSuite[],
  bundles: readonly RuntimeAppBundle[],
  productIds?: readonly string[]
): RuntimeProduct[] {
  const productsById = new Map(listRuntimeProducts().map((product) => [product.id, product]));
  for (const productId of [
    ...(productIds ?? []),
    ...suites.map((suite) => suite.productId),
    ...bundles.map((bundle) => bundle.productId),
  ]) {
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

  if (!productIds) {
    return [...productsById.values()];
  }

  const selected = new Set(productIds);
  return [...productsById.values()].filter((product) => selected.has(product.id));
}

function assertUniqueRuntimeIds(
  label: string,
  values: readonly { id: string; productId: string }[]
): void {
  const seen = new Map<string, string>();
  for (const value of values) {
    const existingProductId = seen.get(value.id);
    if (existingProductId && existingProductId !== value.productId) {
      throw new Error(
        `Runtime ${label} "${value.id}" is declared for both products "${existingProductId}" and "${value.productId}". Use globally unique ${label} ids.`
      );
    }
    seen.set(value.id, value.productId);
  }
}

function validateRuntimeCatalogPlan(
  products: readonly RuntimeProduct[],
  suites: readonly RuntimePluginSuite[],
  bundles: readonly RuntimeAppBundle[]
): void {
  assertUniqueRuntimeIds('suite', suites);
  assertUniqueRuntimeIds('bundle', bundles);

  const productIds = new Set(products.map((product) => product.id));
  const suitesById = new Map(suites.map((suite) => [suite.id, suite]));
  const suiteMemberOwners = new Map<string, string>();

  for (const suite of suites) {
    if (!productIds.has(suite.productId)) {
      throw new Error(
        `Runtime suite "${suite.id}" references missing product "${suite.productId}".`
      );
    }

    for (const pluginId of suite.plugins) {
      const ownerKey = `${suite.productId}:${pluginId}`;
      const existingSuiteId = suiteMemberOwners.get(ownerKey);
      if (existingSuiteId && existingSuiteId !== suite.id) {
        throw new Error(
          `Runtime plugin "${pluginId}" is assigned to both suites "${existingSuiteId}" and "${suite.id}" in product "${suite.productId}".`
        );
      }
      suiteMemberOwners.set(ownerKey, suite.id);
    }
  }

  for (const bundle of bundles) {
    if (!productIds.has(bundle.productId)) {
      throw new Error(
        `Runtime bundle "${bundle.id}" references missing product "${bundle.productId}".`
      );
    }

    if (!bundle.suiteId) {
      continue;
    }

    const suite = suitesById.get(bundle.suiteId);
    if (!suite) {
      throw new Error(
        `Runtime bundle "${bundle.id}" references missing suite "${bundle.suiteId}". Declare the suite before syncing the bundle.`
      );
    }
    if (suite.productId !== bundle.productId) {
      throw new Error(
        `Runtime bundle "${bundle.id}" belongs to product "${bundle.productId}" but references suite "${bundle.suiteId}" from product "${suite.productId}".`
      );
    }
  }
}

export async function syncRuntimeCatalog(
  executor: Executor = db,
  options: RuntimeCatalogSyncOptions = {}
): Promise<void> {
  const now = new Date();
  const targetProductIds = options.productIds ? uniqueValues(options.productIds) : undefined;
  const suites = collectRuntimeSuites(targetProductIds);
  const bundles = collectRuntimeBundles(targetProductIds);
  const products = collectRuntimeProducts(suites, bundles, targetProductIds);
  validateRuntimeCatalogPlan(products, suites, bundles);

  const productRows = products.map(
    (product) =>
      scrubUndefined({
        id: product.id,
        name: product.name,
        runtimeKey: product.runtimeKey ?? product.id,
        defaultLocale: product.defaultLocale ?? 'en',
        status: product.status ?? 'active',
        metadata: {
          ...(product.metadata ?? {}),
          ...(product.scopeProfile ? { scopeProfile: product.scopeProfile } : {}),
          ...(product.planCapabilities ? { planCapabilities: product.planCapabilities } : {}),
        },
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

  const suiteRows = suites.map(
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

  for (const suite of suites) {
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
        target: [pluginSuiteMembers.productId, pluginSuiteMembers.pluginId],
        set: {
          suiteId: sql`excluded.suite_id`,
          productId: sql`excluded.product_id`,
          role: sql`excluded.role`,
          sortOrder: sql`excluded.sort_order`,
          metadata: sql`excluded.metadata`,
          updatedAt: now,
        },
      });
  }

  const bundleRows = bundles.map(
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

  for (const bundle of bundles) {
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
